import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter } from '../../create-context';
import { clinicalAuthenticatedProcedure } from '../../clinical-authorization';
import { throwFromRpcError } from './rpc-errors';
import { AuditValidationError, buildRegistryEvent } from './audit-registry';

/**
 * clinical.actions — persistent audit + downstream-task namespace.
 *
 * Every write goes through a SECURITY DEFINER RPC (migrations 0013/0018) that
 * authorizes the CALLER in-function (org membership / patient access / the
 * patient∈org tenant check) and stamps actor ids from auth.uid().
 *
 * recordAudit is REGISTRY-ONLY (Phase 0): the browser names a registered
 * event type; the stored action, resource type, display text, and permitted
 * metadata keys are all server-owned (audit-registry.ts). Free-form
 * safe_message / metadata from clients is no longer accepted anywhere.
 */

interface AuditRowJson {
  id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  safe_message: string | null;
  metadata: Record<string, unknown>;
  patient_id: string | null;
  actor_user_id: string | null;
  occurred_at: string;
}

/** Map a list_audit_events row to the desktop wire shape (LiveAuditEvent). */
export function mapAuditRow(row: AuditRowJson) {
  return {
    id: row.id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    safeMessage: row.safe_message,
    metadata: row.metadata ?? {},
    patientId: row.patient_id,
    actorUserId: row.actor_user_id,
    occurredAt: row.occurred_at,
  };
}

export const clinicalActionsRouter = createTRPCRouter({
  /**
   * Append one registry-validated audit event (RPC: record_audit_event,
   * hardened in 0018 with the patient∈organization tenant check + size caps).
   */
  recordAudit: clinicalAuthenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        eventType: z.string().min(1).max(64),
        resourceId: z.string().max(128).nullish(),
        patientId: z.string().uuid().nullish(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let event: ReturnType<typeof buildRegistryEvent>;
      try {
        event = buildRegistryEvent({
          eventType: input.eventType,
          patientId: input.patientId,
          resourceId: input.resourceId,
          metadata: input.metadata,
        });
      } catch (e) {
        if (e instanceof AuditValidationError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: e.message });
        }
        throw e;
      }
      const { data, error } = await ctx.clinicalDb.rpc('record_audit_event', {
        _organization_id: input.organizationId,
        _action: event.action,
        _resource_type: event.resourceType,
        _resource_id: event.resourceId,
        _safe_message: event.safeMessage,
        _patient_id: input.patientId ?? null,
        _metadata: event.metadata,
      });
      if (error) throwFromRpcError(error, 'record audit event');
      return { id: data as unknown as string };
    }),

  /** The caller's audit events (all org events if org admin) — RPC 0013. */
  listAuditEvents: clinicalAuthenticatedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('list_audit_events', {
        _organization_id: input.organizationId,
        _limit: input.limit,
      });
      if (error) throwFromRpcError(error, 'list audit events');
      return ((data ?? []) as unknown as AuditRowJson[]).map(mapAuditRow);
    }),

  /** Enqueue a review task for a patient + audit (RPC: create_review_task). */
  createReviewTask: clinicalAuthenticatedProcedure
    .input(
      z.object({
        patientId: z.string().uuid(),
        title: z.string().min(1).max(300),
        itemType: z.string().max(60).default('abnormal_result'),
        priority: z.enum(['low', 'medium', 'high']).default('medium'),
        refId: z.string().uuid().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('create_review_task', {
        _patient_id: input.patientId,
        _title: input.title,
        _item_type: input.itemType,
        _priority: input.priority,
        _ref_id: input.refId ?? null,
      });
      if (error) throwFromRpcError(error, 'create review task');
      const json = data as unknown as { id: string; status: string };
      return { ok: true as const, id: json.id, status: json.status, message: 'Review task created.' };
    }),
});
