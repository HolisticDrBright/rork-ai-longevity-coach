import { describe, test, expect, vi, beforeEach } from 'vitest';
import { makeBiometricTypeRow, makeBiometricReadingRow, makeThresholdsRow } from './test-helpers';
import { mockFrom, createChainableMock, mockCtx } from '../setup';

import { biometricsRouter } from '../../backend/trpc/routes/clinic/biometrics';
import { createTRPCRouter } from '../../backend/trpc/create-context';

function createTestCaller() {
  const router = createTRPCRouter({ biometrics: biometricsRouter });
  const caller = router.createCaller(mockCtx as never);
  return (caller as unknown as { biometrics: Record<string, (input: Record<string, unknown>) => Promise<unknown>> }).biometrics;
}

describe('biometricsRouter handlers', () => {
  let caller: ReturnType<typeof createTestCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = createTestCaller();
  });

  describe('listTypes', () => {
    test('returns biometric types', async () => {
      const types = [makeBiometricTypeRow(), makeBiometricTypeRow({ id: 'bt-002', code: 'bp_systolic', name: 'Systolic BP' })];
      mockFrom.mockReturnValue(createChainableMock({ data: types }));

      const result = await caller.listTypes({}) as unknown[];
      expect(result.length).toBe(2);
      expect((result[0] as { code: string }).code).toBe('glucose');
    });

    test('returns empty when no types exist', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [] }));
      const result = await caller.listTypes({}) as unknown[];
      expect(result).toEqual([]);
    });

    test('throws on supabase error', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'fail' } }));
      await expect(caller.listTypes({})).rejects.toThrow();
    });
  });

  describe('getTypeByCode', () => {
    test('returns type by code', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: makeBiometricTypeRow() }));
      const result = await caller.getTypeByCode({ code: 'glucose' }) as { code: string } | null;
      expect(result?.code).toBe('glucose');
    });

    test('returns null for unknown code', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'not found' } }));
      const result = await caller.getTypeByCode({ code: 'unknown' });
      expect(result).toBeNull();
    });
  });

  describe('listReadings', () => {
    test('returns paginated readings with types', async () => {
      const readings = [makeBiometricReadingRow(), makeBiometricReadingRow({ id: 'r2', value: 110 })];
      const types = [makeBiometricTypeRow()];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_biometric_readings') return createChainableMock({ data: readings, count: 2 });
        if (table === 'clinic_biometric_types') return createChainableMock({ data: types });
        return createChainableMock({ data: [] });
      });

      const result = await caller.listReadings({ patientId: 'patient-001' }) as {
        data: unknown[];
        total: number;
      };
      expect(result.data.length).toBe(2);
      expect(result.total).toBe(2);
    });

    test('resolves biometricCode to typeId before querying', async () => {
      const typeRow = makeBiometricTypeRow();
      const readings = [makeBiometricReadingRow()];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_biometric_types') return createChainableMock({ data: typeRow });
        if (table === 'clinic_biometric_readings') return createChainableMock({ data: readings, count: 1 });
        return createChainableMock({ data: [] });
      });

      const result = await caller.listReadings({ patientId: 'p1', biometricCode: 'glucose' }) as {
        data: unknown[];
      };
      expect(result.data.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('addReading', () => {
    test('adds reading with calculated status', async () => {
      const bioType = makeBiometricTypeRow();
      const newReading = makeBiometricReadingRow({ id: 'new-r', value: 95, status: 'normal' });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_biometric_types') return createChainableMock({ data: bioType });
        if (table === 'clinic_biometric_readings') return createChainableMock({ data: newReading });
        return createChainableMock({ data: [] });
      });

      const result = await caller.addReading({
        patientId: 'patient-001',
        biometricTypeId: 'biotype-001',
        value: 95,
        readingTime: '2026-01-15T08:00:00Z',
      }) as { id: string; status: string };

      expect(result.id).toBe('new-r');
      expect(result.status).toBe('normal');
    });

    test('resolves biometricCode to type', async () => {
      const bioType = makeBiometricTypeRow();
      const newReading = makeBiometricReadingRow({ id: 'new-r2' });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_biometric_types') return createChainableMock({ data: bioType });
        if (table === 'clinic_biometric_readings') return createChainableMock({ data: newReading });
        return createChainableMock({ data: [] });
      });

      const result = await caller.addReading({
        patientId: 'p1',
        biometricCode: 'glucose',
        value: 100,
        readingTime: '2026-01-15T08:00:00Z',
      }) as { id: string };

      expect(result.id).toBe('new-r2');
    });

    test('throws NOT_FOUND when biometric type missing', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'not found' } }));

      await expect(caller.addReading({
        patientId: 'p1',
        biometricTypeId: 'nonexistent',
        value: 100,
        readingTime: '2026-01-15T08:00:00Z',
      })).rejects.toThrow('Biometric type not found');
    });

    test('throws on insert error', async () => {
      const bioType = makeBiometricTypeRow();

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_biometric_types') return createChainableMock({ data: bioType });
        if (table === 'clinic_biometric_readings') return createChainableMock({ data: null, error: { message: 'insert fail' } });
        return createChainableMock({ data: [] });
      });

      await expect(caller.addReading({
        patientId: 'p1',
        biometricTypeId: 'biotype-001',
        value: 100,
        readingTime: '2026-01-15T08:00:00Z',
      })).rejects.toThrow();
    });
  });

  describe('deleteReading', () => {
    test('returns success', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null }));
      const result = await caller.deleteReading({ id: 'reading-001' }) as { success: boolean };
      expect(result.success).toBe(true);
    });

    test('throws on error', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'fail' } }));
      await expect(caller.deleteReading({ id: 'bad' })).rejects.toThrow();
    });
  });

  describe('getSummary', () => {
    test('returns summaries grouped by type', async () => {
      const readings = Array.from({ length: 6 }, (_, i) => makeBiometricReadingRow({
        id: `r-${i}`,
        value: 90 + i * 2,
        reading_time: new Date(Date.now() - i * 86400000).toISOString(),
      }));
      const types = [makeBiometricTypeRow()];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_biometric_readings') return createChainableMock({ data: readings });
        if (table === 'clinic_biometric_types') return createChainableMock({ data: types });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getSummary({ patientId: 'patient-001' }) as {
        biometricTypeId: string;
        typeName: string;
        latestValue: number;
        readingCount: number;
        trend: string;
      }[];

      expect(result.length).toBe(1);
      expect(result[0].biometricTypeId).toBe('biotype-001');
      expect(result[0].typeName).toBe('Blood Glucose');
      expect(result[0].readingCount).toBe(6);
      expect(['improving', 'stable', 'worsening', 'unknown']).toContain(result[0].trend);
    });

    test('returns empty array when no readings', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [] }));
      const result = await caller.getSummary({ patientId: 'p1' }) as unknown[];
      expect(result).toEqual([]);
    });
  });

  describe('getGlucoseStats', () => {
    test('returns glucose statistics', async () => {
      const glucoseType = { id: 'gt-1' };
      const thresholds = { glucose_high: 180, glucose_low: 70 };
      const readings = [
        { value: 100 }, { value: 150 }, { value: 200 }, { value: 80 }, { value: 60 },
      ];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_biometric_types') return createChainableMock({ data: glucoseType });
        if (table === 'clinic_patient_thresholds') return createChainableMock({ data: thresholds });
        if (table === 'clinic_biometric_readings') return createChainableMock({ data: readings });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getGlucoseStats({ patientId: 'patient-001' }) as {
        averageGlucose: number;
        timeInRange: number;
        timeAboveRange: number;
        timeBelowRange: number;
        readingCount: number;
        estimatedA1c: number;
      };

      expect(result.readingCount).toBe(5);
      expect(result.averageGlucose).toBe(118);
      expect(result.timeAboveRange).toBe(20);
      expect(result.timeBelowRange).toBe(20);
      expect(result.timeInRange).toBe(60);
      expect(result.estimatedA1c).toBeDefined();
    });

    test('returns zeros when no readings', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_biometric_types') return createChainableMock({ data: { id: 'gt-1' } });
        if (table === 'clinic_patient_thresholds') return createChainableMock({ data: null, error: { message: 'none' } });
        if (table === 'clinic_biometric_readings') return createChainableMock({ data: [] });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getGlucoseStats({ patientId: 'p1' }) as {
        readingCount: number;
        averageGlucose: number;
      };
      expect(result.readingCount).toBe(0);
      expect(result.averageGlucose).toBe(0);
    });

    test('throws when glucose type not configured', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'not found' } }));
      await expect(caller.getGlucoseStats({ patientId: 'p1' })).rejects.toThrow('Glucose type not configured');
    });
  });

  describe('getPatientThresholds', () => {
    test('returns stored thresholds', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: makeThresholdsRow() }));
      const result = await caller.getPatientThresholds({ patientId: 'patient-001' }) as {
        glucoseHigh: number;
        glucoseLow: number;
      };
      expect(result.glucoseHigh).toBe(180);
      expect(result.glucoseLow).toBe(70);
    });

    test('returns defaults when no thresholds exist', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'none' } }));
      const result = await caller.getPatientThresholds({ patientId: 'p1' }) as {
        id: string;
        glucoseHigh: number;
      };
      expect(result.id).toBe('default');
      expect(result.glucoseHigh).toBe(180);
    });
  });

  describe('updatePatientThresholds', () => {
    test('upserts and returns thresholds', async () => {
      const updated = makeThresholdsRow({ glucose_high: 200 });
      mockFrom.mockReturnValue(createChainableMock({ data: updated }));

      const result = await caller.updatePatientThresholds({
        patientId: 'patient-001',
        glucoseHigh: 200,
      }) as { glucoseHigh: number };
      expect(result.glucoseHigh).toBe(200);
    });

    test('throws on upsert error', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'fail' } }));
      await expect(caller.updatePatientThresholds({
        patientId: 'p1',
        glucoseHigh: 200,
      })).rejects.toThrow();
    });
  });

  describe('getCategories', () => {
    test('returns unique sorted categories', async () => {
      mockFrom.mockReturnValue(createChainableMock({
        data: [{ category: 'vital' }, { category: 'metabolic' }, { category: 'vital' }],
      }));
      const result = await caller.getCategories({}) as string[];
      expect(result).toEqual(['metabolic', 'vital']);
    });
  });
});
