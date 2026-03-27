import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { clinicianProcedure, createTRPCRouter } from "../../create-context";
import { createServerSupabaseClient } from "../../../supabase-server";
import type {
  LabDocument,
  LabTest,
  LabResult,
  PaginatedResponse,
} from "@/types/clinic";
import { calculateLabStatus, mapDbToLabDocument, mapDbToLabTest, mapDbToLabResult } from "./utils";
import { sanitizeSearchInput } from "../../sanitize";

export const labsRouter = createTRPCRouter({
  listDocuments: clinicianProcedure
    .input(
      z.object({
        patientId: z.string(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
        status: z.enum(['pending', 'processing', 'parsed', 'manual_entry', 'error']).optional(),
      })
    )
    .query(async ({ ctx, input }): Promise<PaginatedResponse<LabDocument>> => {
      console.log('[Labs] Listing documents for patient');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      let query = sb
        .from('clinic_lab_documents')
        .select('*', { count: 'exact' })
        .eq('patient_id', input.patientId);

      if (input.status) {
        query = query.eq('processing_status', input.status);
      }

      const offset = (input.page - 1) * input.limit;
      query = query.order('uploaded_at', { ascending: false }).range(offset, offset + input.limit - 1);

      const { data, error, count } = await query;

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list lab documents' });
      }

      const total = count ?? 0;
      return {
        data: (data ?? []).map(mapDbToLabDocument),
        total,
        page: input.page,
        limit: input.limit,
        totalPages: Math.ceil(total / input.limit),
      };
    }),

  uploadDocument: clinicianProcedure
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
    .mutation(async ({ ctx, input }): Promise<LabDocument> => {
      console.log('[Labs] Uploading document');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from('clinic_lab_documents')
        .insert({
          clinician_id: ctx.user.id,
          patient_id: input.patientId,
          file_name: input.fileName,
          file_type: input.fileType,
          file_size_bytes: input.fileSizeBytes,
          storage_path: input.storagePath,
          lab_date: input.labDate,
          lab_company: input.labCompany,
          ordering_provider: input.orderingProvider,
          panel_name: input.panelName,
          uploaded_by: input.uploadedBy,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to upload document' });
      }

      console.log('[Labs] Document uploaded successfully');
      return mapDbToLabDocument(data);
    }),

  getDocumentDownloadUrl: clinicianProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ ctx, input }): Promise<{ url: string; expiresAt: string }> => {
      console.log('[Labs] Getting download URL for document');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from('clinic_lab_documents')
        .select('storage_path')
        .eq('id', input.documentId)
        .single();

      if (error || !data) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }

      return {
        url: `https://example.com/signed/${data.storage_path}?token=xxx`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
    }),

  deleteDocument: clinicianProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }): Promise<{ success: boolean }> => {
      console.log('[Labs] Deleting document');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      await sb
        .from('clinic_lab_results')
        .delete()
        .eq('lab_document_id', input.documentId);

      const { error } = await sb
        .from('clinic_lab_documents')
        .delete()
        .eq('id', input.documentId);

      if (error) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }

      return { success: true };
    }),

  listTests: clinicianProcedure
    .input(
      z.object({
        category: z.string().optional(),
        search: z.string().optional(),
        activeOnly: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }): Promise<LabTest[]> => {
      console.log('[Labs] Listing lab tests');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      let query = sb.from('clinic_lab_tests').select('*');

      if (input.activeOnly) {
        query = query.eq('is_active', true);
      }

      if (input.category) {
        query = query.eq('category', input.category);
      }

      if (input.search) {
        const search = sanitizeSearchInput(input.search);
        query = query.or(
          `name.ilike.%${search}%,code.ilike.%${search}%`
        );
      }

      query = query.order('name');

      const { data, error } = await query;

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list lab tests' });
      }

      return (data ?? []).map(mapDbToLabTest);
    }),

  getTestByCode: clinicianProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ ctx, input }): Promise<LabTest | null> => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from('clinic_lab_tests')
        .select('*')
        .eq('code', input.code)
        .single();

      if (error) return null;
      return mapDbToLabTest(data);
    }),

  listResults: clinicianProcedure
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
    .query(async ({ ctx, input }): Promise<PaginatedResponse<LabResult>> => {
      console.log('[Labs] Listing results for patient');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      let labTestId = input.labTestId;

      if (!labTestId && input.labCode) {
        const { data: testData } = await sb
          .from('clinic_lab_tests')
          .select('id')
          .eq('code', input.labCode)
          .single();
        if (testData) labTestId = testData.id;
      }

      let query = sb
        .from('clinic_lab_results')
        .select('*', { count: 'exact' })
        .eq('patient_id', input.patientId);

      if (labTestId) query = query.eq('lab_test_id', labTestId);
      if (input.startDate) query = query.gte('result_date', input.startDate);
      if (input.endDate) query = query.lte('result_date', input.endDate);
      if (input.status) query = query.eq('status', input.status);

      const offset = (input.page - 1) * input.limit;
      query = query.order('result_date', { ascending: false }).range(offset, offset + input.limit - 1);

      const { data, error, count } = await query;

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list lab results' });
      }

      const testIds = [...new Set((data ?? []).map((r: Record<string, unknown>) => r.lab_test_id as string))];
      const testsMap = new Map<string, LabTest>();

      if (testIds.length > 0) {
        const { data: tests } = await sb
          .from('clinic_lab_tests')
          .select('*')
          .in('id', testIds);
        (tests ?? []).forEach((t: Record<string, unknown>) => {
          testsMap.set(t.id as string, mapDbToLabTest(t));
        });
      }

      const total = count ?? 0;
      return {
        data: (data ?? []).map((r: Record<string, unknown>) =>
          mapDbToLabResult(r, testsMap.get(r.lab_test_id as string))
        ),
        total,
        page: input.page,
        limit: input.limit,
        totalPages: Math.ceil(total / input.limit),
      };
    }),

  addResult: clinicianProcedure
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
    .mutation(async ({ ctx, input }): Promise<LabResult> => {
      console.log('[Labs] Adding result');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: labTest, error: testError } = await sb
        .from('clinic_lab_tests')
        .select('*')
        .eq('id', input.labTestId)
        .single();

      if (testError || !labTest) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab test not found' });
      }

      const refLow = input.refRangeLow ?? (labTest.ref_range_low as number | undefined);
      const refHigh = input.refRangeHigh ?? (labTest.ref_range_high as number | undefined);
      const critLow = labTest.critical_low as number | undefined;
      const critHigh = labTest.critical_high as number | undefined;
      const status = calculateLabStatus(input.value, refLow, refHigh, critLow, critHigh);

      const { data, error } = await sb
        .from('clinic_lab_results')
        .insert({
          clinician_id: ctx.user.id,
          patient_id: input.patientId,
          lab_document_id: input.labDocumentId,
          lab_test_id: input.labTestId,
          value: input.value,
          value_text: input.valueText,
          unit: input.unit,
          ref_range_low: refLow,
          ref_range_high: refHigh,
          status,
          result_date: input.resultDate,
          entered_by: input.enteredBy,
          entry_method: input.entryMethod,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add lab result' });
      }

      console.log('[Labs] Result added, status:', status);
      return mapDbToLabResult(data, mapDbToLabTest(labTest));
    }),

  updateResult: clinicianProcedure
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
    .mutation(async ({ ctx, input }): Promise<LabResult> => {
      console.log('[Labs] Updating result');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: existing, error: fetchError } = await sb
        .from('clinic_lab_results')
        .select('*')
        .eq('id', input.id)
        .single();

      if (fetchError || !existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab result not found' });
      }

      const { data: labTest } = await sb
        .from('clinic_lab_tests')
        .select('*')
        .eq('id', existing.lab_test_id)
        .single();

      const newValue = input.value ?? (existing.value as number);
      const newRefLow = input.refRangeLow ?? (existing.ref_range_low as number | undefined);
      const newRefHigh = input.refRangeHigh ?? (existing.ref_range_high as number | undefined);
      const critLow = labTest?.critical_low as number | undefined;
      const critHigh = labTest?.critical_high as number | undefined;
      const status = calculateLabStatus(newValue, newRefLow, newRefHigh, critLow, critHigh);

      const updateData: Record<string, unknown> = { status };
      if (input.value !== undefined) updateData.value = input.value;
      if (input.valueText !== undefined) updateData.value_text = input.valueText;
      if (input.unit !== undefined) updateData.unit = input.unit;
      if (input.refRangeLow !== undefined) updateData.ref_range_low = input.refRangeLow;
      if (input.refRangeHigh !== undefined) updateData.ref_range_high = input.refRangeHigh;
      if (input.resultDate !== undefined) updateData.result_date = input.resultDate;

      const { data, error } = await sb
        .from('clinic_lab_results')
        .update(updateData)
        .eq('id', input.id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update lab result' });
      }

      return mapDbToLabResult(data, labTest ? mapDbToLabTest(labTest) : undefined);
    }),

  deleteResult: clinicianProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }): Promise<{ success: boolean }> => {
      console.log('[Labs] Deleting result');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { error } = await sb
        .from('clinic_lab_results')
        .delete()
        .eq('id', input.id);

      if (error) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Lab result not found' });
      }

      return { success: true };
    }),

  getTestCategories: clinicianProcedure.query(async ({ ctx }): Promise<string[]> => {
    const sb = createServerSupabaseClient(ctx.sessionToken);

    const { data } = await sb
      .from('clinic_lab_tests')
      .select('category')
      .not('category', 'is', null);

    const categories = new Set<string>();
    (data ?? []).forEach((row: Record<string, unknown>) => {
      if (row.category) categories.add(row.category as string);
    });
    return Array.from(categories).sort();
  }),

  getPatientLabSummary: clinicianProcedure
    .input(z.object({ patientId: z.string() }))
    .query(
      async ({
        ctx,
        input,
      }): Promise<{
        totalResults: number;
        abnormalResults: number;
        criticalResults: number;
        lastLabDate?: string;
        pendingDocuments: number;
      }> => {
        console.log('[Labs] Getting lab summary');
        const sb = createServerSupabaseClient(ctx.sessionToken);

        const [resultsRes, docsRes] = await Promise.all([
          sb.from('clinic_lab_results').select('status,result_date').eq('patient_id', input.patientId),
          sb.from('clinic_lab_documents').select('processing_status').eq('patient_id', input.patientId).eq('processing_status', 'pending'),
        ]);

        const results = resultsRes.data ?? [];
        const abnormalStatuses = ['low', 'high', 'critical_low', 'critical_high'];
        const criticalStatuses = ['critical_low', 'critical_high'];

        const sorted = [...results].sort(
          (a, b) => new Date(b.result_date as string).getTime() - new Date(a.result_date as string).getTime()
        );

        return {
          totalResults: results.length,
          abnormalResults: results.filter((r) => abnormalStatuses.includes(r.status as string)).length,
          criticalResults: results.filter((r) => criticalStatuses.includes(r.status as string)).length,
          lastLabDate: sorted[0]?.result_date as string | undefined,
          pendingDocuments: (docsRes.data ?? []).length,
        };
      }
    ),
});
