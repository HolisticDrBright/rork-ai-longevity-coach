// Shared access resolution + tolerant query helpers for reasoning-layer routers.

import { TRPCError } from '@trpc/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAppRoles } from '../../trpc/create-context';
import { writeAuditEvent } from './audit';

export interface ActorCtx {
  user: { id: string; email: string | undefined; role: string };
  sessionToken: string;
}

/**
 * Resolves which user's record is being accessed. Self-access is always
 * allowed; cross-user access requires practitioner/admin role AND an active,
 * patient-consented relationship. Cross-user access is audited.
 */
export async function resolveSubjectUserId(
  sb: SupabaseClient,
  ctx: ActorCtx,
  patientId: string | undefined,
  action: string
): Promise<string> {
  const target = patientId ?? ctx.user.id;
  if (target === ctx.user.id) return target;

  const roles = await getAppRoles(ctx.sessionToken, ctx.user.id);
  const isPractitioner = roles.includes('practitioner') || roles.includes('admin');
  if (!isPractitioner) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Practitioner role required' });
  }

  const { data, error } = await sb
    .from('practitioner_patient_relationships')
    .select('id, status')
    .eq('practitioner_id', ctx.user.id)
    .eq('patient_id', target)
    .eq('status', 'active')
    .limit(1);

  if (error || !data || data.length === 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'No active authorization for this patient',
    });
  }

  await writeAuditEvent(sb, {
    actorId: ctx.user.id,
    actorRole: 'practitioner',
    action,
    resourceType: 'patient_record',
    patientId: target,
  });

  return target;
}

/** Queries that tolerate missing tables (remote schema drift) return []. */
export async function safeRows(
  query: PromiseLike<{
    data: Record<string, unknown>[] | null;
    error: { code?: string; message?: string } | null;
  }>,
  label: string
): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await query;
    if (error) {
      console.log(`[Reasoning] ${label} query failed: ${error.code ?? 'unknown'}`);
      return [];
    }
    return data ?? [];
  } catch {
    console.log(`[Reasoning] ${label} query failed`);
    return [];
  }
}
