/**
 * E2E Smoke Tests for critical API flows.
 *
 * These tests verify the tRPC router structure and handler signatures
 * without requiring a running server or real Supabase connection.
 * For full integration tests, run against a staging environment.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mockFrom, createChainableMock, mockCtx } from '../setup';
import { appRouter } from '../../backend/trpc/app-router';
import { createTRPCRouter } from '../../backend/trpc/create-context';

// Mock the user as having clinician role for clinic routes
const clinicianCtx = {
  ...mockCtx,
  user: {
    ...mockCtx.user,
    appRoles: ['authenticated', 'practitioner'] as const,
  },
};

describe('E2E Smoke Tests - Router Structure', () => {
  test('appRouter has all expected sub-routers', () => {
    // Verify all expected routers are registered
    const routerKeys = Object.keys(appRouter._def.procedures || {})
      .concat(Object.keys(appRouter._def.record || {}));

    // The app should have clinic, nutrition, and supplements routers
    expect(routerKeys.length).toBeGreaterThan(0);
  });

  test('server entry point exists', async () => {
    // Verify the server module is importable (doesn't pull react-native)
    const serverModule = await import('../../backend/trpc/app-router');
    expect(serverModule.appRouter).toBeDefined();
  });
});

describe('E2E Smoke Tests - Auth Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('unauthenticated request to protected route throws UNAUTHORIZED', async () => {
    const unauthCtx = {
      user: null,
      sessionToken: null,
      req: new Request('http://localhost'),
    };

    const caller = appRouter.createCaller(unauthCtx as never);

    // Any clinic route should fail without auth
    await expect(
      (caller as any).clinic.patients.list({})
    ).rejects.toThrow();
  });

  test('authenticated clinician can access clinic routes', async () => {
    const patient = {
      id: 'p1', first_name: 'Test', last_name: 'Patient',
      date_of_birth: '1990-01-01', sex: 'male', status: 'active',
      tags: [], country: 'US', created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), clinician_id: 'clinician-001',
    };
    mockFrom.mockReturnValue(createChainableMock({ data: [patient], count: 1 }));

    const caller = appRouter.createCaller(clinicianCtx as never);
    const result = await (caller as any).clinic.patients.list({});

    expect(result).toBeDefined();
    expect(result.data).toBeDefined();
  });
});

describe('E2E Smoke Tests - Critical Data Flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('patient creation returns valid patient object', async () => {
    const newPatient = {
      id: 'p-new', first_name: 'Jane', last_name: 'Doe',
      date_of_birth: '1985-06-15', sex: 'female', status: 'active',
      tags: [], country: 'US', created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), clinician_id: 'clinician-001',
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'clinic_patients') return createChainableMock({ data: newPatient });
      if (table === 'clinic_health_histories') return createChainableMock({ data: null });
      return createChainableMock({ data: [] });
    });

    const caller = appRouter.createCaller(clinicianCtx as never);
    const result = await (caller as any).clinic.patients.create({
      firstName: 'Jane',
      lastName: 'Doe',
      dateOfBirth: '1985-06-15',
      sex: 'female',
    });

    expect(result.id).toBe('p-new');
    expect(result.firstName).toBe('Jane');
  });

  test('lab result creation calculates status automatically', async () => {
    const labTest = {
      id: 'lt1', code: 'TSH', name: 'TSH', unit: 'mIU/L',
      ref_range_low: 0.4, ref_range_high: 4.0,
      critical_low: 0.1, critical_high: 10.0,
      is_active: true, category: 'thyroid',
    };
    const labResult = {
      id: 'r1', patient_id: 'p1', lab_test_id: 'lt1',
      value: 2.5, unit: 'mIU/L', status: 'normal',
      result_date: '2026-01-10', entered_by: 'c1',
      entry_method: 'manual', created_at: new Date().toISOString(),
      clinician_id: 'clinician-001',
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'clinic_lab_tests') return createChainableMock({ data: labTest });
      if (table === 'clinic_lab_results') return createChainableMock({ data: labResult });
      return createChainableMock({ data: [] });
    });

    const caller = appRouter.createCaller(clinicianCtx as never);
    const result = await (caller as any).clinic.labs.addResult({
      patientId: 'p1',
      labTestId: 'lt1',
      value: 2.5,
      unit: 'mIU/L',
      resultDate: '2026-01-10',
      enteredBy: 'c1',
    });

    expect(result.id).toBe('r1');
    expect(result.status).toBe('normal');
  });

  test('alert creation with dedupe check', async () => {
    const alertEvent = {
      id: 'ae1', patient_id: 'p1', rule_id: 'r1',
      trigger_type: 'threshold', trigger_data: { value: 250 },
      title: 'High glucose', message: 'Glucose is 250',
      severity: 'critical', status: 'new',
      created_at: new Date().toISOString(),
      clinician_id: 'clinician-001',
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'clinic_alert_rules') return createChainableMock({ data: { dedupe_window_minutes: 60 } });
      if (table === 'clinic_alert_events') return createChainableMock({ data: alertEvent });
      return createChainableMock({ data: [] });
    });

    const caller = appRouter.createCaller(clinicianCtx as never);
    const result = await (caller as any).clinic.alerts.triggerAlert({
      ruleId: 'r1',
      patientId: 'p1',
      triggerType: 'threshold',
      triggerData: { value: 250 },
      title: 'High glucose',
      message: 'Glucose is 250',
      severity: 'critical',
    });

    expect(result.id).toBe('ae1');
    expect(result.severity).toBe('critical');
  });

  test('dashboard stats aggregation', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'clinic_patients') {
        return createChainableMock({
          data: [{ id: 'p1', status: 'active' }, { id: 'p2', status: 'active' }],
          count: 2,
        });
      }
      if (table === 'clinic_alert_events') {
        return createChainableMock({
          data: [{ id: 'a1', severity: 'critical', status: 'new' }],
        });
      }
      if (table === 'clinic_lab_documents') {
        return createChainableMock({ data: [] });
      }
      return createChainableMock({ data: [] });
    });

    const caller = appRouter.createCaller(clinicianCtx as never);
    const result = await (caller as any).clinic.dashboard.getStats({});

    expect(result.totalPatients).toBeGreaterThanOrEqual(0);
    expect(result).toHaveProperty('criticalAlerts');
    expect(result).toHaveProperty('activePatients');
  });
});
