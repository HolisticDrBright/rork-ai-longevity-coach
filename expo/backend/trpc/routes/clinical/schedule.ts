import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter } from '../../create-context';
import {
  clinicalAuthenticatedProcedure,
  organizationProcedure,
} from '../../clinical-authorization';
import { throwFromRpcError } from './rpc-errors';

/**
 * clinical.schedule — the desktop calendar's live namespace.
 *
 * Reads run under the caller's RLS view: appointments for patients the caller
 * can access, plus org-level patient-NULL rows (breaks / group blocks —
 * migration 0017's visibility branch). An unassigned practitioner simply sees
 * fewer rows, never an error.
 *
 * Writes go through the 0017 SECURITY DEFINER RPCs (book_appointment /
 * update_appointment_status / reschedule_appointment): validation,
 * double-booking rejection, authorization, and the append-only audit row all
 * happen atomically in the database.
 */

const APPOINTMENT_TYPES = [
  'initial',
  'follow-up',
  'lab-review',
  'supplement',
  'telehealth',
  'group',
  'break',
] as const;

const STATUS_TARGETS = ['confirmed', 'arrived', 'completed', 'cancelled', 'no_show'] as const;

interface AppointmentRow {
  id: string;
  patient_id: string | null;
  practitioner_user_id: string | null;
  title: string | null;
  appointment_type: string | null;
  location: string | null;
  telehealth_url: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  patient_profiles: { first_name: string | null; last_name: string | null } | null;
}

export function mapAppointmentRow(
  row: AppointmentRow,
  practitionerNames: Map<string, string>,
) {
  const patientName = row.patient_profiles
    ? `${row.patient_profiles.first_name ?? ''} ${row.patient_profiles.last_name ?? ''}`.trim() || null
    : null;
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName,
    practitionerUserId: row.practitioner_user_id,
    practitionerName: row.practitioner_user_id
      ? (practitionerNames.get(row.practitioner_user_id) ?? null)
      : null,
    title: row.title,
    appointmentType: row.appointment_type,
    location: row.location,
    telehealthUrl: row.telehealth_url,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

export const clinicalScheduleRouter = createTRPCRouter({
  /** Appointments in [fromIso, toIso) for one org, under the caller's RLS view. */
  getCalendar: organizationProcedure
    .input(
      z.object({
        fromIso: z.string().datetime({ offset: true }),
        toIso: z.string().datetime({ offset: true }),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { organizationId, fromIso, toIso } = input as {
        organizationId: string;
        fromIso: string;
        toIso: string;
      };

      const [appts, practitioners] = await Promise.all([
        ctx.clinicalDb
          .from('appointments')
          .select(
            'id, patient_id, practitioner_user_id, title, appointment_type, location, telehealth_url, status, starts_at, ends_at, patient_profiles ( first_name, last_name )',
          )
          .eq('organization_id', organizationId)
          .gte('starts_at', fromIso)
          .lt('starts_at', toIso)
          .is('deleted_at', null)
          .order('starts_at', { ascending: true })
          .limit(500),
        ctx.clinicalDb
          .from('practitioner_profiles')
          .select('user_id, display_name, credentials, specialty')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .limit(100),
      ]);
      if (appts.error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load calendar' });
      }

      const profileRows = (practitioners.data ?? []) as unknown as Array<{
        user_id: string;
        display_name: string | null;
        credentials: string | null;
        specialty: string | null;
      }>;
      const names = new Map(
        profileRows
          .filter((p) => p.display_name)
          .map((p) => [p.user_id, p.display_name as string]),
      );

      const rows = (appts.data ?? []) as unknown as AppointmentRow[];
      return {
        appointments: rows.map((r) => mapAppointmentRow(r, names)),
        practitioners: profileRows.map((p) => ({
          userId: p.user_id,
          displayName: p.display_name,
          credentials: p.credentials,
          specialty: p.specialty,
        })),
      };
    }),

  /** Book via the 0017 RPC (validation + double-booking + audit, atomic). */
  book: organizationProcedure
    .input(
      z.object({
        practitionerUserId: z.string().uuid(),
        appointmentType: z.enum(APPOINTMENT_TYPES),
        startsAtIso: z.string().datetime({ offset: true }),
        endsAtIso: z.string().datetime({ offset: true }),
        patientId: z.string().uuid().optional(),
        location: z.string().max(200).optional(),
        telehealthUrl: z.string().url().max(500).optional(),
        title: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const i = input as {
        organizationId: string;
        practitionerUserId: string;
        appointmentType: (typeof APPOINTMENT_TYPES)[number];
        startsAtIso: string;
        endsAtIso: string;
        patientId?: string;
        location?: string;
        telehealthUrl?: string;
        title?: string;
      };
      const { data, error } = await ctx.clinicalDb.rpc('book_appointment', {
        _organization_id: i.organizationId,
        _practitioner_user_id: i.practitionerUserId,
        _appointment_type: i.appointmentType,
        _starts_at: i.startsAtIso,
        _ends_at: i.endsAtIso,
        _patient_id: i.patientId ?? null,
        _location: i.location ?? null,
        _telehealth_url: i.telehealthUrl ?? null,
        _title: i.title ?? null,
      });
      if (error) throwFromRpcError(error, 'book appointment');
      const json = data as unknown as { id: string; status: string; starts_at: string; ends_at: string };
      return {
        ok: true as const,
        id: json.id,
        status: json.status,
        startsAt: json.starts_at,
        endsAt: json.ends_at,
        message: 'Appointment booked.',
      };
    }),

  /** Status transition via the 0017 RPC (audited; terminal states idempotent). */
  updateStatus: clinicalAuthenticatedProcedure
    .input(
      z.object({
        appointmentId: z.string().uuid(),
        status: z.enum(STATUS_TARGETS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('update_appointment_status', {
        _appointment_id: input.appointmentId,
        _status: input.status,
      });
      if (error) throwFromRpcError(error, 'update appointment status');
      const json = data as unknown as {
        id: string;
        status: string;
        previous_status: string;
        already_set: boolean;
      };
      return {
        ok: true as const,
        id: json.id,
        status: json.status,
        previousStatus: json.previous_status,
        alreadySet: json.already_set,
        message: `Appointment ${json.status}.`,
      };
    }),

  /** Reschedule via the 0017 RPC (self-overlap excluded; audited). */
  reschedule: clinicalAuthenticatedProcedure
    .input(
      z.object({
        appointmentId: z.string().uuid(),
        startsAtIso: z.string().datetime({ offset: true }),
        endsAtIso: z.string().datetime({ offset: true }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('reschedule_appointment', {
        _appointment_id: input.appointmentId,
        _starts_at: input.startsAtIso,
        _ends_at: input.endsAtIso,
      });
      if (error) throwFromRpcError(error, 'reschedule appointment');
      const json = data as unknown as { id: string; status: string; starts_at: string; ends_at: string };
      return {
        ok: true as const,
        id: json.id,
        status: json.status,
        startsAt: json.starts_at,
        endsAt: json.ends_at,
        message: 'Appointment rescheduled.',
      };
    }),
});
