import { describe, test, expect, vi, beforeEach } from 'vitest';
import { makeAlertRuleRow, makeAlertEventRow } from './test-helpers';
import { mockFrom, createChainableMock, setupMockFrom, mockCtx } from '../setup';

import { alertsRouter } from '../../backend/trpc/routes/clinic/alerts';
import { createTRPCRouter } from '../../backend/trpc/create-context';

type Caller = {
  listRules: (input: Record<string, unknown>) => Promise<unknown>;
  createRule: (input: Record<string, unknown>) => Promise<unknown>;
  updateRule: (input: Record<string, unknown>) => Promise<unknown>;
  deleteRule: (input: Record<string, unknown>) => Promise<unknown>;
  toggleRule: (input: Record<string, unknown>) => Promise<unknown>;
  listEvents: (input: Record<string, unknown>) => Promise<unknown>;
  getEvent: (input: Record<string, unknown>) => Promise<unknown>;
  acknowledgeEvent: (input: Record<string, unknown>) => Promise<unknown>;
  snoozeEvent: (input: Record<string, unknown>) => Promise<unknown>;
  resolveEvent: (input: Record<string, unknown>) => Promise<unknown>;
  dismissEvent: (input: Record<string, unknown>) => Promise<unknown>;
  bulkAcknowledge: (input: Record<string, unknown>) => Promise<unknown>;
  getSummary: (input: Record<string, unknown>) => Promise<unknown>;
  triggerAlert: (input: Record<string, unknown>) => Promise<unknown>;
};

function createTestCaller(): Caller {
  const router = createTRPCRouter({ alerts: alertsRouter });
  const createCaller = router.createCaller;
  const caller = createCaller(mockCtx as never);
  return (caller as unknown as { alerts: Caller }).alerts;
}

