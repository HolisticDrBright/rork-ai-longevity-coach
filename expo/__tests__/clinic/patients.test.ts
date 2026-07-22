import { describe, test, expect, vi, beforeEach } from 'vitest';
import { makePatientRow, makeHealthHistoryRow, makeAlertEventRow, makeLabDocumentRow, makeLabResultRow, makeBiometricReadingRow } from './test-helpers';
import { mockFrom, createChainableMock, mockCtx } from '../setup';

import { patientsRouter } from '../../backend/trpc/routes/clinic/patients';
import { createTRPCRouter } from '../../backend/trpc/create-context';

function createTestCaller() {
  const router = createTRPCRouter({ patients: patientsRouter });
  const caller = router.createCaller(mockCtx as never);
  return (caller as unknown as { patients: Record<string, (input: Record<string, unknown>) => Promise<unknown>> }).patients;
}

describe('patientsRouter handlers', () => {
  let caller: ReturnType<typeof createTestCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = createTestCaller();
  });

  describe('list', () => {
    test('returns paginated patients', async () => {
      const patients = [makePatientRow(), makePatientRow({ id: 'p2', first_name: 'John' })];
      mockFrom.mockReturnValue(createChainableMock({ data: patients, count: 2 }));

      const result = await caller.list({}) as {
        data: { id: string; firstName: string }[];
        total: number;
        page: number;
        totalPages: number;
      };

      expect(result.data.length).toBe(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.data[0].firstName).toBe('Jane');
    });

    test('returns empty list', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [], count: 0 }));
      const result = await caller.list({}) as { data: unknown[]; total: number };
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    test('filters by tags on client side', async () => {
      const patients = [
        makePatientRow({ id: 'p1', tags: ['diabetes'] }),
        makePatientRow({ id: 'p2', tags: ['cardio'] }),
        makePatientRow({ id: 'p3', tags: ['diabetes', 'cardio'] }),
      ];
      mockFrom.mockReturnValue(createChainableMock({ data: patients, count: 3 }));

      const result = await caller.list({ tags: ['diabetes'] }) as {
        data: { id: string }[];
      };
      expect(result.data.length).toBe(2);
      expect(result.data.map((p: { id: string }) => p.id)).toContain('p1');
      expect(result.data.map((p: { id: string }) => p.id)).toContain('p3');
    });

    test('throws on supabase error', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'db fail' } }));
      await expect(caller.list({})).rejects.toThrow();
    });
  });

  describe('getById', () => {
    test('returns patient by ID', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: makePatientRow() }));
      const result = await caller.getById({ id: 'patient-001' }) as { id: string; firstName: string } | null;
      expect(result?.id).toBe('patient-001');
      expect(result?.firstName).toBe('Jane');
    });

    test('returns null when not found', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'not found' } }));
      const result = await caller.getById({ id: 'nonexistent' });
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    test('creates patient and initializes health history', async () => {
      const newPatient = makePatientRow({ id: 'p-new' });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_patients') return createChainableMock({ data: newPatient });
        if (table === 'clinic_health_histories') return createChainableMock({ data: null });
        return createChainableMock({ data: [] });
      });

      const result = await caller.create({
        firstName: 'Jane',
        lastName: 'Doe',
        dateOfBirth: '1985-06-15',
        sex: 'female',
      }) as { id: string };

      expect(result.id).toBe('p-new');
      expect(mockFrom).toHaveBeenCalledWith('clinic_health_histories');
    });

    test('throws on insert error', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'insert fail' } }));
      await expect(caller.create({
        firstName: 'X',
        lastName: 'Y',
        dateOfBirth: '2000-01-01',
        sex: 'male',
      })).rejects.toThrow();
    });
  });

  describe('update', () => {
    test('updates patient fields', async () => {
      const updated = makePatientRow({ first_name: 'Janet' });
      mockFrom.mockReturnValue(createChainableMock({ data: updated }));

      const result = await caller.update({ id: 'patient-001', firstName: 'Janet' }) as { firstName: string };
      expect(result.firstName).toBe('Janet');
    });

    test('throws NOT_FOUND on error', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'not found' } }));
      await expect(caller.update({ id: 'bad', firstName: 'X' })).rejects.toThrow();
    });
  });

  describe('delete', () => {
    test('archives patient (soft delete)', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null }));
      const result = await caller.delete({ id: 'patient-001' }) as { success: boolean };
      expect(result.success).toBe(true);
    });
  });

  describe('getHealthHistory', () => {
    test('returns health history', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: makeHealthHistoryRow() }));
      const result = await caller.getHealthHistory({ patientId: 'patient-001' }) as {
        patientId: string;
        conditions: string[];
      } | null;
      expect(result?.patientId).toBe('patient-001');
      expect(result?.conditions).toContain('type_2_diabetes');
    });

    test('returns null when no history', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'not found' } }));
      const result = await caller.getHealthHistory({ patientId: 'p-new' });
      expect(result).toBeNull();
    });
  });

  describe('updateHealthHistory', () => {
    test('upserts health history', async () => {
      const updated = makeHealthHistoryRow({ conditions: ['type_2_diabetes', 'obesity'] });
      mockFrom.mockReturnValue(createChainableMock({ data: updated }));

      const result = await caller.updateHealthHistory({
        patientId: 'patient-001',
        conditions: ['type_2_diabetes', 'obesity'],
      }) as { conditions: string[] };
      expect(result.conditions).toContain('obesity');
    });

    test('throws on upsert error', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'fail' } }));
      await expect(caller.updateHealthHistory({
        patientId: 'p1',
        conditions: ['x'],
      })).rejects.toThrow();
    });
  });

  describe('getTimeline', () => {
    test('aggregates and sorts events from multiple sources', async () => {
      const labDocs = [makeLabDocumentRow({ uploaded_at: '2026-01-14T10:00:00Z' })];
      const labResults = [makeLabResultRow({ created_at: '2026-01-13T10:00:00Z' })];
      const bioReadings = [makeBiometricReadingRow({ reading_time: '2026-01-15T08:00:00Z', created_at: '2026-01-15T08:00:00Z' })];
      const alerts = [makeAlertEventRow({ created_at: '2026-01-15T12:00:00Z' })];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_lab_documents') return createChainableMock({ data: labDocs });
        if (table === 'clinic_lab_results') return createChainableMock({ data: labResults });
        if (table === 'clinic_biometric_readings') return createChainableMock({ data: bioReadings });
        if (table === 'clinic_alert_events') return createChainableMock({ data: alerts });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getTimeline({ patientId: 'patient-001' }) as {
        patientId: string;
        events: { type: string; date: string }[];
      };

      expect(result.patientId).toBe('patient-001');
      expect(result.events.length).toBe(4);
      expect(result.events[0].type).toBe('alert');
    });

    test('returns empty timeline when no data', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [] }));
      const result = await caller.getTimeline({ patientId: 'p1' }) as {
        events: unknown[];
      };
      expect(result.events).toEqual([]);
    });
  });

  describe('exportRecord', () => {
    test('returns placeholder export URL', async () => {
      const result = await caller.exportRecord({
        patientId: 'patient-001',
        format: 'json',
      }) as { downloadUrl: string; expiresAt: string };
      expect(result.downloadUrl).toContain('exports');
      expect(result.expiresAt).toBeDefined();
    });
  });

  describe('getTags', () => {
    test('returns unique sorted tags from all patients', async () => {
      mockFrom.mockReturnValue(createChainableMock({
        data: [
          { tags: ['diabetes', 'high-risk'] },
          { tags: ['cardio', 'diabetes'] },
          { tags: null },
        ],
      }));

      const result = await caller.getTags({}) as string[];
      expect(result).toEqual(['cardio', 'diabetes', 'high-risk']);
    });

    test('returns empty array when no patients', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [] }));
      const result = await caller.getTags({}) as string[];
      expect(result).toEqual([]);
    });
  });
});
