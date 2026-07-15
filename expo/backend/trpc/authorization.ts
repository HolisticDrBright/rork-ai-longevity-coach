import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { protectedProcedure } from "./create-context";

/**
 * Centralized authorization layer for tRPC procedures.
 *
 * Phase-1 goal (see docs/security-gap-analysis.md §4 and
 * docs/architecture-decisions/0003-centralized-authorization-and-org-model.md):
 * every protected call derives identity from the authenticated server context,
 * and patient/tenant access is enforced in ONE place rather than
 * re-implemented — or forgotten — per handler.
 *
 * Two token pools exist during the ADR-0002 transition
 * (AI_DESKTOP_PRO/docs/architecture-decisions/0002-identity-and-system-of-record.md):
 *   - LEGACY pool (mobile app, this file): `authenticatedProcedure` +
 *     `assertPatientAccess` against the legacy project, unchanged.
 *   - CLINICAL pool (desktop + future mobile): the org/role model now exists
 *     in the dedicated clinical project, so the former NOT_IMPLEMENTED stubs
 *     are real — implemented in ./clinical-authorization.ts and re-exported
 *     here. They validate tokens against the clinical project and enforce
 *     membership/role/patient access through RLS-scoped queries.
 *
 * IMPORTANT: `assertPatientAccess` is defense-in-depth at the application
 * layer. It does NOT replace Row Level Security. On the clinical project, RLS
 * (private.can_access_patient) is the enforcement of record, proven by
 * supabase/tests/practitioner_assignment_access.sql in AI_DESKTOP_PRO.
 */

/** A valid LEGACY-pool Supabase session is required (mobile app). */
export const authenticatedProcedure = protectedProcedure;

/**
 * Clinical-pool guards (dedicated project). See ./clinical-authorization.ts
 * for the implementations and their guarantees.
 */
export {
  clinicalAuthenticatedProcedure,
  organizationProcedure,
  practitionerProcedure,
  adminProcedure,
  patientAccessProcedure,
} from "./clinical-authorization";

/**
 * Assert that the authenticated clinician owns (is the responsible clinician
 * for) the given patient. Central implementation of the ownership check that
 * clinic handlers must run before reading or mutating patient-scoped data.
 *
 * Throws NOT_FOUND (not FORBIDDEN) on failure so the API does not disclose
 * whether a patient id exists under a different clinician.
 */
export async function assertPatientAccess(
  sb: SupabaseClient,
  patientId: string,
  clinicianId: string,
): Promise<void> {
  const { data, error } = await sb
    .from("clinic_patients")
    .select("id")
    .eq("id", patientId)
    .eq("clinician_id", clinicianId)
    .maybeSingle();

  if (error || !data) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Patient not found or access denied",
    });
  }
}
