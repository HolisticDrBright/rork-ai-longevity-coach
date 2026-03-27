import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { clinicianProcedure, createTRPCRouter } from "../../create-context";
import { createServerSupabaseClient } from "../../../supabase-server";
import type {
  AlertRule,
  AlertEvent,
  AlertSummary,
  AlertSeverity,
  AlertEventStatus,
  AlertRuleCategory,
  PaginatedResponse,
} from "@/types/clinic";
import { mapDbToAlertRule, mapDbToAlertEvent } from "./utils";

const conditionSchema = z.object({
  event: z.string().optional(),
  metric: z.string().optional(),
  labCode: z.string().optional(),
  operator: z.enum(['>', '<', '>=', '<=', '==', '!=']).optional(),
  value: z.number().optional(),
  count: z.number().optional(),
  windowHours: z.number().optional(),
  durationMinutes: z.number().optional(),
});

export const alertsRouter = createTRPCRouter({
  listRules: clinicianProcedure
    .input(
      z.object({
        scope: z.enum(['global', 'patient']).optional(),
        patientId: z.string().optional(),
        category: z.enum(['lab', 'biometric', 'upload', 'adherence', 'symptom']).optional(),
        enabledOnly: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }): Promise<AlertRule[]> => {
      console.log('[Alerts] Listing alert rules');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      let query = sb.from('clinic_alert_rules').select('*');

      if (input.scope) query = query.eq('scope', input.scope);
      if (input.patientId) {
        query = query.or(`scope.eq.global,patient_id.eq.${input.patientId}`);
      }
      if (input.category) query = query.eq('category', input.category);
      if (input.enabledOnly) query = query.eq('is_enabled', true);

      query = query.order('severity');

      const { data, error } = await query;
      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list alert rules' });
      }

      return (data ?? []).map((r: Record<string, unknown>) => mapDbToAlertRule(r));
    }),

  createRule: clinicianProcedure
    .input(
      z.object({
        scope: z.enum(['global', 'patient']),
        patientId: z.string().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        category: z.enum(['lab', 'biometric', 'upload', 'adherence', 'symptom']),
        triggerType: z.enum(['event', 'threshold', 'pattern', 'scheduled']),
        condition: conditionSchema,
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
        notifyChannels: z.array(z.enum(['in_app', 'email', 'sms', 'push'])).default(['in_app']),
        notifyRoles: z.array(z.enum(['clinician', 'staff', 'patient'])).default(['clinician']),
        dedupeWindowMinutes: z.number().min(0).default(60),
        quietHoursStart: z.string().optional(),
        quietHoursEnd: z.string().optional(),
        createdBy: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }): Promise<AlertRule> => {
      console.log('[Alerts] Creating alert rule');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      if (input.scope === 'patient' && !input.patientId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Patient ID required for patient-scoped rules' });
      }

      const { data, error } = await sb
        .from('clinic_alert_rules')
        .insert({
          clinician_id: ctx.user.id,
          scope: input.scope,
          patient_id: input.patientId,
          name: input.name,
          description: input.description,
          category: input.category,
          trigger_type: input.triggerType,
          condition: input.condition,
          severity: input.severity,
          notify_channels: input.notifyChannels,
          notify_roles: input.notifyRoles,
          dedupe_window_minutes: input.dedupeWindowMinutes,
          quiet_hours_start: input.quietHoursStart,
          quiet_hours_end: input.quietHoursEnd,
          created_by: input.createdBy ?? ctx.user.id,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create alert rule' });
      }

      console.log('[Alerts] Rule created');
      return mapDbToAlertRule(data);
    }),

  updateRule: clinicianProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().optional().nullable(),
        condition: conditionSchema.optional(),
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
        notifyChannels: z.array(z.enum(['in_app', 'email', 'sms', 'push'])).optional(),
        notifyRoles: z.array(z.enum(['clinician', 'staff', 'patient'])).optional(),
        dedupeWindowMinutes: z.number().min(0).optional(),
        quietHoursStart: z.string().optional().nullable(),
        quietHoursEnd: z.string().optional().nullable(),
        isEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }): Promise<AlertRule> => {
      console.log('[Alerts] Updating alert rule');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { id, ...rest } = input;
      const updateData: Record<string, unknown> = {};
      if (rest.name !== undefined) updateData.name = rest.name;
      if (rest.description !== undefined) updateData.description = rest.description;
      if (rest.condition !== undefined) updateData.condition = rest.condition;
      if (rest.severity !== undefined) updateData.severity = rest.severity;
      if (rest.notifyChannels !== undefined) updateData.notify_channels = rest.notifyChannels;
      if (rest.notifyRoles !== undefined) updateData.notify_roles = rest.notifyRoles;
      if (rest.dedupeWindowMinutes !== undefined) updateData.dedupe_window_minutes = rest.dedupeWindowMinutes;
      if (rest.quietHoursStart !== undefined) updateData.quiet_hours_start = rest.quietHoursStart;
      if (rest.quietHoursEnd !== undefined) updateData.quiet_hours_end = rest.quietHoursEnd;
      if (rest.isEnabled !== undefined) updateData.is_enabled = rest.isEnabled;

      const { data, error } = await sb
        .from('clinic_alert_rules')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert rule not found' });
      }

      return mapDbToAlertRule(data);
    }),

  deleteRule: clinicianProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }): Promise<{ success: boolean }> => {
      console.log('[Alerts] Deleting alert rule');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { error } = await sb.from('clinic_alert_rules').delete().eq('id', input.id);
      if (error) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert rule not found' });
      }
      return { success: true };
    }),

  toggleRule: clinicianProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }): Promise<AlertRule> => {
      console.log('[Alerts] Toggling alert rule');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from('clinic_alert_rules')
        .update({ is_enabled: input.enabled })
        .eq('id', input.id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert rule not found' });
      }

      return mapDbToAlertRule(data);
    }),

  listEvents: clinicianProcedure
    .input(
      z.object({
        patientId: z.string().optional(),
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
        status: z.enum(['new', 'viewed', 'acknowledged', 'snoozed', 'resolved', 'dismissed']).optional(),
        category: z.enum(['lab', 'biometric', 'upload', 'adherence', 'symptom']).optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ ctx, input }): Promise<PaginatedResponse<AlertEvent>> => {
      console.log('[Alerts] Listing alert events');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      let query = sb.from('clinic_alert_events').select('*', { count: 'exact' });

      if (input.patientId) query = query.eq('patient_id', input.patientId);
      if (input.severity) query = query.eq('severity', input.severity);
      if (input.status) query = query.eq('status', input.status);
      if (input.startDate) query = query.gte('created_at', input.startDate);
      if (input.endDate) query = query.lte('created_at', input.endDate);

      const offset = (input.page - 1) * input.limit;
      query = query.order('severity').order('created_at', { ascending: false }).range(offset, offset + input.limit - 1);

      const { data, error, count } = await query;
      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list alert events' });
      }

      const ruleIds = [...new Set((data ?? []).filter((e: Record<string, unknown>) => e.rule_id).map((e: Record<string, unknown>) => e.rule_id as string))];
      const rulesMap = new Map<string, AlertRule>();
      if (ruleIds.length > 0) {
        const { data: rules } = await sb.from('clinic_alert_rules').select('*').in('id', ruleIds);
        (rules ?? []).forEach((r: Record<string, unknown>) => rulesMap.set(r.id as string, mapDbToAlertRule(r)));
      }

      const total = count ?? 0;
      return {
        data: (data ?? []).map((e: Record<string, unknown>) =>
          mapDbToAlertEvent(e, e.rule_id ? rulesMap.get(e.rule_id as string) : undefined)
        ),
        total,
        page: input.page,
        limit: input.limit,
        totalPages: Math.ceil(total / input.limit),
      };
    }),

  getEvent: clinicianProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }): Promise<AlertEvent | null> => {
      console.log('[Alerts] Getting alert event');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb.from('clinic_alert_events').select('*').eq('id', input.id).single();
      if (error || !data) return null;

      if ((data.status as string) === 'new') {
        await sb.from('clinic_alert_events').update({ status: 'viewed' }).eq('id', input.id);
        data.status = 'viewed';
      }

      let rule: AlertRule | undefined;
      if (data.rule_id) {
        const { data: ruleData } = await sb.from('clinic_alert_rules').select('*').eq('id', data.rule_id).single();
        if (ruleData) rule = mapDbToAlertRule(ruleData);
      }

      return mapDbToAlertEvent(data, rule);
    }),

  acknowledgeEvent: clinicianProcedure
    .input(
      z.object({
        id: z.string(),
        acknowledgedBy: z.string(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }): Promise<AlertEvent> => {
      console.log('[Alerts] Acknowledging alert event');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from('clinic_alert_events')
        .update({
          status: 'acknowledged',
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: input.acknowledgedBy,
          acknowledgment_notes: input.notes,
        })
        .eq('id', input.id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert event not found' });
      }

      return mapDbToAlertEvent(data);
    }),

  snoozeEvent: clinicianProcedure
    .input(
      z.object({
        id: z.string(),
        snoozeDurationMinutes: z.number().min(15).max(1440),
      })
    )
    .mutation(async ({ ctx, input }): Promise<AlertEvent> => {
      console.log('[Alerts] Snoozing alert event');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from('clinic_alert_events')
        .update({
          status: 'snoozed',
          snoozed_until: new Date(Date.now() + input.snoozeDurationMinutes * 60 * 1000).toISOString(),
        })
        .eq('id', input.id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert event not found' });
      }

      return mapDbToAlertEvent(data);
    }),

  resolveEvent: clinicianProcedure
    .input(
      z.object({
        id: z.string(),
        resolvedBy: z.string(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }): Promise<AlertEvent> => {
      console.log('[Alerts] Resolving alert event');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from('clinic_alert_events')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by: input.resolvedBy,
          resolution_notes: input.notes,
        })
        .eq('id', input.id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert event not found' });
      }

      return mapDbToAlertEvent(data);
    }),

  dismissEvent: clinicianProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }): Promise<AlertEvent> => {
      console.log('[Alerts] Dismissing alert event');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from('clinic_alert_events')
        .update({ status: 'dismissed' })
        .eq('id', input.id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert event not found' });
      }

      return mapDbToAlertEvent(data);
    }),

  bulkAcknowledge: clinicianProcedure
    .input(
      z.object({
        ids: z.array(z.string()),
        acknowledgedBy: z.string(),
      })
    )
    .mutation(async ({ ctx, input }): Promise<{ success: boolean; count: number }> => {
      console.log('[Alerts] Bulk acknowledging events');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const now = new Date().toISOString();
      const { data, error } = await sb
        .from('clinic_alert_events')
        .update({
          status: 'acknowledged',
          acknowledged_at: now,
          acknowledged_by: input.acknowledgedBy,
        })
        .in('id', input.ids)
        .in('status', ['new', 'viewed'])
        .select('id');

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to bulk acknowledge' });
      }

      return { success: true, count: (data ?? []).length };
    }),

  getSummary: clinicianProcedure
    .input(z.object({ patientId: z.string().optional() }))
    .query(async ({ ctx, input }): Promise<AlertSummary> => {
      console.log('[Alerts] Getting alert summary');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      let query = sb.from('clinic_alert_events').select('severity,status,rule_id');
      if (input.patientId) query = query.eq('patient_id', input.patientId);

      const { data: events } = await query;

      const bySeverity: Record<AlertSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
      const byStatus: Record<AlertEventStatus, number> = { new: 0, viewed: 0, acknowledged: 0, snoozed: 0, resolved: 0, dismissed: 0 };
      const byCategory: Record<AlertRuleCategory, number> = { lab: 0, biometric: 0, upload: 0, adherence: 0, symptom: 0 };

      const ruleIds = [...new Set((events ?? []).filter((e: Record<string, unknown>) => e.rule_id).map((e: Record<string, unknown>) => e.rule_id as string))];
      const rulesMap = new Map<string, string>();
      if (ruleIds.length > 0) {
        const { data: rules } = await sb.from('clinic_alert_rules').select('id,category').in('id', ruleIds);
        (rules ?? []).forEach((r: Record<string, unknown>) => rulesMap.set(r.id as string, r.category as string));
      }

      (events ?? []).forEach((event: Record<string, unknown>) => {
        const sev = event.severity as AlertSeverity;
        const stat = event.status as AlertEventStatus;
        if (sev in bySeverity) bySeverity[sev]++;
        if (stat in byStatus) byStatus[stat]++;
        if (event.rule_id) {
          const cat = rulesMap.get(event.rule_id as string) as AlertRuleCategory | undefined;
          if (cat && cat in byCategory) byCategory[cat]++;
        }
      });

      return {
        total: (events ?? []).length,
        bySeverity,
        byStatus,
        byCategory,
      };
    }),

  triggerAlert: clinicianProcedure
    .input(
      z.object({
        ruleId: z.string().optional(),
        patientId: z.string(),
        triggerType: z.enum(['event', 'threshold', 'pattern', 'scheduled']),
        triggerData: z.record(z.string(), z.unknown()),
        title: z.string(),
        message: z.string(),
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
      })
    )
    .mutation(async ({ ctx, input }): Promise<AlertEvent> => {
      console.log('[Alerts] Triggering alert');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      if (input.ruleId) {
        const { data: rule } = await sb.from('clinic_alert_rules').select('dedupe_window_minutes').eq('id', input.ruleId).single();
        if (rule && (rule.dedupe_window_minutes as number) > 0) {
          const cutoff = new Date(Date.now() - (rule.dedupe_window_minutes as number) * 60 * 1000).toISOString();
          const { data: dup } = await sb
            .from('clinic_alert_events')
            .select('*')
            .eq('rule_id', input.ruleId)
            .eq('patient_id', input.patientId)
            .gte('created_at', cutoff)
            .limit(1)
            .single();

          if (dup) {
            console.log('[Alerts] Duplicate alert suppressed');
            return mapDbToAlertEvent(dup);
          }
        }
      }

      const { data, error } = await sb
        .from('clinic_alert_events')
        .insert({
          clinician_id: ctx.user.id,
          rule_id: input.ruleId,
          patient_id: input.patientId,
          trigger_type: input.triggerType,
          trigger_data: input.triggerData,
          title: input.title,
          message: input.message,
          severity: input.severity,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to trigger alert' });
      }

      console.log('[Alerts] Alert triggered');
      return mapDbToAlertEvent(data);
    }),
});
