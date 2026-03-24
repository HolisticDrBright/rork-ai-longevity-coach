import { z } from "zod";
import { publicProcedure, createTRPCRouter } from "../../create-context";
import type {
  LabDocument,
  LabTest,
  LabResult,
  LabResultStatus,
  PaginatedResponse,
} from "@/types/clinic";

const labDocumentStore: Map<string, LabDocument> = new Map();
const labTestStore: Map<string, LabTest> = new Map();
const labResultStore: Map<string, LabResult> = new Map();

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function calculateLabStatus(
  value: number,
  refLow?: number,
  refHigh?: number,
  critLow?: number,
  critHigh?: number
): LabResultStatus {
  if (critLow !== undefined && value < critLow) return 'critical_low';
  if (critHigh !== undefined && value > critHigh) return 'critical_high';
  if (refLow !== undefined && value < refLow) return 'low';
  if (refHigh !== undefined && value > refHigh) return 'high';
  return 'normal';
}

initializeLabTests();

function initializeLabTests() {
  const defaultTests: Omit<LabTest, 'id'>[] = [
    { code: 'GLUCOSE', name: 'Glucose (Fasting)', category: 'metabolic', unit: 'mg/dL', refRangeLow: 70, refRangeHigh: 100, functionalRangeLow: 75, functionalRangeHigh: 90, criticalLow: 50, criticalHigh: 400, isActive: true },
    { code: 'HBA1C', name: 'Hemoglobin A1c', category: 'metabolic', unit: '%', refRangeLow: 4.0, refRangeHigh: 5.6, functionalRangeLow: 4.5, functionalRangeHigh: 5.3, criticalHigh: 10, isActive: true },
    { code: 'INSULIN', name: 'Insulin (Fasting)', category: 'metabolic', unit: 'uIU/mL', refRangeLow: 2.6, refRangeHigh: 24.9, functionalRangeLow: 3, functionalRangeHigh: 8, isActive: true },
    { code: 'CHOL_TOTAL', name: 'Total Cholesterol', category: 'lipid', unit: 'mg/dL', refRangeHigh: 200, functionalRangeHigh: 180, criticalHigh: 300, isActive: true },
    { code: 'LDL', name: 'LDL Cholesterol', category: 'lipid', unit: 'mg/dL', refRangeHigh: 100, functionalRangeHigh: 80, criticalHigh: 190, isActive: true },
    { code: 'HDL', name: 'HDL Cholesterol', category: 'lipid', unit: 'mg/dL', refRangeLow: 40, functionalRangeLow: 60, isActive: true },
    { code: 'TRIG', name: 'Triglycerides', category: 'lipid', unit: 'mg/dL', refRangeHigh: 150, functionalRangeHigh: 100, criticalHigh: 500, isActive: true },
    { code: 'TSH', name: 'TSH', category: 'thyroid', unit: 'mIU/L', refRangeLow: 0.45, refRangeHigh: 4.5, functionalRangeLow: 1.0, functionalRangeHigh: 2.5, isActive: true },
    { code: 'FREE_T4', name: 'Free T4', category: 'thyroid', unit: 'ng/dL', refRangeLow: 0.82, refRangeHigh: 1.77, functionalRangeLow: 1.0, functionalRangeHigh: 1.5, isActive: true },
    { code: 'FREE_T3', name: 'Free T3', category: 'thyroid', unit: 'pg/mL', refRangeLow: 2.0, refRangeHigh: 4.4, functionalRangeLow: 3.0, functionalRangeHigh: 4.0, isActive: true },
    { code: 'VITD', name: 'Vitamin D, 25-Hydroxy', category: 'vitamin', unit: 'ng/mL', refRangeLow: 30, refRangeHigh: 100, functionalRangeLow: 50, functionalRangeHigh: 80, criticalLow: 10, isActive: true },
    { code: 'B12', name: 'Vitamin B12', category: 'vitamin', unit: 'pg/mL', refRangeLow: 211, refRangeHigh: 946, functionalRangeLow: 500, functionalRangeHigh: 800, criticalLow: 150, isActive: true },
    { code: 'FERRITIN', name: 'Ferritin', category: 'iron', unit: 'ng/mL', refRangeLow: 12, refRangeHigh: 150, functionalRangeLow: 50, functionalRangeHigh: 100, isActive: true },
    { code: 'IRON', name: 'Serum Iron', category: 'iron', unit: 'mcg/dL', refRangeLow: 60, refRangeHigh: 170, functionalRangeLow: 85, functionalRangeHigh: 130, isActive: true },
    { code: 'CREATININE', name: 'Creatinine', category: 'kidney', unit: 'mg/dL', refRangeLow: 0.7, refRangeHigh: 1.3, functionalRangeLow: 0.8, functionalRangeHigh: 1.1, criticalHigh: 4.0, isActive: true },
    { code: 'BUN', name: 'Blood Urea Nitrogen', category: 'kidney', unit: 'mg/dL', refRangeLow: 6, refRangeHigh: 20, functionalRangeLow: 10, functionalRangeHigh: 16, criticalHigh: 100, isActive: true },
    { code: 'EGFR', name: 'eGFR', category: 'kidney', unit: 'mL/min/1.73m2', refRangeLow: 90, criticalLow: 15, isActive: true },
    { code: 'ALT', name: 'ALT (SGPT)', category: 'liver', unit: 'U/L', refRangeHigh: 33, functionalRangeHigh: 25, criticalHigh: 200, isActive: true },
    { code: 'AST', name: 'AST (SGOT)', category: 'liver', unit: 'U/L', refRangeHigh: 32, functionalRangeHigh: 25, criticalHigh: 200, isActive: true },
    { code: 'CRP', name: 'C-Reactive Protein (hs)', category: 'inflammation', unit: 'mg/L', refRangeHigh: 3.0, functionalRangeHigh: 1.0, criticalHigh: 10, isActive: true },
    { code: 'HOMOCYSTEINE', name: 'Homocysteine', category: 'cardiovascular', unit: 'umol/L', refRangeHigh: 15, functionalRangeHigh: 8, criticalHigh: 50, isActive: true },
  ];

  defaultTests.forEach((test) => {
    const id = generateId();
    labTestStore.set(id, { id, ...test });
  });
  console.log('[Labs] Initialized', labTestStore.size, 'lab test definitions');
}

