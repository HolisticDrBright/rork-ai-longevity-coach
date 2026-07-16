import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter } from '../../create-context';
import {
  clinicalAuthenticatedProcedure,
  organizationProcedure,
  patientAccessProcedure,
} from '../../clinical-authorization';
import { throwFromRpcError } from './rpc-errors';

/**
 * EMR charting slice (Phase 2, slice 1): encounters + clinical notes.
 *
 * The database is the authority — every mutation goes through a SECURITY
 * DEFINER RPC (AI_DESKTOP_PRO migration 0021) that enforces the state
 * machines, the clinical-role gate, tenant agreement (appointment ↔
 * encounter ↔ patient ↔ organization), signed-note immutability, idempotent
 * signing, and atomic audit. These procedures add typed inputs, wire
 * mapping, and honest error translation (incl. 40001 → CONFLICT for the
 * composer's conflict view). Reads run under the caller's RLS.
 */

const VISIT_TYPES = [
  'initial',
  'follow-up',
  'lab-review',
  'supplement',
  'telehealth',
  'acute',
  'administrative',
] as const;

const NOTE_TYPES = ['soap', 'narrative', 'follow_up', 'adime', 'patient_instructions'] as const;

const PROVENANCE_TYPES = [
  'appointment',
  'encounter',
  'lab_observation',
  'lab_document',
  'patient_form',
  'chart_item',
  'practitioner_entered',
] as const;

/** Note content: named sections of practitioner-authored text. */
const contentSchema = z.record(z.string().max(60), z.string().max(65536)).refine(
  (obj) => Object.keys(obj).length <= 24,
  { message: 'too many sections' },
);

const provenanceSchema = z
  .array(
    z.object({
      sectionKey: z.string().min(1).max(60),
      refType: z.enum(PROVENANCE_TYPES),
      refId: z.string().uuid().optional(),
      label: z.string().min(1).max(200),
    }),
  )
  .max(50);

interface EncounterRow {
  id: string;
  organization_id: string;
  patient_id: string;
  appointment_id: string | null;
  encounter_type: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  status_reason: string | null;
  created_at: string;
}

function mapEncounter(e: EncounterRow) {
  return {
    encounterId: e.id,
    organizationId: e.organization_id,
    patientId: e.patient_id,
    appointmentId: e.appointment_id,
    visitType: e.encounter_type,
    status: e.status as
      | 'scheduled'
      | 'in_progress'
      | 'completed'
      | 'cancelled'
      | 'entered_in_error',
    startedAt: e.started_at,
    endedAt: e.ended_at,
    statusReason: e.status_reason,
    createdAt: e.created_at,
  };
}

interface NoteRow {
  id: string;
  encounter_id: string;
  patient_id: string;
  note_type: string;
  status: string;
  current_version: number;
  author_user_id: string;
  status_reason: string | null;
  created_at: string;
  updated_at: string;
}

function mapNote(n: NoteRow) {
  return {
    noteId: n.id,
    encounterId: n.encounter_id,
    patientId: n.patient_id,
    noteType: n.note_type as (typeof NOTE_TYPES)[number],
    status: n.status as 'draft' | 'ready_for_review' | 'signed' | 'amended' | 'entered_in_error',
    currentVersion: n.current_version,
    authorUserId: n.author_user_id,
    statusReason: n.status_reason,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  };
}

