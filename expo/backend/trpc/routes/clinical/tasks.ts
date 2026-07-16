import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter } from '../../create-context';
import {
  clinicalAuthenticatedProcedure,
  organizationProcedure,
} from '../../clinical-authorization';
import { throwFromRpcError } from './rpc-errors';

/**
 * clinical.tasks — the desktop's live review-queue namespace.
 *
 * Wire contract mirrors AI_DESKTOP_PRO `src/adapters/live-types.ts`
 * (LiveQueueItem / LiveResolveResult) and the committed contract fixture
 * `scripts/live-stub-server.mjs`.
 *
 * Reads run through the caller's RLS-scoped client — an unassigned
 * practitioner simply doesn't see those patients' items. The resolve write
 * goes through the `resolve_review_queue_item` SECURITY DEFINER RPC
 * (migration 0014): status update + append-only audit_events row, atomically,
 * idempotent, actor stamped from auth.uid() server-side.
 */

interface QueueRow {
  id: string;
  item_type: string;
  title: string | null;
  priority: string;
  status: string;
  patient_id: string | null;
  assignee_user_id: string | null;
  due_at: string | null;
  created_at: string;
  patient_profiles: { first_name: string | null; last_name: string | null } | null;
}

/** Map a review_queue_items row (+ patient join) to the desktop wire shape. */
export function mapQueueRow(row: QueueRow, callerUserId: string) {
  const p = row.patient_profiles;
  const patientName = p ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || null : null;
  return {
    id: row.id,
    itemType: row.item_type,
    title: row.title ?? '',
    priority: (['low', 'medium', 'high'].includes(row.priority) ? row.priority : 'medium') as
      | 'low'
      | 'medium'
      | 'high',
    status: row.status as 'open' | 'in_review' | 'resolved' | 'snoozed' | 'dismissed',
    patientId: row.patient_id,
    patientName,
    // Display-name join lands with practitioner_profiles wiring; "You" is the
    // one identity we can assert without it.
    assigneeName: row.assignee_user_id === callerUserId ? 'You' : null,
    dueAt: row.due_at,
    createdAt: row.created_at,
  };
}

interface ResolveJson {
  id: string;
  status: string;
  previous_status: string;
  already_resolved: boolean;
  audit_event_id?: string;
}

export const clinicalTasksRouter = createTRPCRouter({
  /** The org's review queue, RLS-scoped to patients the caller can access. */
  getQueue: organizationProcedure.query(async ({ ctx, input }) => {
    const { data, error } = await ctx.clinicalDb
      .from('review_queue_items')
      .select(
        'id, item_type, title, priority, status, patient_id, assignee_user_id, due_at, created_at, patient_profiles ( first_name, last_name )',
      )
      .eq('organization_id', (input as { organizationId: string }).organizationId)
      .neq('status', 'dismissed')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load review queue' });
    return (data ?? []).map((row) => mapQueueRow(row as unknown as QueueRow, ctx.clinicalUser.id));
  }),

  /** Resolve one item — RPC 0014 (atomic status + audit, idempotent). */
  resolve: clinicalAuthenticatedProcedure
    .input(z.object({ itemId: z.string().uuid(), note: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('resolve_review_queue_item', {
        _item_id: input.itemId,
        _note: input.note ?? null,
      });
      if (error) throwFromRpcError(error, 'resolve review item');
      const json = data as unknown as ResolveJson;
      return {
        id: json.id,
        status: json.status,
        previousStatus: json.previous_status,
        alreadyResolved: json.already_resolved,
        auditEventId: json.audit_event_id,
      };
    }),
});
