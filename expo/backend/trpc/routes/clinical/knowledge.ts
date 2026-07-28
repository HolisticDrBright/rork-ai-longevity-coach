import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter } from '../../create-context';
import {
  adminProcedure,
  organizationProcedure,
  patientAccessProcedure,
  practitionerProcedure,
} from '../../clinical-authorization';
import { throwFromRpcError } from './rpc-errors';

const uuid = z.string().uuid();
const jsonObject = z.record(z.string(), z.unknown());
const sourceRefs = z.array(jsonObject).max(100);

function pathwayDto(row: Record<string, unknown>) {
  const versions = Array.isArray(row.clinical_pathway_versions)
    ? row.clinical_pathway_versions as Record<string, unknown>[]
    : [];
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    code: row.code as string,
    name: row.name as string,
    domainCode: row.domain_code as string,
    description: row.description as string,
    retiredAt: (row.retired_at as string | null) ?? null,
    versions: versions.map((version) => ({
      id: version.id as string,
      version: version.version as number,
      status: version.status as 'draft' | 'approved' | 'superseded' | 'retired',
      content: version.content as Record<string, unknown>,
      sourceRefs: (version.source_refs as Record<string, unknown>[]) ?? [],
      contentSha256: version.content_sha256 as string,
      changeSummary: (version.change_summary as string | null) ?? null,
      createdAt: version.created_at as string,
      approvedAt: (version.approved_at as string | null) ?? null,
    })),
  };
}

/**
 * Organization-governed clinical pathways and exact product-label versions.
 * Reads use the caller's RLS-scoped client. Mutations call migration 0026 RPCs,
 * which repeat role, tenant, state-machine, immutability, and audit checks.
 */