export const clinicalEncountersRouter = createTRPCRouter({
  /** Start (or idempotently resume) an encounter, optionally from an appointment. */
  start: organizationProcedure
    .input(
      z.object({
        patientId: z.string().uuid(),
        visitType: z.enum(VISIT_TYPES).default('follow-up'),
        appointmentId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, patientId, visitType, appointmentId } = input as {
        organizationId: string;
        patientId: string;
        visitType: (typeof VISIT_TYPES)[number];
        appointmentId?: string;
      };
      const { data, error } = await ctx.clinicalDb.rpc('start_encounter', {
        _organization_id: organizationId,
        _patient_id: patientId,
        _visit_type: visitType,
        _appointment_id: appointmentId ?? null,
      });
      if (error) throwFromRpcError(error, 'start encounter');
      return { encounterId: data as string };
    }),

  /** Explicit state machine transitions: completed / cancelled / entered_in_error. */
  setStatus: clinicalAuthenticatedProcedure
    .input(
      z.object({
        encounterId: z.string().uuid(),
        status: z.enum(['completed', 'cancelled', 'entered_in_error']),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('set_encounter_status', {
        _encounter_id: input.encounterId,
        _status: input.status,
        _reason: input.reason ?? null,
      });
      if (error) throwFromRpcError(error, 'update encounter');
      return { ok: true as const };
    }),

  /** One encounter + its notes (workspace load). RLS-scoped reads. */
  get: clinicalAuthenticatedProcedure
    .input(z.object({ encounterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: enc, error } = await ctx.clinicalDb
        .from('encounters')
        .select(
          'id, organization_id, patient_id, appointment_id, encounter_type, status, started_at, ended_at, status_reason, created_at',
        )
        .eq('id', input.encounterId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw new Error('Failed to load encounter');
      if (!enc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Encounter not found or access denied' });
      }

      const { data: notes, error: nErr } = await ctx.clinicalDb
        .from('clinical_notes')
        .select(
          'id, encounter_id, patient_id, note_type, status, current_version, author_user_id, status_reason, created_at, updated_at',
        )
        .eq('encounter_id', input.encounterId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (nErr) throw new Error('Failed to load notes');

      return {
        encounter: mapEncounter(enc as EncounterRow),
        notes: ((notes ?? []) as NoteRow[]).map(mapNote),
      };
    }),

  /** Encounters for one patient (chart access gate). */
  forPatient: patientAccessProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.clinicalDb
      .from('encounters')
      .select(
        'id, organization_id, patient_id, appointment_id, encounter_type, status, started_at, ended_at, status_reason, created_at',
      )
      .eq('patient_id', ctx.patient.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error('Failed to load encounters');
    return ((data ?? []) as EncounterRow[]).map(mapEncounter);
  }),
});

export const clinicalNotesRouter = createTRPCRouter({
  /**
   * Autosave / explicit save. Optimistic concurrency: expectedVersion must
   * match the server's current version or the save is refused with CONFLICT
   * and the composer shows the side-by-side conflict view. "Saved" must only
   * ever be shown after this returns.
   */
  save: organizationProcedure
    .input(
      z.object({
        encounterId: z.string().uuid(),
        noteType: z.enum(NOTE_TYPES),
        content: contentSchema,
        expectedVersion: z.number().int().min(0),
        noteId: z.string().uuid().optional(),
        saveKind: z.enum(['autosave', 'manual']).default('autosave'),
        provenance: provenanceSchema.default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, encounterId, noteType, content, expectedVersion, noteId, saveKind, provenance } =
        input as {
          organizationId: string;
          encounterId: string;
          noteType: (typeof NOTE_TYPES)[number];
          content: Record<string, string>;
          expectedVersion: number;
          noteId?: string;
          saveKind: 'autosave' | 'manual';
          provenance: z.infer<typeof provenanceSchema>;
        };
      const { data, error } = await ctx.clinicalDb.rpc('save_note_draft', {
        _organization_id: organizationId,
        _encounter_id: encounterId,
        _note_type: noteType,
        _content: content,
        _expected_version: expectedVersion,
        _note_id: noteId ?? null,
        _save_kind: saveKind,
        _provenance: provenance,
      });
      if (error) throwFromRpcError(error, 'save note');
      const json = data as { note_id: string; version: number; saved_at: string };
      return { noteId: json.note_id, version: json.version, savedAt: json.saved_at };
    }),

  /**
   * Full note for the composer: metadata, the AUTHORITATIVE latest content,
   * signature, addenda, and provenance refs. Used for initial load and for
   * post-refresh / conflict recovery.
   */
  get: clinicalAuthenticatedProcedure
    .input(z.object({ noteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: note, error } = await ctx.clinicalDb
        .from('clinical_notes')
        .select(
          'id, encounter_id, patient_id, note_type, status, current_version, author_user_id, status_reason, created_at, updated_at',
        )
        .eq('id', input.noteId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) throw new Error('Failed to load note');
      if (!note) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Note not found or access denied' });
      }
      const n = note as NoteRow;

      const [{ data: version }, { data: signature }, { data: addenda }, { data: refs }] =
        await Promise.all([
          ctx.clinicalDb
            .from('clinical_note_versions')
            .select('version, content, content_sha256, save_kind, created_at')
            .eq('note_id', n.id)
            .eq('version', n.current_version)
            .maybeSingle(),
          ctx.clinicalDb
            .from('note_signatures')
            .select('id, note_version, content_sha256, signed_by, signed_at, attestation')
            .eq('note_id', n.id)
            .maybeSingle(),
          ctx.clinicalDb
            .from('note_addenda')
            .select('id, referenced_version, author_user_id, reason, content, created_at')
            .eq('note_id', n.id)
            .order('created_at', { ascending: true }),
          ctx.clinicalDb
            .from('note_provenance_refs')
            .select('section_key, ref_type, ref_id, label')
            .eq('note_id', n.id),
        ]);

      const v = version as { version: number; content: Record<string, string>; content_sha256: string; save_kind: string; created_at: string } | null;
      const s = signature as { id: string; note_version: number; content_sha256: string; signed_by: string; signed_at: string; attestation: string } | null;

      return {
        note: mapNote(n),
        content: v?.content ?? {},
        contentVersion: v?.version ?? 0,
        lastSavedAt: v?.created_at ?? null,
        signature: s
          ? {
              signatureId: s.id,
              version: s.note_version,
              signedBy: s.signed_by,
              signedAt: s.signed_at,
              attestation: s.attestation,
            }
          : null,
        addenda: ((addenda ?? []) as {
          id: string;
          referenced_version: number;
          author_user_id: string;
          reason: string;
          content: string;
          created_at: string;
        }[]).map((a) => ({
          addendumId: a.id,
          referencedVersion: a.referenced_version,
          authorUserId: a.author_user_id,
          reason: a.reason,
          content: a.content,
          createdAt: a.created_at,
        })),
        provenance: ((refs ?? []) as {
          section_key: string;
          ref_type: string;
          ref_id: string | null;
          label: string;
        }[]).map((r) => ({
          sectionKey: r.section_key,
          refType: r.ref_type as (typeof PROVENANCE_TYPES)[number],
          refId: r.ref_id,
          label: r.label,
        })),
      };
    }),

  markReady: clinicalAuthenticatedProcedure
    .input(z.object({ noteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('mark_note_ready', { _note_id: input.noteId });
      if (error) throwFromRpcError(error, 'mark ready');
      return { ok: true as const };
    }),

  /** Idempotent: re-signing the same version returns alreadySigned=true. */
  sign: clinicalAuthenticatedProcedure
    .input(z.object({ noteId: z.string().uuid(), expectedVersion: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('sign_note', {
        _note_id: input.noteId,
        _expected_version: input.expectedVersion,
      });
      if (error) throwFromRpcError(error, 'sign note');
      const json = data as {
        signature_id: string;
        already_signed: boolean;
        version: number;
        signed_at: string;
      };
      return {
        signatureId: json.signature_id,
        alreadySigned: json.already_signed,
        version: json.version,
        signedAt: json.signed_at,
      };
    }),

  addAddendum: clinicalAuthenticatedProcedure
    .input(
      z.object({
        noteId: z.string().uuid(),
        reason: z.string().min(1).max(500),
        content: z.string().min(1).max(65536),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('add_note_addendum', {
        _note_id: input.noteId,
        _reason: input.reason,
        _content: input.content,
      });
      if (error) throwFromRpcError(error, 'add addendum');
      return { addendumId: data as string };
    }),

  markError: clinicalAuthenticatedProcedure
    .input(z.object({ noteId: z.string().uuid(), reason: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('mark_note_error', {
        _note_id: input.noteId,
        _reason: input.reason,
      });
      if (error) throwFromRpcError(error, 'mark entered in error');
      return { ok: true as const };
    }),

  /** Longitudinal CLINICAL timeline — never the security audit trail. */
  timeline: patientAccessProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.clinicalDb.rpc('get_patient_timeline', {
      _patient_id: ctx.patient.id,
    });
    if (error) throwFromRpcError(error, 'load timeline');
    return ((data ?? []) as {
      event_at: string;
      event_type: string;
      title: string;
      ref_type: string;
      ref_id: string;
      detail: Record<string, unknown>;
    }[]).map((r) => ({
      eventAt: r.event_at,
      eventType: r.event_type,
      title: r.title,
      refType: r.ref_type,
      refId: r.ref_id,
      detail: r.detail ?? {},
    }));
  }),
});
