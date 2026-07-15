import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase clients for the DEDICATED clinical project (ADR 0001/0002 in
 * AI_DESKTOP_PRO/docs/architecture-decisions/). This is a different project —
 * and a different auth.users pool — from the legacy clients in
 * `supabase-server.ts`, which continue to serve the mobile app until the
 * identity cutover.
 *
 * Env (server-side only; see backend/ENV.md):
 *   CLINICAL_SUPABASE_URL              — project URL
 *   CLINICAL_SUPABASE_ANON_KEY         — anon key (token validation + RLS-scoped clients)
 *   CLINICAL_SUPABASE_SERVICE_ROLE_KEY — service role; NEVER reachable from client
 *                                        input paths, used only for privileged
 *                                        server operations (e.g. invitation claim).
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `[clinical-supabase] ${name} is not set — the clinical project is not configured for this environment`,
    );
  }
  return v;
}

/** Anon client — used to validate user JWTs against the clinical project. */
export function createClinicalAnonClient(): SupabaseClient {
  return createClient(requireEnv('CLINICAL_SUPABASE_URL'), requireEnv('CLINICAL_SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * User-scoped client — carries the caller's JWT so every query runs under
 * Row Level Security as that user. This is the enforcement path: procedures
 * read/write through this client, and the database gates
 * (private.can_access_patient & friends) decide.
 */
export function createClinicalUserClient(accessToken: string): SupabaseClient {
  return createClient(requireEnv('CLINICAL_SUPABASE_URL'), requireEnv('CLINICAL_SUPABASE_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * Service-role client — bypasses RLS. Server-side only, for privileged
 * operations that are never parameterized directly by client input without
 * their own explicit authorization (invitation claim, staged import commit).
 * Do not pass this into request handlers as a general-purpose database handle.
 */
export function createClinicalServiceClient(): SupabaseClient {
  return createClient(
    requireEnv('CLINICAL_SUPABASE_URL'),
    requireEnv('CLINICAL_SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
