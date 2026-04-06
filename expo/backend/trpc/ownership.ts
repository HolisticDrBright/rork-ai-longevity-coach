import { TRPCError } from "@trpc/server";

/**
 * Verify that the authenticated user is accessing their own data.
 * For practitioner access to patient data, RLS handles it via clinician_id scoping.
 * This check prevents authenticated users from querying arbitrary user IDs.
 */
export function assertOwnership(ctxUserId: string, inputUserId: string): void {
  if (ctxUserId !== inputUserId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can only access your own data",
    });
  }
}

/**
 * Sanitize a UUID string to prevent injection in Supabase filter interpolation.
 * UUIDs should only contain hex chars and dashes.
 */
export function assertValidUUID(value: string, fieldName = "id"): void {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(value)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid ${fieldName} format`,
    });
  }
}