describe('alertsRouter handlers', () => {
  let caller: Caller;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = createTestCaller();
  });

  describe('listRules', () => {
    test('returns mapped alert rules', async () => {
      const rules = [makeAlertRuleRow(), makeAlertRuleRow({ id: 'rule-002', name: 'Low HRV' })];
      setupMockFrom({
        clinic_alert_rules: createChainableMock({ data: rules }),
      });

      const result = await caller.listRules({});
      expect(Array.isArray(result)).toBe(true);
      expect((result as unknown[]).length).toBe(2);
      expect((result as { id: string }[])[0].id).toBe('rule-001');
      expect((result as { name: string }[])[1].name).toBe('Low HRV');
    });

    test('returns empty array when no rules exist', async () => {
      setupMockFrom({
        clinic_alert_rules: createChainableMock({ data: [] }),
      });

      const result = await caller.listRules({});
      expect(result).toEqual([]);
    });

    test('throws on supabase error', async () => {
      setupMockFrom({
        clinic_alert_rules: createChainableMock({ data: null, error: { message: 'db error' } }),
      });

      await expect(caller.listRules({})).rejects.toThrow();
    });
  });

  describe('createRule', () => {
    test('inserts and returns new rule', async () => {
      const newRule = makeAlertRuleRow({ id: 'rule-new' });
      const chain = createChainableMock({ data: newRule });
      setupMockFrom({ clinic_alert_rules: chain });

      const result = await caller.createRule({
        scope: 'global',
        name: 'New Rule',
        category: 'lab',
        triggerType: 'threshold',
        condition: { metric: 'TSH', operator: '>', value: 10 },
        severity: 'high',
      });

      expect((result as { id: string }).id).toBe('rule-new');
    });

    test('throws BAD_REQUEST for patient scope without patientId', async () => {
      setupMockFrom({ clinic_alert_rules: createChainableMock({ data: null }) });

      await expect(
        caller.createRule({
          scope: 'patient',
          name: 'Patient Rule',
          category: 'biometric',
          triggerType: 'threshold',
          condition: {},
          severity: 'medium',
        })
      ).rejects.toThrow('Patient ID required');
    });

    test('throws on insert error', async () => {
      const chain = createChainableMock({ data: null, error: { message: 'insert failed' } });
      setupMockFrom({ clinic_alert_rules: chain });

      await expect(
        caller.createRule({
          scope: 'global',
          name: 'Bad Rule',
          category: 'lab',
          triggerType: 'event',
          condition: {},
          severity: 'low',
        })
      ).rejects.toThrow();
    });
  });

  describe('updateRule', () => {
    test('updates and returns modified rule', async () => {
      const updated = makeAlertRuleRow({ name: 'Updated Name' });
      const chain = createChainableMock({ data: updated });
      setupMockFrom({ clinic_alert_rules: chain });

      const result = await caller.updateRule({ id: 'rule-001', name: 'Updated Name' });
      expect((result as { name: string }).name).toBe('Updated Name');
    });

    test('throws NOT_FOUND on update error', async () => {
      const chain = createChainableMock({ data: null, error: { message: 'not found' } });
      setupMockFrom({ clinic_alert_rules: chain });

      await expect(caller.updateRule({ id: 'nonexistent' })).rejects.toThrow();
    });
  });

  describe('deleteRule', () => {
    test('returns success on delete', async () => {
      const chain = createChainableMock({ data: null });
      setupMockFrom({ clinic_alert_rules: chain });

      const result = await caller.deleteRule({ id: 'rule-001' });
      expect(result).toEqual({ success: true });
    });

    test('throws on delete error', async () => {
      const chain = createChainableMock({ data: null, error: { message: 'not found' } });
      setupMockFrom({ clinic_alert_rules: chain });

      await expect(caller.deleteRule({ id: 'bad-id' })).rejects.toThrow();
    });
  });

  describe('toggleRule', () => {
    test('toggles rule enabled state', async () => {
      const toggled = makeAlertRuleRow({ is_enabled: false });
      const chain = createChainableMock({ data: toggled });
      setupMockFrom({ clinic_alert_rules: chain });

      const result = await caller.toggleRule({ id: 'rule-001', enabled: false });
      expect((result as { isEnabled: boolean }).isEnabled).toBe(false);
    });
  });

  describe('listEvents', () => {
    test('returns paginated events with rules', async () => {
      const events = [makeAlertEventRow(), makeAlertEventRow({ id: 'event-002', severity: 'high' })];
      const rules = [makeAlertRuleRow()];

      const eventsChain = createChainableMock({ data: events, count: 2 });
      const rulesChain = createChainableMock({ data: rules });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_alert_events') return eventsChain;
        if (table === 'clinic_alert_rules') return rulesChain;
        return createChainableMock({ data: [] });
      });

      const result = await caller.listEvents({ page: 1, limit: 20 }) as {
        data: unknown[];
        total: number;
        page: number;
        totalPages: number;
      };

      expect(result.data.length).toBe(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
    });

    test('returns empty data on no events', async () => {
      setupMockFrom({
        clinic_alert_events: createChainableMock({ data: [], count: 0 }),
      });

      const result = await caller.listEvents({ page: 1, limit: 20 }) as {
        data: unknown[];
        total: number;
      };
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('getEvent', () => {
    test('returns event and marks as viewed if new', async () => {
      const eventRow = makeAlertEventRow({ status: 'new' });
      const ruleRow = makeAlertRuleRow();

      const eventsChain = createChainableMock({ data: eventRow });
      const rulesChain = createChainableMock({ data: ruleRow });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_alert_events') return eventsChain;
        if (table === 'clinic_alert_rules') return rulesChain;
        return createChainableMock({ data: [] });
      });

      const result = await caller.getEvent({ id: 'event-001' });
      expect(result).not.toBeNull();
      expect((result as { id: string }).id).toBe('event-001');
    });

    test('returns null when event not found', async () => {
      const chain = createChainableMock({ data: null, error: { message: 'not found' } });
      setupMockFrom({ clinic_alert_events: chain });

      const result = await caller.getEvent({ id: 'nonexistent' });
      expect(result).toBeNull();
    });
  });

  describe('acknowledgeEvent', () => {
    test('updates status to acknowledged', async () => {
      const acked = makeAlertEventRow({
        status: 'acknowledged',
        acknowledged_at: '2026-01-15T13:00:00Z',
        acknowledged_by: 'clinician-001',
      });
      const chain = createChainableMock({ data: acked });
      setupMockFrom({ clinic_alert_events: chain });

      const result = await caller.acknowledgeEvent({
        id: 'event-001',
        acknowledgedBy: 'clinician-001',
        notes: 'Reviewed',
      });
      expect((result as { status: string }).status).toBe('acknowledged');
    });

    test('throws when event not found', async () => {
      const chain = createChainableMock({ data: null, error: { message: 'not found' } });
      setupMockFrom({ clinic_alert_events: chain });

      await expect(
        caller.acknowledgeEvent({ id: 'bad', acknowledgedBy: 'doc' })
      ).rejects.toThrow();
    });
  });

  describe('snoozeEvent', () => {
    test('updates status to snoozed with duration', async () => {
      const snoozed = makeAlertEventRow({
        status: 'snoozed',
        snoozed_until: '2026-01-15T14:00:00Z',
      });
      const chain = createChainableMock({ data: snoozed });
      setupMockFrom({ clinic_alert_events: chain });

      const result = await caller.snoozeEvent({ id: 'event-001', snoozeDurationMinutes: 60 });
      expect((result as { status: string }).status).toBe('snoozed');
      expect((result as { snoozedUntil: string }).snoozedUntil).toBeDefined();
    });
  });

  describe('resolveEvent', () => {
    test('updates status to resolved', async () => {
      const resolved = makeAlertEventRow({
        status: 'resolved',
        resolved_at: '2026-01-15T15:00:00Z',
        resolved_by: 'clinician-001',
        resolution_notes: 'Fixed',
      });
      const chain = createChainableMock({ data: resolved });
      setupMockFrom({ clinic_alert_events: chain });

      const result = await caller.resolveEvent({
        id: 'event-001',
        resolvedBy: 'clinician-001',
        notes: 'Fixed',
      });
      expect((result as { status: string }).status).toBe('resolved');
      expect((result as { resolutionNotes: string }).resolutionNotes).toBe('Fixed');
    });
  });

  describe('dismissEvent', () => {
    test('updates status to dismissed', async () => {
      const dismissed = makeAlertEventRow({ status: 'dismissed' });
      const chain = createChainableMock({ data: dismissed });
      setupMockFrom({ clinic_alert_events: chain });

      const result = await caller.dismissEvent({ id: 'event-001' });
      expect((result as { status: string }).status).toBe('dismissed');
    });
  });

  describe('bulkAcknowledge', () => {
    test('acknowledges multiple events and returns count', async () => {
      const chain = createChainableMock({ data: [{ id: 'e1' }, { id: 'e2' }] });
      setupMockFrom({ clinic_alert_events: chain });

      const result = await caller.bulkAcknowledge({
        ids: ['e1', 'e2', 'e3'],
        acknowledgedBy: 'clinician-001',
      });
      expect((result as { success: boolean }).success).toBe(true);
      expect((result as { count: number }).count).toBe(2);
    });
  });

  describe('getSummary', () => {
    test('aggregates counts by severity, status, and category', async () => {
      const events = [
        { severity: 'critical', status: 'new', rule_id: 'r1' },
        { severity: 'high', status: 'viewed', rule_id: 'r1' },
        { severity: 'medium', status: 'acknowledged', rule_id: 'r2' },
      ];
      const rules = [
        { id: 'r1', category: 'lab' },
        { id: 'r2', category: 'biometric' },
      ];

      const eventsChain = createChainableMock({ data: events });
      const rulesChain = createChainableMock({ data: rules });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_alert_events') return eventsChain;
        if (table === 'clinic_alert_rules') return rulesChain;
        return createChainableMock({ data: [] });
      });

      const result = await caller.getSummary({}) as {
        total: number;
        bySeverity: Record<string, number>;
        byStatus: Record<string, number>;
        byCategory: Record<string, number>;
      };

      expect(result.total).toBe(3);
      expect(result.bySeverity.critical).toBe(1);
      expect(result.bySeverity.high).toBe(1);
      expect(result.byStatus.new).toBe(1);
      expect(result.byStatus.viewed).toBe(1);
      expect(result.byCategory.lab).toBe(2);
      expect(result.byCategory.biometric).toBe(1);
    });
  });

  describe('triggerAlert', () => {
    test('creates new alert event', async () => {
      const created = makeAlertEventRow({ id: 'event-new' });
      const chain = createChainableMock({ data: created });
      setupMockFrom({ clinic_alert_events: chain });

      const result = await caller.triggerAlert({
        patientId: 'patient-001',
        triggerType: 'threshold',
        triggerData: { value: 300 },
        title: 'High glucose',
        message: 'Glucose 300',
        severity: 'critical',
      });

      expect((result as { id: string }).id).toBe('event-new');
    });

    test('suppresses duplicate within dedupe window', async () => {
      const existingEvent = makeAlertEventRow({ id: 'event-dup' });
      const ruleData = { dedupe_window_minutes: 60 };

      const eventsChain = createChainableMock({ data: existingEvent });
      const rulesChain = createChainableMock({ data: ruleData });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_alert_events') return eventsChain;
        if (table === 'clinic_alert_rules') return rulesChain;
        return createChainableMock({ data: [] });
      });

      const result = await caller.triggerAlert({
        ruleId: 'rule-001',
        patientId: 'patient-001',
        triggerType: 'threshold',
        triggerData: { value: 300 },
        title: 'High glucose',
        message: 'Glucose 300',
        severity: 'critical',
      });

      expect((result as { id: string }).id).toBe('event-dup');
    });
  });
});
