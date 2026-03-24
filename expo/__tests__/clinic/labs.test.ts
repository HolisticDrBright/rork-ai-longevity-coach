import { describe, test, expect, vi, beforeEach } from 'vitest';
import { makeLabDocumentRow, makeLabTestRow, makeLabResultRow } from './test-helpers';
import { mockFrom, createChainableMock, mockCtx } from '../setup';

import { labsRouter } from '../../backend/trpc/routes/clinic/labs';
import { createTRPCRouter } from '../../backend/trpc/create-context';

function createTestCaller() {
  const router = createTRPCRouter({ labs: labsRouter });
  const caller = router.createCaller(mockCtx as never);
  return (caller as unknown as { labs: Record<string, (input: Record<string, unknown>) => Promise<unknown>> }).labs;
}

describe('labsRouter handlers', () => {
  let caller: ReturnType<typeof createTestCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = createTestCaller();
  });

  describe('listDocuments', () => {
    test('returns paginated lab documents', async () => {
      const docs = [makeLabDocumentRow(), makeLabDocumentRow({ id: 'doc-002' })];
      mockFrom.mockReturnValue(createChainableMock({ data: docs, count: 2 }));

      const result = await caller.listDocuments({ patientId: 'patient-001' }) as {
        data: unknown[];
        total: number;
        page: number;
      };

      expect(result.data.length).toBe(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
    });

    test('returns empty for patient with no documents', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [], count: 0 }));

      const result = await caller.listDocuments({ patientId: 'patient-999' }) as {
        data: unknown[];
        total: number;
      };
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    test('throws on supabase error', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'db fail' } }));
      await expect(caller.listDocuments({ patientId: 'p1' })).rejects.toThrow();
    });
  });

  describe('uploadDocument', () => {
    test('inserts and returns new document', async () => {
      const newDoc = makeLabDocumentRow({ id: 'doc-new', processing_status: 'pending' });
      mockFrom.mockReturnValue(createChainableMock({ data: newDoc }));

      const result = await caller.uploadDocument({
        patientId: 'patient-001',
        fileName: 'labs.pdf',
        fileType: 'pdf',
        fileSizeBytes: 100000,
        storagePath: 'labs/patient-001/labs.pdf',
        uploadedBy: 'clinician-001',
      }) as { id: string; processingStatus: string };

      expect(result.id).toBe('doc-new');
      expect(result.processingStatus).toBe('pending');
    });

    test('throws on insert error', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'insert failed' } }));
      await expect(caller.uploadDocument({
        patientId: 'p1',
        fileName: 'x.pdf',
        fileType: 'pdf',
        fileSizeBytes: 100,
        storagePath: 'x',
        uploadedBy: 'c1',
      })).rejects.toThrow();
    });
  });

  describe('getDocumentDownloadUrl', () => {
    test('returns signed URL for existing document', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: { storage_path: 'labs/test.pdf' } }));

      const result = await caller.getDocumentDownloadUrl({ documentId: 'doc-001' }) as {
        url: string;
        expiresAt: string;
      };
      expect(result.url).toContain('signed');
      expect(result.expiresAt).toBeDefined();
    });

    test('throws NOT_FOUND for missing document', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'not found' } }));
      await expect(caller.getDocumentDownloadUrl({ documentId: 'bad' })).rejects.toThrow();
    });
  });

  describe('deleteDocument', () => {
    test('deletes results and document', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null }));

      const result = await caller.deleteDocument({ documentId: 'doc-001' }) as { success: boolean };
      expect(result.success).toBe(true);
    });
  });

  describe('listTests', () => {
    test('returns lab tests', async () => {
      const tests = [makeLabTestRow(), makeLabTestRow({ id: 'lt-002', code: 'FT4', name: 'Free T4' })];
      mockFrom.mockReturnValue(createChainableMock({ data: tests }));

      const result = await caller.listTests({}) as unknown[];
      expect(result.length).toBe(2);
    });

    test('returns empty array when no tests', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: [] }));
      const result = await caller.listTests({}) as unknown[];
      expect(result).toEqual([]);
    });
  });

  describe('getTestByCode', () => {
    test('returns test by code', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: makeLabTestRow() }));
      const result = await caller.getTestByCode({ code: 'TSH' }) as { code: string } | null;
      expect(result?.code).toBe('TSH');
    });

    test('returns null for unknown code', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'not found' } }));
      const result = await caller.getTestByCode({ code: 'UNKNOWN' });
      expect(result).toBeNull();
    });
  });

  describe('listResults', () => {
    test('returns paginated results with lab tests attached', async () => {
      const results = [makeLabResultRow(), makeLabResultRow({ id: 'r2' })];
      const tests = [makeLabTestRow()];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_lab_results') return createChainableMock({ data: results, count: 2 });
        if (table === 'clinic_lab_tests') return createChainableMock({ data: tests });
        return createChainableMock({ data: [] });
      });

      const result = await caller.listResults({ patientId: 'patient-001' }) as {
        data: { labTest?: { code: string } }[];
        total: number;
      };

      expect(result.data.length).toBe(2);
      expect(result.total).toBe(2);
    });
  });

  describe('addResult', () => {
    test('adds result with calculated status', async () => {
      const labTest = makeLabTestRow();
      const newResult = makeLabResultRow({ id: 'new-result', value: 8.0, status: 'high' });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_lab_tests') return createChainableMock({ data: labTest });
        if (table === 'clinic_lab_results') return createChainableMock({ data: newResult });
        return createChainableMock({ data: [] });
      });

      const result = await caller.addResult({
        patientId: 'patient-001',
        labTestId: 'labtest-001',
        value: 8.0,
        unit: 'mIU/L',
        resultDate: '2026-01-15',
        enteredBy: 'clinician-001',
      }) as { id: string; value: number };

      expect(result.id).toBe('new-result');
    });

    test('throws NOT_FOUND when lab test does not exist', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'not found' } }));

      await expect(caller.addResult({
        patientId: 'p1',
        labTestId: 'nonexistent',
        value: 5.0,
        unit: 'mIU/L',
        resultDate: '2026-01-15',
        enteredBy: 'c1',
      })).rejects.toThrow('Lab test not found');
    });
  });

  describe('updateResult', () => {
    test('updates result and recalculates status', async () => {
      const existing = makeLabResultRow();
      const labTest = makeLabTestRow();
      const updated = makeLabResultRow({ value: 3.0 });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_lab_results') return createChainableMock({ data: existing });
        if (table === 'clinic_lab_tests') return createChainableMock({ data: labTest });
        return createChainableMock({ data: updated });
      });

      const result = await caller.updateResult({ id: 'result-001', value: 3.0 }) as { id: string };
      expect(result.id).toBeDefined();
    });

    test('throws NOT_FOUND for missing result', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null, error: { message: 'not found' } }));
      await expect(caller.updateResult({ id: 'bad' })).rejects.toThrow();
    });
  });

  describe('deleteResult', () => {
    test('deletes result and returns success', async () => {
      mockFrom.mockReturnValue(createChainableMock({ data: null }));
      const result = await caller.deleteResult({ id: 'result-001' }) as { success: boolean };
      expect(result.success).toBe(true);
    });
  });

  describe('getTestCategories', () => {
    test('returns unique sorted categories', async () => {
      mockFrom.mockReturnValue(createChainableMock({
        data: [{ category: 'thyroid' }, { category: 'metabolic' }, { category: 'thyroid' }],
      }));

      const result = await caller.getTestCategories({}) as string[];
      expect(result).toEqual(['metabolic', 'thyroid']);
    });
  });

  describe('getPatientLabSummary', () => {
    test('returns aggregated lab summary', async () => {
      const results = [
        { status: 'normal', result_date: '2026-01-10' },
        { status: 'high', result_date: '2026-01-12' },
        { status: 'critical_low', result_date: '2026-01-14' },
      ];
      const pendingDocs = [{ processing_status: 'pending' }];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'clinic_lab_results') return createChainableMock({ data: results });
        if (table === 'clinic_lab_documents') return createChainableMock({ data: pendingDocs });
        return createChainableMock({ data: [] });
      });

      const result = await caller.getPatientLabSummary({ patientId: 'patient-001' }) as {
        totalResults: number;
        abnormalResults: number;
        criticalResults: number;
        lastLabDate: string;
        pendingDocuments: number;
      };

      expect(result.totalResults).toBe(3);
      expect(result.abnormalResults).toBe(2);
      expect(result.criticalResults).toBe(1);
      expect(result.lastLabDate).toBe('2026-01-14');
      expect(result.pendingDocuments).toBe(1);
    });
  });
});
