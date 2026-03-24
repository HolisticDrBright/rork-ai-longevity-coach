import { describe, test, expect, vi, beforeEach } from 'vitest';
import { makePatientRow, makeAlertEventRow, makeLabDocumentRow, makeLabResultRow, makeBiometricReadingRow } from './test-helpers';
import { mockFrom, createChainableMock, mockCtx } from '../setup';

import { dashboardRouter } from '../../backend/trpc/routes/clinic/dashboard';
import { createTRPCRouter } from '../../backend/trpc/create-context';

function createTestCaller() {
  const router = createTRPCRouter({ dashboard: dashboardRouter });
  const caller = router.createCaller(mockCtx as never);
  return (caller as unknown as { dashboard: Record<string, (input: Record<string, unknown>) => Promise<unknown>> }).dashboard;
}

describe('dashboardRouter handlers', () => {
  let caller: ReturnType<typeof createTestCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = createTestCaller();
  });

  describe('getStats', () => {
    test('returns aggregated dashboard stats', async () => {
      const patients = [
        { id: 'p1', status: 'active' },
        { id: 'p2', status: 'active' },
        { id: 'p3', status: 'inactive' },
      ];
      const alerts = [
        { id: 'a1', severity: 'critical', status: 'new' },
        { id: 'a2', severity: 'high', status: 'viewed' },
      ];
      const pendingDocs = [
        { id: 'd1', processing_status: 'pending', uploaded_at: new Date().toISOString() },
      ];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_patients') return createChainableMock({ data: patients, count: 3 });
        if (table === 'clinic_alert_events') return createChainableMock({ data: alerts });
        if (table === 'clinic_lab_documents') return createChainableMock({ data: pendingDocs });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getStats({}) as {
        totalPatients: number;
        activePatients: number;
        criticalAlerts: number;
        pendingReviews: number;
        recentLabUploads: number;
        todayEncounters: number;
      };

      expect(result.totalPatients).toBe(3);
      expect(result.activePatients).toBe(2);
      expect(result.criticalAlerts).toBe(1);
      expect(result.pendingReviews).toBe(2);
      expect(result.todayEncounters).toBe(0);
    });

    test('returns zeros when no data', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [], count: 0 }));

      const result = await caller.getStats({}) as {
        totalPatients: number;
        activePatients: number;
        criticalAlerts: number;
      };
      expect(result.totalPatients).toBe(0);
      expect(result.activePatients).toBe(0);
      expect(result.criticalAlerts).toBe(0);
    });
  });

  describe('getRecentActivity', () => {
    test('aggregates and sorts activities from multiple sources', async () => {
      const patientsData = [makePatientRow()];
      const labDocs = [makeLabDocumentRow({ uploaded_at: '2026-01-14T10:00:00Z' })];
      const alerts = [makeAlertEventRow({ created_at: '2026-01-15T12:00:00Z' })];
      const newPatients = [makePatientRow({ created_at: '2026-01-13T00:00:00Z' })];

      let callCount = 0;
      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_patients') {
          callCount++;
          if (callCount <= 1) return createChainableMock({ data: patientsData });
          return createChainableMock({ data: newPatients });
        }
        if (table === 'clinic_lab_documents') return createChainableMock({ data: labDocs });
        if (table === 'clinic_alert_events') return createChainableMock({ data: alerts });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getRecentActivity({ limit: 20 }) as {
        id: string;
        type: string;
        timestamp: string;
      }[];

      expect(result.length).toBeGreaterThan(0);
      for (let i = 0; i < result.length - 1; i++) {
        expect(new Date(result[i].timestamp).getTime()).toBeGreaterThanOrEqual(
          new Date(result[i + 1].timestamp).getTime()
        );
      }
    });

    test('returns empty array when no activity', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [] }));
      const result = await caller.getRecentActivity({}) as unknown[];
      expect(result).toEqual([]);
    });
  });

  describe('getPendingReviews', () => {
    test('returns pending documents and active alerts sorted by priority', async () => {
      const patientsData = [makePatientRow()];
      const pendingDocs = [makeLabDocumentRow({ processing_status: 'pending', uploaded_at: '2026-01-14T10:00:00Z' })];
      const activeAlerts = [makeAlertEventRow({ severity: 'critical', status: 'new', created_at: '2026-01-15T12:00:00Z' })];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_patients') return createChainableMock({ data: patientsData });
        if (table === 'clinic_lab_documents') return createChainableMock({ data: pendingDocs });
        if (table === 'clinic_alert_events') return createChainableMock({ data: activeAlerts });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getPendingReviews({}) as {
        id: string;
        type: string;
        priority: string;
      }[];

      expect(result.length).toBe(2);
      expect(result[0].priority).toBe('critical');
    });

    test('returns empty when nothing pending', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [] }));
      const result = await caller.getPendingReviews({}) as unknown[];
      expect(result).toEqual([]);
    });
  });

  describe('getPatientList', () => {
    test('returns patients with alert counts', async () => {
      const patients = [makePatientRow(), makePatientRow({ id: 'p2', first_name: 'John' })];
      const alerts = [
        makeAlertEventRow({ patient_id: 'patient-001', status: 'new' }),
        makeAlertEventRow({ id: 'a2', patient_id: 'patient-001', status: 'viewed' }),
      ];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_patients') return createChainableMock({ data: patients });
        if (table === 'clinic_alert_events') return createChainableMock({ data: alerts });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getPatientList({}) as {
        id: string;
        alertCount: number;
        latestAlert?: { id: string };
      }[];

      expect(result.length).toBe(2);
      const p1 = result.find((p) => p.id === 'patient-001');
      expect(p1?.alertCount).toBe(2);
      expect(p1?.latestAlert).toBeDefined();
    });

    test('filters patients with alerts when hasAlerts=true', async () => {
      const patients = [
        makePatientRow({ id: 'p1' }),
        makePatientRow({ id: 'p2' }),
      ];
      const alerts = [makeAlertEventRow({ patient_id: 'p1', status: 'new' })];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_patients') return createChainableMock({ data: patients });
        if (table === 'clinic_alert_events') return createChainableMock({ data: alerts });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getPatientList({ hasAlerts: true }) as { id: string }[];
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('p1');
    });

    test('filters patients without alerts when hasAlerts=false', async () => {
      const patients = [
        makePatientRow({ id: 'p1' }),
        makePatientRow({ id: 'p2' }),
      ];
      const alerts = [makeAlertEventRow({ patient_id: 'p1', status: 'new' })];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_patients') return createChainableMock({ data: patients });
        if (table === 'clinic_alert_events') return createChainableMock({ data: alerts });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getPatientList({ hasAlerts: false }) as { id: string }[];
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('p2');
    });

    test('sorts by name', async () => {
      const patients = [
        makePatientRow({ id: 'p1', first_name: 'Zara', last_name: 'Adams' }),
        makePatientRow({ id: 'p2', first_name: 'Alice', last_name: 'Baker' }),
      ];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_patients') return createChainableMock({ data: patients });
        if (table === 'clinic_alert_events') return createChainableMock({ data: [] });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getPatientList({ sortBy: 'name' }) as { firstName: string; lastName: string }[];
      expect(result[0].lastName).toBe('Adams');
      expect(result[1].lastName).toBe('Baker');
    });

    test('sorts by alertCount', async () => {
      const patients = [
        makePatientRow({ id: 'p1' }),
        makePatientRow({ id: 'p2' }),
      ];
      const alerts = [
        makeAlertEventRow({ patient_id: 'p2', status: 'new' }),
        makeAlertEventRow({ id: 'a2', patient_id: 'p2', status: 'new' }),
        makeAlertEventRow({ id: 'a3', patient_id: 'p1', status: 'new' }),
      ];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_patients') return createChainableMock({ data: patients });
        if (table === 'clinic_alert_events') return createChainableMock({ data: alerts });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getPatientList({ sortBy: 'alertCount' }) as { id: string; alertCount: number }[];
      expect(result[0].id).toBe('p2');
      expect(result[0].alertCount).toBe(2);
    });

    test('returns empty when no patients', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [] }));
      const result = await caller.getPatientList({}) as unknown[];
      expect(result).toEqual([]);
    });
  });

  describe('getPatientOverview', () => {
    test('returns patient with aggregated data', async () => {
      const patient = makePatientRow();
      const alerts = [makeAlertEventRow({ status: 'new' }), makeAlertEventRow({ id: 'a2', status: 'viewed' })];
      const labResults = [makeLabResultRow()];
      const bioReadings = [makeBiometricReadingRow()];
      const labDocs = [makeLabDocumentRow()];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_patients') return createChainableMock({ data: patient });
        if (table === 'clinic_alert_events') return createChainableMock({ data: alerts });
        if (table === 'clinic_lab_results') return createChainableMock({ data: labResults });
        if (table === 'clinic_biometric_readings') return createChainableMock({ data: bioReadings });
        if (table === 'clinic_lab_documents') return createChainableMock({ data: labDocs });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getPatientOverview({ patientId: 'patient-001' }) as {
        patient: { id: string } | null;
        alertCount: number;
        labCount: number;
        biometricCount: number;
        recentAlerts: unknown[];
        timeline: unknown[];
      };

      expect(result.patient?.id).toBe('patient-001');
      expect(result.alertCount).toBe(2);
      expect(result.labCount).toBe(1);
      expect(result.biometricCount).toBe(1);
      expect(result.recentAlerts.length).toBeLessThanOrEqual(5);
      expect(result.timeline.length).toBeGreaterThan(0);
    });

    test('returns null patient when not found', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'not found' } }));

      const result = await caller.getPatientOverview({ patientId: 'nonexistent' }) as {
        patient: unknown;
        alertCount: number;
      };
      expect(result.patient).toBeNull();
      expect(result.alertCount).toBe(0);
    });
  });

  describe('getAlertInbox', () => {
    test('returns paginated alerts with patient names', async () => {
      const alerts = [
        makeAlertEventRow({ patient_id: 'p1', status: 'new' }),
        makeAlertEventRow({ id: 'a2', patient_id: 'p2', status: 'viewed' }),
      ];
      const patients = [
        { id: 'p1', first_name: 'Jane', last_name: 'Doe' },
        { id: 'p2', first_name: 'John', last_name: 'Smith' },
      ];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_alert_events') return createChainableMock({ data: alerts, count: 2 });
        if (table === 'clinic_patients') return createChainableMock({ data: patients });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getAlertInbox({}) as {
        alerts: { patientName: string; status: string }[];
        total: number;
        page: number;
        totalPages: number;
      };

      expect(result.alerts.length).toBe(2);
      expect(result.total).toBe(2);
      expect(result.alerts[0].patientName).toBeDefined();
    });

    test('defaults to new/viewed status filter', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_alert_events') {
          const chain = createChainableMock({ data: [], count: 0 });
          return chain;
        }
        return createChainableMock({ data: [] });
      });

      const result = await caller.getAlertInbox({}) as { alerts: unknown[] };
      expect(result.alerts).toEqual([]);
    });

    test('throws on supabase error', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'fail' } }));
      await expect(caller.getAlertInbox({})).rejects.toThrow();
    });
  });
});
