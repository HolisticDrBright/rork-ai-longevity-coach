// Server-side audit writer. Best-effort (never blocks the request) but loud in
// logs on failure. `details` must contain identifiers/metadata only — no PHI values.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditInput {
  actorId: string;
  actorRole?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  patientId?: string;
  details?: Record<string, unknown>;
}

export async function writeAuditEvent(sb: SupabaseClient, input: AuditInput): Promise<void> {
  try {
    const { error } = await sb.from('audit_events').insert({
      actor_id: input.actorId,
      actor_role: input.actorRole ?? null,
      action: input.action,
      resource_type: input.resourceType,
      resource_id: input.resourceId ?? null,
      patient_id: input.patientId ?? null,
      details: input.details ?? {},
    });
    if (error) {
      console.log(`[Audit] Failed to record ${input.action}: ${error.code ?? 'unknown'}`);
    }
  } catch {
    console.log(`[Audit] Failed to record ${input.action}`);
  }
}
