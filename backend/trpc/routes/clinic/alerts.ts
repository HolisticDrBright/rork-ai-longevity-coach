import { z } from "zod";
import { publicProcedure, createTRPCRouter } from "../../create-context";
import type {
  AlertRule,
  AlertEvent,
  AlertSummary,
  AlertSeverity,
  AlertEventStatus,
  AlertRuleCategory,
  PaginatedResponse,
} from "@/types/clinic";

const alertRuleStore: Map<string, AlertRule> = new Map();
const alertEventStore: Map<string, AlertEvent> = new Map();

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

initializeDefaultRules();

function initializeDefaultRules() {
  const defaultRules: Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'>[] = [
    {
      scope: 'global',
      name: 'New Lab Upload',
      description: 'Alert when a patient uploads new lab documents',
      category: 'upload',
      triggerType: 'event',
      condition: { event: 'lab_document_uploaded' },
      severity: 'medium',
      notifyChannels: ['in_app', 'email'],
      notifyRoles: ['clinician'],
      dedupeWindowMinutes: 60,
      isEnabled: true,
    },
    {
      scope: 'global',
      name: 'Critical Glucose High',
      description: 'Alert when glucose exceeds critical threshold (250 mg/dL)',
      category: 'biometric',
      triggerType: 'threshold',
      condition: { metric: 'glucose', operator: '>', value: 250 },
      severity: 'critical',
      notifyChannels: ['in_app', 'email', 'sms'],
      notifyRoles: ['clinician'],
      dedupeWindowMinutes: 30,
      isEnabled: true,
    },
    {
      scope: 'global',
      name: 'Critical Glucose Low',
      description: 'Alert when glucose drops below critical threshold (54 mg/dL)',
      category: 'biometric',
      triggerType: 'threshold',
      condition: { metric: 'glucose', operator: '<', value: 54 },
      severity: 'critical',
      notifyChannels: ['in_app', 'email', 'sms'],
      notifyRoles: ['clinician'],
      dedupeWindowMinutes: 30,
      isEnabled: true,
    },
    {
      scope: 'global',
      name: 'High Glucose Pattern',
      description: 'Alert when 3+ readings above 180 mg/dL within 24 hours',
      category: 'biometric',
      triggerType: 'pattern',
      condition: { metric: 'glucose', operator: '>', value: 180, count: 3, windowHours: 24 },
      severity: 'high',
      notifyChannels: ['in_app', 'email'],
      notifyRoles: ['clinician'],
      dedupeWindowMinutes: 240,
      isEnabled: true,
    },
    {
      scope: 'global',
      name: 'Critical Lab Value - A1C',
      description: 'Alert when A1C exceeds 9%',
      category: 'lab',
      triggerType: 'threshold',
      condition: { labCode: 'HBA1C', operator: '>', value: 9 },
      severity: 'critical',
      notifyChannels: ['in_app', 'email'],
      notifyRoles: ['clinician'],
      dedupeWindowMinutes: 1440,
      isEnabled: true,
    },
    {
      scope: 'global',
      name: 'Critical Lab Value - Creatinine',
      description: 'Alert when creatinine exceeds 2.0 mg/dL',
      category: 'lab',
      triggerType: 'threshold',
      condition: { labCode: 'CREATININE', operator: '>', value: 2.0 },
      severity: 'critical',
      notifyChannels: ['in_app', 'email'],
      notifyRoles: ['clinician'],
      dedupeWindowMinutes: 1440,
      isEnabled: true,
    },
    {
      scope: 'global',
      name: 'High Blood Pressure',
      description: 'Alert when systolic BP exceeds 180 mmHg',
      category: 'biometric',
      triggerType: 'threshold',
      condition: { metric: 'bp_systolic', operator: '>', value: 180 },
      severity: 'high',
      notifyChannels: ['in_app', 'email'],
      notifyRoles: ['clinician'],
      dedupeWindowMinutes: 60,
      isEnabled: true,
    },
    {
      scope: 'global',
      name: 'New Lab Results Added',
      description: 'Alert when new structured lab results are entered',
      category: 'lab',
      triggerType: 'event',
      condition: { event: 'lab_result_added' },
      severity: 'low',
      notifyChannels: ['in_app'],
      notifyRoles: ['clinician'],
      dedupeWindowMinutes: 60,
      isEnabled: true,
    },
  ];

  const now = new Date().toISOString();
  defaultRules.forEach((rule) => {
    const id = generateId();
    alertRuleStore.set(id, { id, ...rule, createdAt: now, updatedAt: now });
  });
  console.log('[Alerts] Initialized', alertRuleStore.size, 'default alert rules');
}

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
  listRules: publicProcedure
    .input(
      z.object({
        scope: z.enum(['global', 'patient']).optional(),
        patientId: z.string().optional(),
        category: z.enum(['lab', 'biometric', 'upload', 'adherence', 'symptom']).optional(),
        enabledOnly: z.boolean().default(false),
      })
    )
    .query(async ({ input }): Promise<AlertRule[]> => {
      console.log('[Alerts] Listing alert rules');
      
      let rules = Array.from(alertRuleStore.values());

      if (input.scope) {
        rules = rules.filter((r) => r.scope === input.scope);
      }

      if (input.patientId) {
        rules = rules.filter(
          (r) => r.scope === 'global' || r.patientId === input.patientId
        );
      }

      if (input.category) {
        rules = rules.filter((r) => r.category === input.category);
      }

      if (input.enabledOnly) {
        rules = rules.filter((r) => r.isEnabled);
      }

      return rules.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      });
    }),

  createRule: publicProcedure
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
    .mutation(async ({ input }): Promise<AlertRule> => {
      console.log('[Alerts] Creating alert rule:', input.name);
      
      if (input.scope === 'patient' && !input.patientId) {
        throw new Error('Patient ID required for patient-scoped rules');
      }

      const now = new Date().toISOString();
      const rule: AlertRule = {
        id: generateId(),
        ...input,
        isEnabled: true,
        createdAt: now,
        updatedAt: now,
      };

      alertRuleStore.set(rule.id, rule);
      console.log('[Alerts] Rule created:', rule.id);
      return rule;
    }),

  updateRule: publicProcedure
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
    .mutation(async ({ input }): Promise<AlertRule> => {
      console.log('[Alerts] Updating alert rule:', input.id);
      
      const existing = alertRuleStore.get(input.id);
      if (!existing) {
        throw new Error('Alert rule not found');
      }

      const { id, ...updates } = input;
      const cleanedUpdates = Object.fromEntries(
        Object.entries(updates).filter(([_, v]) => v !== undefined)
      );

      const updated: AlertRule = {
        ...existing,
        ...cleanedUpdates,
        updatedAt: new Date().toISOString(),
      };

      alertRuleStore.set(id, updated);
      return updated;
    }),

  deleteRule: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }): Promise<{ success: boolean }> => {
      console.log('[Alerts] Deleting alert rule:', input.id);
      
      if (!alertRuleStore.has(input.id)) {
        throw new Error('Alert rule not found');
      }

      alertRuleStore.delete(input.id);
      return { success: true };
    }),

  toggleRule: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(async ({ input }): Promise<AlertRule> => {
      console.log('[Alerts] Toggling alert rule:', input.id, 'to', input.enabled);
      
      const existing = alertRuleStore.get(input.id);
      if (!existing) {
        throw new Error('Alert rule not found');
      }

      existing.isEnabled = input.enabled;
      existing.updatedAt = new Date().toISOString();
      alertRuleStore.set(input.id, existing);
      return existing;
    }),

  listEvents: publicProcedure
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
    .query(async ({ input }): Promise<PaginatedResponse<AlertEvent>> => {
      console.log('[Alerts] Listing alert events');
      
      let events = Array.from(alertEventStore.values());

      if (input.patientId) {
        events = events.filter((e) => e.patientId === input.patientId);
      }

      if (input.severity) {
        events = events.filter((e) => e.severity === input.severity);
      }

      if (input.status) {
        events = events.filter((e) => e.status === input.status);
      }

      if (input.category) {
        events = events.filter((e) => {
          const rule = e.ruleId ? alertRuleStore.get(e.ruleId) : null;
          return rule?.category === input.category;
        });
      }

      if (input.startDate) {
        events = events.filter((e) => e.createdAt >= input.startDate!);
      }

      if (input.endDate) {
        events = events.filter((e) => e.createdAt <= input.endDate!);
      }

      events = events.map((e) => ({
        ...e,
        rule: e.ruleId ? alertRuleStore.get(e.ruleId) : undefined,
      }));

      events.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
          return severityOrder[a.severity] - severityOrder[b.severity];
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      const total = events.length;
      const totalPages = Math.ceil(total / input.limit);
      const startIndex = (input.page - 1) * input.limit;
      const paginatedEvents = events.slice(startIndex, startIndex + input.limit);

      return {
        data: paginatedEvents,
        total,
        page: input.page,
        limit: input.limit,
        totalPages,
      };
    }),

  getEvent: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }): Promise<AlertEvent | null> => {
      console.log('[Alerts] Getting alert event:', input.id);
      
      const event = alertEventStore.get(input.id);
      if (!event) return null;

      if (event.status === 'new') {
        event.status = 'viewed';
        alertEventStore.set(input.id, event);
      }

      return {
        ...event,
        rule: event.ruleId ? alertRuleStore.get(event.ruleId) : undefined,
      };
    }),

  acknowledgeEvent: publicProcedure
    .input(
      z.object({
        id: z.string(),
        acknowledgedBy: z.string(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<AlertEvent> => {
      console.log('[Alerts] Acknowledging alert event:', input.id);
      
      const event = alertEventStore.get(input.id);
      if (!event) {
        throw new Error('Alert event not found');
      }

      event.status = 'acknowledged';
      event.acknowledgedAt = new Date().toISOString();
      event.acknowledgedBy = input.acknowledgedBy;
      event.acknowledgmentNotes = input.notes;

      alertEventStore.set(input.id, event);
      return event;
    }),

  snoozeEvent: publicProcedure
    .input(
      z.object({
        id: z.string(),
        snoozeDurationMinutes: z.number().min(15).max(1440),
      })
    )
    .mutation(async ({ input }): Promise<AlertEvent> => {
      console.log('[Alerts] Snoozing alert event:', input.id);
      
      const event = alertEventStore.get(input.id);
      if (!event) {
        throw new Error('Alert event not found');
      }

      event.status = 'snoozed';
      event.snoozedUntil = new Date(
        Date.now() + input.snoozeDurationMinutes * 60 * 1000
      ).toISOString();

      alertEventStore.set(input.id, event);
      return event;
    }),

  resolveEvent: publicProcedure
    .input(
      z.object({
        id: z.string(),
        resolvedBy: z.string(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<AlertEvent> => {
      console.log('[Alerts] Resolving alert event:', input.id);
      
      const event = alertEventStore.get(input.id);
      if (!event) {
        throw new Error('Alert event not found');
      }

      event.status = 'resolved';
      event.resolvedAt = new Date().toISOString();
      event.resolvedBy = input.resolvedBy;
      event.resolutionNotes = input.notes;

      alertEventStore.set(input.id, event);
      return event;
    }),

  dismissEvent: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }): Promise<AlertEvent> => {
      console.log('[Alerts] Dismissing alert event:', input.id);
      
      const event = alertEventStore.get(input.id);
      if (!event) {
        throw new Error('Alert event not found');
      }

      event.status = 'dismissed';
      alertEventStore.set(input.id, event);
      return event;
    }),

  bulkAcknowledge: publicProcedure
    .input(
      z.object({
        ids: z.array(z.string()),
        acknowledgedBy: z.string(),
      })
    )
    .mutation(async ({ input }): Promise<{ success: boolean; count: number }> => {
      console.log('[Alerts] Bulk acknowledging', input.ids.length, 'events');
      
      let count = 0;
      const now = new Date().toISOString();

      input.ids.forEach((id) => {
        const event = alertEventStore.get(id);
        if (event && (event.status === 'new' || event.status === 'viewed')) {
          event.status = 'acknowledged';
          event.acknowledgedAt = now;
          event.acknowledgedBy = input.acknowledgedBy;
          alertEventStore.set(id, event);
          count++;
        }
      });

      return { success: true, count };
    }),

  getSummary: publicProcedure
    .input(z.object({ patientId: z.string().optional() }))
    .query(async ({ input }): Promise<AlertSummary> => {
      console.log('[Alerts] Getting alert summary');
      
      let events = Array.from(alertEventStore.values());

      if (input.patientId) {
        events = events.filter((e) => e.patientId === input.patientId);
      }

      const bySeverity: Record<AlertSeverity, number> = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      };

      const byStatus: Record<AlertEventStatus, number> = {
        new: 0,
        viewed: 0,
        acknowledged: 0,
        snoozed: 0,
        resolved: 0,
        dismissed: 0,
      };

      const byCategory: Record<AlertRuleCategory, number> = {
        lab: 0,
        biometric: 0,
        upload: 0,
        adherence: 0,
        symptom: 0,
      };

      events.forEach((event) => {
        bySeverity[event.severity]++;
        byStatus[event.status]++;
        
        if (event.ruleId) {
          const rule = alertRuleStore.get(event.ruleId);
          if (rule) {
            byCategory[rule.category]++;
          }
        }
      });

      return {
        total: events.length,
        bySeverity,
        byStatus,
        byCategory,
      };
    }),

  triggerAlert: publicProcedure
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
    .mutation(async ({ input }): Promise<AlertEvent> => {
      console.log('[Alerts] Triggering alert for patient:', input.patientId);
      
      if (input.ruleId) {
        const rule = alertRuleStore.get(input.ruleId);
        if (rule && rule.dedupeWindowMinutes > 0) {
          const cutoff = new Date(
            Date.now() - rule.dedupeWindowMinutes * 60 * 1000
          ).toISOString();
          
          const recentDuplicate = Array.from(alertEventStore.values()).find(
            (e) =>
              e.ruleId === input.ruleId &&
              e.patientId === input.patientId &&
              e.createdAt >= cutoff
          );

          if (recentDuplicate) {
            console.log('[Alerts] Duplicate alert suppressed');
            return recentDuplicate;
          }
        }
      }

      const event: AlertEvent = {
        id: generateId(),
        ruleId: input.ruleId,
        patientId: input.patientId,
        triggerType: input.triggerType,
        triggerData: input.triggerData,
        title: input.title,
        message: input.message,
        severity: input.severity,
        status: 'new',
        createdAt: new Date().toISOString(),
      };

      alertEventStore.set(event.id, event);
      console.log('[Alerts] Alert triggered:', event.id);

      return event;
    }),
});

export { alertRuleStore, alertEventStore };
