import { TRPCError } from '@trpc/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { publicProcedure } from './create-context';
import { createClinicalAnonClient, createClinicalUserClient } from '../clinical-supabase';

/**
 * Authenticated procedure helpers for the DEDICATED clinical project
 * (ADR 0002: single identity provider, clinical project = system of record).
 *
 * Design rules (server-layer slice, Item 3):
 *  - Identity comes ONLY from the verified server session: the bearer token is
 *    validated against the clinical project's auth server. `organization_id`,
 *    patient ownership, and roles are NEVER trusted from client input — every
 *    guard re-derives them server-side from the database.
 *  - Authorization is NOT reimplemented in TypeScript. Queries run through a
 *    user-scoped client (the caller's JWT), so Row Level Security — including
 *    private.can_access_patient() — is the enforcement of record. The guards
 *    here read back what the database allows and translate "nothing visible"
 *    into typed tRPC errors.
 *  - The service-role client is never attached to request context; privileged
 *    operations construct it explicitly, server-side, per call site.
 */

export interface ClinicalUser {
  id: string;
  email: string | undefined;
}

export type OrgRole = 'owner' | 'admin' | 'practitioner' | 'staff' | 'member';

const PRACTITIONER_ROLES: OrgRole[] = ['practitioner', 'admin', 'owner'];
const ADMIN_ROLES: OrgRole[] = ['admin', 'owner'];

/**
 * Valid clinical-project session required. Validates the bearer token against
 * the clinical project's auth server and attaches:
 *  - `clinicalUser` — the verified identity
 *  - `clinicalDb`   — a user-scoped client; all queries run under RLS as the caller
 */
export const clinicalAuthenticatedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.sessionToken) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }

  let user: ClinicalUser | null = null;
  try {
    const anon = createClinicalAnonClient();
    const { data, error } = await anon.auth.getUser(ctx.sessionToken);
    if (!error && data?.user) {
      user = { id: data.user.id, email: data.user.email };
    }
  } catch {
    // fall through to the UNAUTHORIZED below; never log the token
  }

  if (!user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }

  return next({
    ctx: {
      ...ctx,
      clinicalUser: user,
      clinicalDb: createClinicalUserClient(ctx.sessionToken) as SupabaseClient,
    },
  });
});

const orgInput = z.object({ organizationId: z.string().uuid() });

/**
 * Caller must be an ACTIVE member of the target organization. Membership and
 * role are read server-side from organization_memberships under the caller's
 * own RLS view (a user can only see their own membership rows). Attaches
 * `membership: { organizationId, role }`.
 */
export const organizationProcedure = clinicalAuthenticatedProcedure
  .input(orgInput)
  .use(async ({ ctx, input, next }) => {
    const { organizationId } = input as z.infer<typeof orgInput>;
    const { data, error } = await ctx.clinicalDb
      .from('organization_memberships')
      .select('role, status')
      .eq('organization_id', organizationId)
      .eq('user_id', ctx.clinicalUser.id)
      .eq('status', 'active')
      .maybeSingle();

    if (error || !data) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this organization' });
    }

    return next({
      ctx: { ...ctx, membership: { organizationId, role: data.role as OrgRole } },
    });
  });

function requireRole(allowed: OrgRole[], label: string) {
  return organizationProcedure.use(async ({ ctx, next }) => {
    if (!allowed.includes(ctx.membership.role)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `${label} role required` });
    }
    return next({ ctx });
  });
}

/** Caller holds practitioner, admin, or owner role in the target org. */
export const practitionerProcedure = requireRole(PRACTITIONER_ROLES, 'Practitioner');

/**
 * Caller holds admin or owner role. Privileged service-role operations are a
 * separate, server-side-only concern — this gate covers admin UI actions, not
 * service internals.
 */
export const adminProcedure = requireRole(ADMIN_ROLES, 'Administrator');

const patientInput = z.object({ patientId: z.string().uuid() });

/**
 * Caller must pass private.can_access_patient() for the target patient.
 * We do not reimplement that logic in TS: the SELECT policy on
 * patient_profiles IS `can_access_patient(id)`, so reading the row through
 * the caller's RLS-scoped client exercises the database gate itself. No row
 * ⇒ the gate said no ⇒ NOT_FOUND (never FORBIDDEN, to avoid disclosing that
 * a patient id exists outside the caller's scope). Attaches
 * `patient: { id, organizationId }`.
 */
export const patientAccessProcedure = clinicalAuthenticatedProcedure
  .input(patientInput)
  .use(async ({ ctx, input, next }) => {
    const { patientId } = input as z.infer<typeof patientInput>;
    const { data, error } = await ctx.clinicalDb
      .from('patient_profiles')
      .select('id, organization_id')
      .eq('id', patientId)
      .maybeSingle();

    if (error || !data) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Patient not found or access denied' });
    }

    return next({
      ctx: { ...ctx, patient: { id: data.id as string, organizationId: data.organization_id as string } },
    });
  });
