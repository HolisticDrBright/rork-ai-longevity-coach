import { createTRPCRouter } from '../../create-context';
import {
  clinicalAuthenticatedProcedure,
  organizationProcedure,
  patientAccessProcedure,
} from '../../clinical-authorization';

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

  organizations: createTRPCRouter({
    /** Organizations the caller belongs to (own memberships only, via RLS). */
    mine: clinicalAuthenticatedProcedure.query(async ({ ctx }) => {
      const { data, error } = await ctx.clinicalDb
        .from('organization_memberships')
        .select('role, status, organizations ( id, name, slug )')
        .eq('user_id', ctx.clinicalUser.id)
        .eq('status', 'active');
      if (error) throw new Error('Failed to load memberships');
      return (data ?? []).map((m) => {
        const org = m.organizations as unknown as { id: string; name: string; slug: string } | null;
        return {
          organizationId: org?.id ?? null,
          name: org?.name ?? null,
          slug: org?.slug ?? null,
          role: m.role as string,
        };
      });
    }),
  }),

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
