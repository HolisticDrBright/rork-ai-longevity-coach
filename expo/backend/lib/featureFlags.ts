/**
 * Feature flag helper.
 *
 * Flags live in the `feature_flags` Supabase table (see migration 008).
 * A flag is considered enabled for a user if ANY of these match:
 *   - the user's id is in `enabled_user_ids`
 *   - ANY of the user's roles from `user_roles` is in `enabled_roles`
 *   - the user's id hashes into the first `rollout_pct`% of the user space
 *
 * The rollout bucket uses a stable deterministic hash of the user id so a
 * given user always lands in the same bucket for the same flag.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface FlagUser {
  id: string;
  roles?: string[];
}

interface FlagRow {
  key: string;
  enabled_user_ids: string[] | null;
  enabled_roles: string[] | null;
  rollout_pct: number | null;
}

/**
 * djb2-ish hash producing a 0-99 bucket for a `{userId, flagKey}` pair.
 * Stable across processes; no crypto-strength guarantees needed.
 */
function bucketFor(userId: string, flagKey: string): number {
  const input = `${flagKey}:${userId}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  return Math.abs(hash) % 100;
}

export async function isFlagEnabled(
  sb: SupabaseClient,
  flagKey: string,
  user: FlagUser,
): Promise<boolean> {
  const { data: flag, error } = await sb
    .from('feature_flags')
    .select('key, enabled_user_ids, enabled_roles, rollout_pct')
    .eq('key', flagKey)
    .maybeSingle();

  if (error || !flag) {
    // Fail closed — missing flag means not enabled. Callers fall back to
    // the deterministic path, which is the safe default.
    return false;
  }

  const row = flag as FlagRow;

  if ((row.enabled_user_ids ?? []).includes(user.id)) return true;

  const userRoles = user.roles ?? [];
  if ((row.enabled_roles ?? []).some(r => userRoles.includes(r))) return true;

  const pct = row.rollout_pct ?? 0;
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  return bucketFor(user.id, flagKey) < pct;
}

export async function listFlags(sb: SupabaseClient) {
  const { data, error } = await sb
    .from('feature_flags')
    .select('*')
    .order('key');
  if (error) throw error;
  return data ?? [];
}

export async function setFlag(
  sb: SupabaseClient,
  flagKey: string,
  updates: {
    enabledUserIds?: string[];
    enabledRoles?: string[];
    rolloutPct?: number;
    description?: string;
    updatedBy?: string;
  },
) {
  const dbUpdates: Record<string, any> = { updated_by: updates.updatedBy };
  if (updates.enabledUserIds !== undefined) dbUpdates.enabled_user_ids = updates.enabledUserIds;
  if (updates.enabledRoles !== undefined) dbUpdates.enabled_roles = updates.enabledRoles;
  if (updates.rolloutPct !== undefined) dbUpdates.rollout_pct = updates.rolloutPct;
  if (updates.description !== undefined) dbUpdates.description = updates.description;

  const { data, error } = await sb
    .from('feature_flags')
    .update(dbUpdates)
    .eq('key', flagKey)
    .select()
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getUserRoles(sb: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await sb.from('user_roles').select('role').eq('user_id', userId);
  return (data ?? []).map((r: { role: string }) => r.role);
}