export const clinicalKnowledgeRouter = createTRPCRouter({
  pathways: organizationProcedure.query(async ({ ctx, input }) => {
    const organizationId = (input as { organizationId: string }).organizationId;
    const { data, error } = await ctx.clinicalDb
      .from('clinical_pathways')
      .select(
        'id, organization_id, code, name, domain_code, description, retired_at, clinical_pathway_versions ( id, version, status, content, source_refs, content_sha256, change_summary, created_at, approved_at )',
      )
      .eq('organization_id', organizationId)
      .order('name');
    if (error) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load clinical pathways' });
    }
    return (data ?? []).map((row) => pathwayDto(row as Record<string, unknown>));
  }),

  createPathway: practitionerProcedure
    .input(z.object({
      code: z.string().trim().min(2).max(80),
      name: z.string().trim().min(2).max(160),
      domainCode: z.string().trim().min(2).max(80),
      description: z.string().max(1000).default(''),
      content: jsonObject,
      sourceRefs: sourceRefs.default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('create_clinical_pathway', {
        _organization_id: input.organizationId,
        _code: input.code,
        _name: input.name,
        _domain_code: input.domainCode,
        _description: input.description,
        _content: input.content,
        _source_refs: input.sourceRefs,
      });
      if (error) throwFromRpcError(error, 'create clinical pathway');
      return data as { pathwayId: string; versionId: string; version: number };
    }),

  createDraft: practitionerProcedure
    .input(z.object({
      pathwayId: uuid,
      content: jsonObject,
      sourceRefs: sourceRefs.default([]),
      changeSummary: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('create_clinical_pathway_draft', {
        _pathway_id: input.pathwayId,
        _content: input.content,
        _source_refs: input.sourceRefs,
        _change_summary: input.changeSummary ?? null,
      });
      if (error) throwFromRpcError(error, 'create clinical pathway draft');
      return data as { versionId: string; version: number };
    }),

  approve: adminProcedure
    .input(z.object({ versionId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('approve_clinical_pathway_version', {
        _version_id: input.versionId,
      });
      if (error) throwFromRpcError(error, 'approve clinical pathway');
      return { ok: true as const };
    }),

  productLabels: organizationProcedure.query(async ({ ctx, input }) => {
    const organizationId = (input as { organizationId: string }).organizationId;
    const { data, error } = await ctx.clinicalDb
      .from('product_label_versions')
      .select(
        'id, product_code, version, product_name, brand, exact_label, label_sha256, source_url, affiliate_url, status, effective_at, expires_at, created_at, verified_at, verification_note',
      )
      .eq('organization_id', organizationId)
      .order('product_name')
      .order('version', { ascending: false });
    if (error) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load product labels' });
    }
    return (data ?? []).map((row) => ({
      id: row.id as string,
      productCode: row.product_code as string,
      version: row.version as number,
      productName: row.product_name as string,
      brand: row.brand as string,
      exactLabel: row.exact_label as Record<string, unknown>,
      labelSha256: row.label_sha256 as string,
      sourceUrl: (row.source_url as string | null) ?? null,
      affiliateUrl: (row.affiliate_url as string | null) ?? null,
      status: row.status as 'pending' | 'verified' | 'expired' | 'retired',
      effectiveAt: (row.effective_at as string | null) ?? null,
      expiresAt: (row.expires_at as string | null) ?? null,
      createdAt: row.created_at as string,
      verifiedAt: (row.verified_at as string | null) ?? null,
      verificationNote: (row.verification_note as string | null) ?? null,
    }));
  }),

  saveProductLabel: practitionerProcedure
    .input(z.object({
      productCode: z.string().trim().min(2).max(100),
      productName: z.string().trim().min(2).max(200),
      brand: z.string().trim().min(2).max(160),
      exactLabel: jsonObject,
      sourceUrl: z.string().url().max(2000).optional(),
      affiliateUrl: z.string().url().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('save_product_label_version', {
        _organization_id: input.organizationId,
        _product_code: input.productCode,
        _product_name: input.productName,
        _brand: input.brand,
        _exact_label: input.exactLabel,
        _source_url: input.sourceUrl ?? null,
        _affiliate_url: input.affiliateUrl ?? null,
      });
      if (error) throwFromRpcError(error, 'save product label version');
      return data as { labelVersionId: string; version: number };
    }),

  verifyProductLabel: adminProcedure
    .input(z.object({ labelVersionId: uuid, verificationNote: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('verify_product_label_version', {
        _label_version_id: input.labelVersionId,
        _verification_note: input.verificationNote ?? null,
      });
      if (error) throwFromRpcError(error, 'verify product label');
      return { ok: true as const };
    }),

  patientRuns: patientAccessProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.clinicalDb
      .from('clinical_copilot_runs')
      .select(
        'id, encounter_id, pathway_version_id, status, safety_status, model, provider, prompt_version, output_schema_version, output_sha256, created_at, reviewed_at, review_note',
      )
      .eq('patient_id', ctx.patient.id)
      .order('created_at', { ascending: false });
    if (error) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load copilot history' });
    }
    return data ?? [];
  }),

  recordRun: patientAccessProcedure
    .input(z.object({
      encounterId: uuid.nullable().optional(),
      pathwayVersionId: uuid,
      inputSnapshot: jsonObject,
      outputSnapshot: jsonObject,
      safetyStatus: z.enum(['clear', 'incomplete', 'blocked']),
      model: z.string().max(120).nullable().optional(),
      provider: z.string().max(120).nullable().optional(),
      promptVersion: z.string().max(120).nullable().optional(),
      outputSchemaVersion: z.string().min(1).max(120),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('record_clinical_copilot_run', {
        _patient_id: ctx.patient.id,
        _encounter_id: input.encounterId ?? null,
        _pathway_version_id: input.pathwayVersionId,
        _input_snapshot: input.inputSnapshot,
        _output_snapshot: input.outputSnapshot,
        _safety_status: input.safetyStatus,
        _model: input.model ?? null,
        _provider: input.provider ?? null,
        _prompt_version: input.promptVersion ?? null,
        _output_schema_version: input.outputSchemaVersion,
      });
      if (error) throwFromRpcError(error, 'record clinical copilot run');
      return { runId: data as string };
    }),

  reviewRun: patientAccessProcedure
    .input(z.object({ runId: uuid, reviewNote: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('review_clinical_copilot_run', {
        _run_id: input.runId,
        _review_note: input.reviewNote ?? null,
      });
      if (error) throwFromRpcError(error, 'review clinical copilot run');
      return { ok: true as const };
    }),
});
