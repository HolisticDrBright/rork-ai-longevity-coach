import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter } from '../../create-context';
import { clinicalAuthenticatedProcedure } from '../../clinical-authorization';
import { throwFromRpcError } from './rpc-errors';
import { evaluateEncounter } from '../../../lens/evaluate';
import { lensAiMode, liveLensAiConfigured, resolveLensAi, LensAiConfigError } from '../../../lens/ai';
import type { Paradigm } from '../../../lens/lenses';

/**
 * clinical.lens.* — differential questions + clinical lens engine (M2).
 * Question-focused by design: evaluations produce questions, considerations,
 * missing information, conflicts, and safety observations — never diagnoses,
 * treatment, dosing, or patient-facing recommendations. The database RPCs
 * (migration 0024) are the enforcement of record; everything here runs under
 * the caller's RLS-scoped client.
 */

const uuid = z.string().uuid();
const PARADIGMS = ['western_conventional', 'functional', 'naturopathic', 'tcm', 'biohacking', 'synergistic'] as const;

export const clinicalLensRouter = createTRPCRouter({
  /** AI posture: fixture/live and whether AI assistance is available. */
  aiStatus: clinicalAuthenticatedProcedure.query(() => {
    const mode = lensAiMode();
    let available = false;
    let reason: string | null = null;
    try {
      available = resolveLensAi() !== null;
    } catch (e) {
      reason = e instanceof LensAiConfigError ? e.message : 'unavailable';
    }
    return { mode, available, liveConfigured: liveLensAiConfigured(), reason };
  }),

  paradigms: clinicalAuthenticatedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.clinicalDb
      .from('clinical_paradigms')
      .select('code, name, description, is_composite, composed_of')
      .order('code');
    if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load paradigms' });
    return (data ?? []).map((p) => ({
      code: p.code as string,
      name: p.name as string,
      description: p.description as string,
      isComposite: Boolean(p.is_composite),
      composedOf: (p.composed_of as string[]) ?? [],
    }));
  }),

  domains: clinicalAuthenticatedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.clinicalDb
      .from('clinical_domains')
      .select('code, version, name, description')
      .eq('active', true)
      .order('code');
    if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load domains' });
    return (data ?? []).map((d) => ({
      code: d.code as string,
      version: d.version as number,
      name: d.name as string,
      description: d.description as string,
    }));
  }),

  /** Registry rows — nulls surface as "unknown" in the UI, by requirement. */
  knowledgeSources: clinicalAuthenticatedProcedure
    .input(z.object({ ids: z.array(uuid).max(50).optional() }).optional())
    .query(async ({ ctx, input }) => {
      let query = ctx.clinicalDb
        .from('clinical_knowledge_sources')
        .select(
          'id, code, revision, citation, publisher, release_date, revision_date, intended_purpose, intended_population, required_inputs, data_quality_expectations, logic_summary, known_limitations, out_of_scope_uses, validation_status, funding_conflicts',
        )
        .order('code');
      if (input?.ids && input.ids.length > 0) query = query.in('id', input.ids);
      const { data, error } = await query;
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load the knowledge registry' });
      return (data ?? []).map((s) => ({
        id: s.id as string,
        code: s.code as string,
        revision: s.revision as number,
        citation: s.citation as string,
        publisher: (s.publisher as string | null) ?? null,
        releaseDate: (s.release_date as string | null) ?? null,
        revisionDate: (s.revision_date as string | null) ?? null,
        intendedPurpose: (s.intended_purpose as string | null) ?? null,
        intendedPopulation: (s.intended_population as string | null) ?? null,
        requiredInputs: (s.required_inputs as string | null) ?? null,
        dataQualityExpectations: (s.data_quality_expectations as string | null) ?? null,
        logicSummary: (s.logic_summary as string | null) ?? null,
        knownLimitations: (s.known_limitations as string | null) ?? null,
        outOfScopeUses: (s.out_of_scope_uses as string | null) ?? null,
        validationStatus: s.validation_status as string,
        fundingConflicts: (s.funding_conflicts as string | null) ?? null,
      }));
    }),

  /** Run the deterministic evaluation for one paradigm. */
  evaluate: clinicalAuthenticatedProcedure
    .input(z.object({ encounterId: uuid, paradigm: z.enum(PARADIGMS) }))
    .mutation(async ({ ctx, input }) => {
      const { result, error } = await evaluateEncounter(ctx.clinicalDb, input.encounterId, input.paradigm as Paradigm);
      if (error || !result) throwFromRpcError(error ?? {}, 'run lens evaluation');
      return result;
    }),

  /** Latest evaluation for an encounter + paradigm, with questions + blocks. */
  evaluation: clinicalAuthenticatedProcedure
    .input(z.object({ encounterId: uuid, paradigm: z.enum(PARADIGMS) }))
    .query(async ({ ctx, input }) => {
      const evalRes = await ctx.clinicalDb
        .from('lens_evaluations')
        .select(
          'id, paradigm_code, status, invariant_core, lens_framing, input_snapshot, input_cutoff_at, rule_set_version, knowledge_versions, model, provider, prompt_template_version, output_schema_version, output_sha256, validation_result, stale, stale_reason, created_at',
        )
        .eq('encounter_id', input.encounterId)
        .eq('paradigm_code', input.paradigm)
        .is('superseded_by', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (evalRes.error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load the evaluation' });
      if (!evalRes.data) return null;
      const e = evalRes.data as Record<string, unknown>;
      const [questions, blocks] = await Promise.all([
        ctx.clinicalDb
          .from('differential_questions')
          .select(
            'id, domain_code, question_text, rationale, distinguishes, safety_relation, priority, answer_type, patient_sources, knowledge_source_ids, missing_data_assumptions, generation_method, generation_version, status, status_reason, created_at',
          )
          .eq('evaluation_id', e.id as string)
          .order('priority', { ascending: true })
          .order('created_at', { ascending: true }),
        ctx.clinicalDb
          .from('lens_safety_blocks')
          .select('id, rule_code, detail, created_at, reviewed_by, reviewed_at, resolution')
          .eq('evaluation_id', e.id as string),
      ]);
      return {
        evaluationId: e.id as string,
        paradigm: e.paradigm_code as string,
        status: e.status as 'complete' | 'blocked',
        invariantCore: e.invariant_core as Record<string, unknown>,
        lensFraming: e.lens_framing as Record<string, unknown>,
        inputSnapshot: e.input_snapshot as Record<string, unknown>,
        inputCutoffAt: e.input_cutoff_at as string,
        ruleSetVersion: e.rule_set_version as string,
        knowledgeVersions: e.knowledge_versions as unknown[],
        model: (e.model as string | null) ?? null,
        provider: (e.provider as string | null) ?? null,
        promptTemplateVersion: (e.prompt_template_version as string | null) ?? null,
        outputSchemaVersion: e.output_schema_version as string,
        outputSha256: e.output_sha256 as string,
        validationResult: (e.validation_result as Record<string, unknown> | null) ?? null,
        stale: Boolean(e.stale),
        staleReason: (e.stale_reason as string | null) ?? null,
        createdAt: e.created_at as string,
        questions: (questions.data ?? []).map((qq) => ({
          id: qq.id as string,
          domainCode: qq.domain_code as string,
          questionText: qq.question_text as string,
          rationale: qq.rationale as string,
          distinguishes: (qq.distinguishes as unknown[]) ?? [],
          safetyRelation: (qq.safety_relation as string | null) ?? null,
          priority: qq.priority as string,
          answerType: qq.answer_type as string,
          patientSources: (qq.patient_sources as unknown[]) ?? [],
          knowledgeSourceIds: (qq.knowledge_source_ids as string[]) ?? [],
          missingDataAssumptions: (qq.missing_data_assumptions as unknown[]) ?? [],
          generationMethod: qq.generation_method as string,
          generationVersion: qq.generation_version as string,
          status: qq.status as string,
          statusReason: (qq.status_reason as string | null) ?? null,
          createdAt: qq.created_at as string,
        })),
        safetyBlocks: (blocks.data ?? []).map((b) => ({
          id: b.id as string,
          ruleCode: b.rule_code as string,
          detail: (b.detail as Record<string, unknown>) ?? {},
          createdAt: b.created_at as string,
          reviewedBy: (b.reviewed_by as string | null) ?? null,
          reviewedAt: (b.reviewed_at as string | null) ?? null,
          resolution: (b.resolution as string | null) ?? null,
        })),
      };
    }),

  /** Answers for one question — every version, corrections included. */
  answers: clinicalAuthenticatedProcedure
    .input(z.object({ questionId: uuid }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb
        .from('question_answers')
        .select('version, answer_value, corrects_version, correction_reason, answered_at, answered_by')
        .eq('question_id', input.questionId)
        .order('version', { ascending: true });
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load answers' });
      return (data ?? []).map((a) => ({
        version: a.version as number,
        value: a.answer_value as Record<string, unknown>,
        correctsVersion: (a.corrects_version as number | null) ?? null,
        correctionReason: (a.correction_reason as string | null) ?? null,
        answeredAt: a.answered_at as string,
      }));
    }),

  questionAction: clinicalAuthenticatedProcedure
    .input(z.object({
      questionId: uuid,
      action: z.enum(['accepted', 'asked', 'deferred', 'skipped']),
      reason: z.string().max(300).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('set_question_status', {
        _question_id: input.questionId, _to: input.action, _reason: input.reason ?? null,
      });
      if (error) throwFromRpcError(error, 'update question');
      return { ok: true as const };
    }),

  dismiss: clinicalAuthenticatedProcedure
    .input(z.object({
      questionId: uuid,
      feedbackKind: z.enum(['helpful', 'not_relevant', 'unsafe', 'incorrect', 'duplicate', 'other']),
      comment: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('dismiss_question', {
        _question_id: input.questionId, _feedback_kind: input.feedbackKind, _comment: input.comment ?? null,
      });
      if (error) throwFromRpcError(error, 'dismiss question');
      return { ok: true as const };
    }),

  answer: clinicalAuthenticatedProcedure
    .input(z.object({ questionId: uuid, value: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('answer_question', {
        _question_id: input.questionId, _answer: input.value,
      });
      if (error) throwFromRpcError(error, 'answer question');
      return { version: data as number };
    }),

  correctAnswer: clinicalAuthenticatedProcedure
    .input(z.object({ questionId: uuid, value: z.record(z.string(), z.unknown()), reason: z.string().max(300).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('correct_question_answer', {
        _question_id: input.questionId, _answer: input.value, _reason: input.reason ?? null,
      });
      if (error) throwFromRpcError(error, 'correct answer');
      return { version: data as number };
    }),

  /** Explicit add-to-note (audited). The note edit itself uses clinical.notes.save. */
  recordNoteUse: clinicalAuthenticatedProcedure
    .input(z.object({ questionId: uuid, noteId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('record_question_note_use', {
        _question_id: input.questionId, _note_id: input.noteId,
      });
      if (error) throwFromRpcError(error, 'record note use');
      return { ok: true as const };
    }),

  feedback: clinicalAuthenticatedProcedure
    .input(z.object({
      questionId: uuid,
      kind: z.enum(['helpful', 'not_relevant', 'unsafe', 'incorrect', 'duplicate', 'other']),
      comment: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('submit_question_feedback', {
        _question_id: input.questionId, _kind: input.kind, _comment: input.comment ?? null,
      });
      if (error) throwFromRpcError(error, 'submit feedback');
      return { ok: true as const };
    }),

  reviewSafetyBlock: clinicalAuthenticatedProcedure
    .input(z.object({ blockId: uuid, resolution: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('review_safety_block', {
        _block_id: input.blockId, _resolution: input.resolution,
      });
      if (error) throwFromRpcError(error, 'review safety block');
      return { ok: true as const };
    }),
});
