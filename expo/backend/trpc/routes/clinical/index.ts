import { createTRPCRouter } from '../../create-context';
import {
  clinicalAuthenticatedProcedure,
  organizationProcedure,
  patientAccessProcedure,
} from '../../clinical-authorization';
import { clinicalActionsRouter } from './actions';
import { clinicalEncountersRouter, clinicalNotesRouter } from './emr';
import { clinicalOrganizationsRouter } from './organizations';
import { clinicalLabsRouter } from './labs';
import { clinicalLensRouter } from './lens';
import { clinicalScheduleRouter } from './schedule';
import { clinicalScribeRouter } from './scribe';
import { clinicalTasksRouter } from './tasks';

/**
 * Clinical-project namespace (ADR 0002). Every procedure here runs against the
 * DEDICATED clinical project through the caller's RLS-scoped client — the
 * database gates (org membership, private.can_access_patient) are the
 * enforcement of record; the procedure helpers translate them into typed
 * errors. The desktop app consumes this namespace; it never talks to
 * Supabase/Postgres directly.
 */

export const clinicalRouter = createTRPCRouter({
  /** Verified identity echo — the smallest possible authenticated round-trip. */
  whoami: clinicalAuthenticatedProcedure.query(({ ctx }) => ({
    userId: ctx.clinicalUser.id,
    email: ctx.clinicalUser.email ?? null,
  })),

  /** Review queue reads + resolve (RPC 0014). Desktop: api.tasks.*. */
  tasks: clinicalTasksRouter,

  /** Labs workspace read + marker review (RPC 0013). Desktop: api.labs.*. */
  labs: clinicalLabsRouter,

  /** Persistent audit + downstream tasks (RPCs 0013). Desktop: api.actions.*. */
  actions: clinicalActionsRouter,

  /** Calendar reads + book/status/reschedule (RPCs 0017). Desktop: api.schedule.*. */
  schedule: clinicalScheduleRouter,

  /** Memberships, roster, invite/role/remove (RPCs 0020). Desktop: api + settings. */
  organizations: clinicalOrganizationsRouter,

  /** Encounters + state machine (RPCs 0021). Desktop: encounter workspace. */
  encounters: clinicalEncountersRouter,

  /** Clinical notes: draft/sign/addendum/timeline (RPCs 0021). */
  notes: clinicalNotesRouter,

  /** Consent-gated recording + AI scribe (RPCs 0022/0023). Draft-only output. */
  scribe: clinicalScribeRouter,

  /** Differential questions + lens engine (RPCs 0024). Question-focused only. */
  lens: clinicalLensRouter,

  patients: createTRPCRouter({
    /**
     * Patients visible to the caller in one org. RLS does the filtering:
     * an unassigned practitioner gets an empty list, not an error.
     */
    list: organizationProcedure.query(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb
        .from('patient_profiles')
        .select('id, mrn, first_name, last_name, date_of_birth, sex, status')
        .eq('organization_id', (input as { organizationId: string }).organizationId)
        .order('last_name', { ascending: true });
      if (error) throw new Error('Failed to load patients');
      return data ?? [];
    }),

    /** One patient, through the can_access_patient gate. */
    get: patientAccessProcedure.query(async ({ ctx }) => {
      const { data, error } = await ctx.clinicalDb
        .from('patient_profiles')
        .select('id, organization_id, mrn, first_name, last_name, date_of_birth, sex, status, created_at')
        .eq('id', ctx.patient.id)
        .maybeSingle();
      if (error || !data) throw new Error('Failed to load patient');
      return data;
    }),
  }),
});