export const labsRouter = createTRPCRouter({
  listDocuments: publicProcedure
    .input(
      z.object({
        patientId: z.string(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
        status: z.enum(['pending', 'processing', 'parsed', 'manual_entry', 'error']).optional(),
      })
    )
    .query(async ({ input }): Promise<PaginatedResponse<LabDocument>> => {
      console.log('[Labs] Listing documents for patient:', input.patientId);
      
      let documents = Array.from(labDocumentStore.values()).filter(
        (doc) => doc.patientId === input.patientId
      );

      if (input.status) {
        documents = documents.filter((doc) => doc.processingStatus === input.status);
      }

      documents.sort(
        (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );

      const total = documents.length;
      const totalPages = Math.ceil(total / input.limit);
      const startIndex = (input.page - 1) * input.limit;
      const paginatedDocs = documents.slice(startIndex, startIndex + input.limit);

      return {
        data: paginatedDocs,
        total,
        page: input.page,
        limit: input.limit,
        totalPages,
      };
    }),

  uploadDocument: publicProcedure
    .input(
      z.object({
        patientId: z.string(),
        fileName: z.string(),
        fileType: z.enum(['pdf', 'jpg', 'png']),
        fileSizeBytes: z.number(),
        storagePath: z.string(),
        labDate: z.string().optional(),
        labCompany: z.string().optional(),
        orderingProvider: z.string().optional(),
        panelName: z.string().optional(),
        uploadedBy: z.string(),
      })
    )
    .mutation(async ({ input }): Promise<LabDocument> => {
      console.log('[Labs] Uploading document for patient:', input.patientId);
      
      const now = new Date().toISOString();
      const document: LabDocument = {
        id: generateId(),
        ...input,
        processingStatus: 'pending',
        uploadedAt: now,
        createdAt: now,
      };

      labDocumentStore.set(document.id, document);
      console.log('[Labs] Document uploaded successfully:', document.id);
      
      return document;
    }),

  getDocumentDownloadUrl: publicProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ input }): Promise<{ url: string; expiresAt: string }> => {
      console.log('[Labs] Getting download URL for document:', input.documentId);
      
      const document = labDocumentStore.get(input.documentId);
      if (!document) {
        throw new Error('Document not found');
      }

      return {
        url: `https://example.com/signed/${document.storagePath}?token=xxx`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
    }),

  deleteDocument: publicProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ input }): Promise<{ success: boolean }> => {
      console.log('[Labs] Deleting document:', input.documentId);
      
      if (!labDocumentStore.has(input.documentId)) {
        throw new Error('Document not found');
      }

      labDocumentStore.delete(input.documentId);
      
      labResultStore.forEach((result, id) => {
        if (result.labDocumentId === input.documentId) {
          labResultStore.delete(id);
        }
      });

      return { success: true };
    }),

  listTests: publicProcedure
    .input(
      z.object({
        category: z.string().optional(),
        search: z.string().optional(),
        activeOnly: z.boolean().default(true),
      })
    )
    .query(async ({ input }): Promise<LabTest[]> => {
      console.log('[Labs] Listing lab tests');
      
      let tests = Array.from(labTestStore.values());

      if (input.activeOnly) {
        tests = tests.filter((t) => t.isActive);
      }

      if (input.category) {
        tests = tests.filter((t) => t.category === input.category);
      }

      if (input.search) {
        const searchLower = input.search.toLowerCase();
        tests = tests.filter(
          (t) =>
            t.name.toLowerCase().includes(searchLower) ||
            t.code.toLowerCase().includes(searchLower)
        );
      }

      return tests.sort((a, b) => a.name.localeCompare(b.name));
    }),

  getTestByCode: publicProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }): Promise<LabTest | null> => {
      return Array.from(labTestStore.values()).find((t) => t.code === input.code) || null;
    }),

  listResults: publicProcedure
    .input(
      z.object({
        patientId: z.string(),
        labTestId: z.string().optional(),
        labCode: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        status: z.enum(['normal', 'low', 'high', 'critical_low', 'critical_high']).optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }): Promise<PaginatedResponse<LabResult>> => {
      console.log('[Labs] Listing results for patient:', input.patientId);
      
      let results = Array.from(labResultStore.values()).filter(
        (r) => r.patientId === input.patientId
      );

      if (input.labTestId) {
        results = results.filter((r) => r.labTestId === input.labTestId);
      }

      if (input.labCode) {
        const test = Array.from(labTestStore.values()).find((t) => t.code === input.labCode);
        if (test) {
          results = results.filter((r) => r.labTestId === test.id);
        }
      }

      if (input.startDate) {
        results = results.filter((r) => r.resultDate >= input.startDate!);
      }

      if (input.endDate) {
        results = results.filter((r) => r.resultDate <= input.endDate!);
      }

      if (input.status) {
        results = results.filter((r) => r.status === input.status);
      }

      results = results.map((r) => ({
        ...r,
        labTest: labTestStore.get(r.labTestId),
      }));

      results.sort(
        (a, b) => new Date(b.resultDate).getTime() - new Date(a.resultDate).getTime()
      );

      const total = results.length;
      const totalPages = Math.ceil(total / input.limit);
      const startIndex = (input.page - 1) * input.limit;
      const paginatedResults = results.slice(startIndex, startIndex + input.limit);

      return {
        data: paginatedResults,
        total,
        page: input.page,
        limit: input.limit,
        totalPages,
      };
    }),

  addResult: publicProcedure
    .input(
      z.object({
        patientId: z.string(),
        labDocumentId: z.string().optional(),
        labTestId: z.string(),
        value: z.number(),
        valueText: z.string().optional(),
        unit: z.string(),
        refRangeLow: z.number().optional(),
        refRangeHigh: z.number().optional(),
        resultDate: z.string(),
        enteredBy: z.string(),
        entryMethod: z.enum(['manual', 'parsed', 'api']).default('manual'),
      })
    )
    .mutation(async ({ input }): Promise<LabResult> => {
      console.log('[Labs] Adding result for patient:', input.patientId);
      
      const labTest = labTestStore.get(input.labTestId);
      if (!labTest) {
        throw new Error('Lab test not found');
      }

      const refLow = input.refRangeLow ?? labTest.refRangeLow;
      const refHigh = input.refRangeHigh ?? labTest.refRangeHigh;
      const critLow = labTest.criticalLow;
      const critHigh = labTest.criticalHigh;

      const status = calculateLabStatus(input.value, refLow, refHigh, critLow, critHigh);

      const result: LabResult = {
        id: generateId(),
        ...input,
        refRangeLow: refLow,
        refRangeHigh: refHigh,
        status,
        createdAt: new Date().toISOString(),
      };

      labResultStore.set(result.id, result);
      console.log('[Labs] Result added successfully:', result.id, 'Status:', status);

      return { ...result, labTest };
    }),

  updateResult: publicProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.number().optional(),
        valueText: z.string().optional(),
        unit: z.string().optional(),
        refRangeLow: z.number().optional(),
        refRangeHigh: z.number().optional(),
        resultDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<LabResult> => {
      console.log('[Labs] Updating result:', input.id);
      
      const existing = labResultStore.get(input.id);
      if (!existing) {
        throw new Error('Lab result not found');
      }

      const labTest = labTestStore.get(existing.labTestId);
      
      const { id, ...updates } = input;
      const cleanedUpdates = Object.fromEntries(
        Object.entries(updates).filter(([_, v]) => v !== undefined)
      );

      const newValue = (cleanedUpdates.value as number | undefined) ?? existing.value;
      const newRefLow = (cleanedUpdates.refRangeLow as number | undefined) ?? existing.refRangeLow;
      const newRefHigh = (cleanedUpdates.refRangeHigh as number | undefined) ?? existing.refRangeHigh;
      const critLow = labTest?.criticalLow;
      const critHigh = labTest?.criticalHigh;

      const status = calculateLabStatus(newValue, newRefLow, newRefHigh, critLow, critHigh);

      const updated: LabResult = {
        ...existing,
        ...cleanedUpdates,
        status,
      };

      labResultStore.set(id, updated);
      return { ...updated, labTest };
    }),

  deleteResult: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }): Promise<{ success: boolean }> => {
      console.log('[Labs] Deleting result:', input.id);
      
      if (!labResultStore.has(input.id)) {
        throw new Error('Lab result not found');
      }

      labResultStore.delete(input.id);
      return { success: true };
    }),

  getTestCategories: publicProcedure.query(async (): Promise<string[]> => {
    const categories = new Set<string>();
    labTestStore.forEach((test) => {
      if (test.category) {
        categories.add(test.category);
      }
    });
    return Array.from(categories).sort();
  }),

  getPatientLabSummary: publicProcedure
    .input(z.object({ patientId: z.string() }))
    .query(
      async ({
        input,
      }): Promise<{
        totalResults: number;
        abnormalResults: number;
        criticalResults: number;
        lastLabDate?: string;
        pendingDocuments: number;
      }> => {
        console.log('[Labs] Getting lab summary for patient:', input.patientId);
        
        const results = Array.from(labResultStore.values()).filter(
          (r) => r.patientId === input.patientId
        );

        const documents = Array.from(labDocumentStore.values()).filter(
          (d) => d.patientId === input.patientId
        );

        const abnormalStatuses: LabResultStatus[] = ['low', 'high', 'critical_low', 'critical_high'];
        const criticalStatuses: LabResultStatus[] = ['critical_low', 'critical_high'];

        const sortedResults = [...results].sort(
          (a, b) => new Date(b.resultDate).getTime() - new Date(a.resultDate).getTime()
        );

        return {
          totalResults: results.length,
          abnormalResults: results.filter((r) => abnormalStatuses.includes(r.status)).length,
          criticalResults: results.filter((r) => criticalStatuses.includes(r.status)).length,
          lastLabDate: sortedResults[0]?.resultDate,
          pendingDocuments: documents.filter((d) => d.processingStatus === 'pending').length,
        };
      }
    ),
});

export { labDocumentStore, labTestStore, labResultStore };
