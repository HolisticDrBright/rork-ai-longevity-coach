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
 * Current reality: the app has Supabase-authenticated users but no
 * organization / role model yet (the schema is not even in version control —
 * see docs/database-inventory.md). So:
 *   - `authenticatedProcedure` is available now (identical to the existing
 *     protectedProcedure; the new name is the forward-looking one).
 *   - `assertPatientAccess` centralizes the clinician→patient ownership check
 *     that clinic handlers must run, using the columns that already exist.
 *   - `organizationProcedure` / `practitionerProcedure` / `adminProcedure`
 *     depend on the org/role model that does not exist yet, so they are
 *     explicit NOT_IMPLEMENTED stubs — wiring them up must wait for the
 *     organization migration, and they fail loudly instead of silently
 *     under-enforcing in the meantime.
 *
 * IMPORTANT: `assertPatientAccess` is defense-in-depth at the application
 * layer. It does NOT replace Row Level Security. RLS remains the enforcement
 * of record and must be authored/verified separately once the live schema is
 * captured (see docs/security-gap-analysis.md §3).
 */

/** A valid Supabase session is required. Same behavior as protectedProcedure. */
export const authenticatedProcedure = protectedProcedure;

function notImplementedProcedure(name: string) {
  return protectedProcedure.use(async () => {
    throw new TRPCError({
      code: "NOT_IMPLEMENTED",
      message: `${name} requires the organization/role model (Phase-1 organization migration), which is not available yet.`,
    });
  });
}

/** Requires org membership — stub until the organization model exists. */
export const organizationProcedure = notImplementedProcedure("organizationProcedure");
/** Requires a practitioner role — stub until the role model exists. */
export const practitionerProcedure = notImplementedProcedure("practitionerProcedure");
/** Requires an admin role — stub until the role model exists. */
export const adminProcedure = notImplementedProcedure("adminProcedure");

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
