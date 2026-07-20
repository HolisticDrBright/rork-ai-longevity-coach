import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter } from '../../create-context';
import {
  clinicalAuthenticatedProcedure,
  patientAccessProcedure,
  practitionerProcedure,
} from '../../clinical-authorization';
import { throwFromRpcError } from './rpc-errors';
import {
  computeRegistryHash,
  LAB_RULES,
  listApprovedProducts,
  listDraftableProducts,
  getProtocolTemplate,
  partitionKnownProductIds,
  QUESTIONNAIRE,
  recommendLabs,
  REGISTRY,
  REGISTRY_CONTENT_SHA256,
  scoreSubmission,
  SCREENING_DISCLAIMER,
  type SubmittedAnswer,
} from '../../../../registry';

/**
 * clinical.assessments / clinical.recommendations / clinical.registry
 *
 * Governed onboarding + assessment procedures shared by AI Longevity Pro
 * (mobile) and the desktop platform. Content and scoring come from the
 * versioned registry (expo/registry); persistence and authorization are the
 * SECURITY DEFINER RPCs of migration 0027 in the clinical database — tenant
 * isolation, patient authorization, idempotency, immutability, and the
 * protocol approval gate are all enforced there, not just here.
 *
 * Nothing in this namespace diagnoses, orders, prescribes, or sends —
 * results are symptom-pattern screening scores plus DRAFT candidates that
 * an authorized practitioner must review.
 */

const answerValue = z.union([
  z.number().int().min(0).max(4),
  z.enum(['not_applicable', 'unsure', 'prefer_not_to_answer']),
]);
const answersSchema = z.array(z.object({ questionId: z.string().min(1), value: answerValue })).max(400);

function assertRegistryIntegrity() {
  const hash = computeRegistryHash();
  if (hash !== REGISTRY_CONTENT_SHA256) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Clinical content registry hash mismatch — refusing to serve or score assessments',
    });
  }
}

export const clinicalAssessmentsRouter = createTRPCRouter({
  /**
   * The versioned assessment definition (content + scales + interpretation
   * bands + module structure). Hash-checked against the pinned constant and
   * cross-checked against assessment_definitions so a drifted deploy fails
   * closed instead of scoring against unknown content.
   */
  getDefinition: clinicalAuthenticatedProcedure
    .input(z.object({ slug: z.literal('symptom-pattern-screening').default('symptom-pattern-screening') }))
    .query(async ({ ctx }) => {
      assertRegistryIntegrity();
      const { data, error } = await ctx.clinicalDb
        .from('assessment_definitions')
        .select('id, slug, version, scoring_version, rule_version, registry_version, content_hash, status')
        .eq('slug', 'symptom-pattern-screening')
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load assessment definition' });
      if (!data) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active assessment definition' });
      if (data.content_hash !== REGISTRY_CONTENT_SHA256) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Deployed registry content does not match the database-pinned definition',
        });
      }
      return {
        definitionId: data.id as string,
        questionnaire: QUESTIONNAIRE,
        intakeModules: REGISTRY.intakeModules,
        consents: REGISTRY.consents,
        clinicalLanguage: REGISTRY.clinicalLanguage,
        versions: {
          questionnaireVersion: data.version as string,
          scoringVersion: data.scoring_version as string,
          ruleVersion: data.rule_version as string,
          registryVersion: data.registry_version as string,
          contentHash: data.content_hash as string,
        },
      };
    }),

  /** Assign the full assessment or selected modules to a patient. */
  assign: practitionerProcedure
    .input(
      z.object({
        patientId: z.string().uuid(),
        moduleIds: z.array(z.string()).min(1).nullable().default(null),
        dueAt: z.string().datetime().nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const knownModules = new Set(REGISTRY.intakeModules.map((m) => m.id));
      for (const id of input.moduleIds ?? []) {
        if (!knownModules.has(id)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown intake module: ${id}` });
        }
      }
      const { data, error } = await ctx.clinicalDb.rpc('assign_assessment', {
        _organization_id: ctx.membership.organizationId,
        _patient_id: input.patientId,
        _slug: 'symptom-pattern-screening',
        _version: QUESTIONNAIRE.version,
        _module_ids: input.moduleIds,
        _due_at: input.dueAt,
      });
      if (error) throwFromRpcError(error, 'assign assessment');
      return data as { id: string; definitionId: string; status: string };
    }),

  /** Autosave the working copy (patient self-service or assisted). */
  autosave: patientAccessProcedure
    .input(
      z.object({
        assignmentId: z.string().uuid(),
        answers: answersSchema,
        intake: z.record(z.string(), z.unknown()).default({}),
        progress: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('autosave_assessment', {
        _assignment_id: input.assignmentId,
        _answers: input.answers,
        _intake: input.intake,
        _progress: input.progress,
      });
      if (error) throwFromRpcError(error, 'autosave assessment');
      return data as { assignmentId: string; savedAt: string };
    }),

  /**
   * Immutable, idempotent submission. Scores are computed HERE from the
   * hash-verified registry (never trusted from the client), then pinned into
   * the submission row; the RPC re-verifies the version pins and enqueues
   * practitioner review. Lab candidates are recorded as DRAFTS in the same
   * step. Replays (same idempotency key or assignment) return the original.
   */
  submit: patientAccessProcedure
    .input(
      z.object({
        assignmentId: z.string().uuid(),
        idempotencyKey: z.string().min(8).max(120),
        answers: answersSchema,
        intake: z.record(z.string(), z.unknown()).default({}),
        attestation: z.object({
          attestedBy: z.string().min(1),
          attestedAt: z.string().datetime(),
          statement: z.string().min(1),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertRegistryIntegrity();
      const evaluation = scoreSubmission(input.answers as SubmittedAnswer[]);
      if (evaluation.unknownQuestionIds.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unknown question ids for ${QUESTIONNAIRE.version}: ${evaluation.unknownQuestionIds.slice(0, 5).join(', ')}`,
        });
      }
      const labs = recommendLabs(evaluation);

      const { data, error } = await ctx.clinicalDb.rpc('submit_assessment', {
        _assignment_id: input.assignmentId,
        _idempotency_key: input.idempotencyKey,
        _answers: input.answers,
        _intake: input.intake,
        _attestation: input.attestation,
        _questionnaire_version: evaluation.questionnaireVersion,
        _scoring_version: evaluation.scoringVersion,
        _rule_version: LAB_RULES.version,
        _registry_version: evaluation.registryVersion,
        _content_hash: REGISTRY_CONTENT_SHA256,
        _evaluation: evaluation,
        _elevated: evaluation.elevatedCategoryIds,
        _moderate_or_higher: evaluation.moderateOrHigherCategoryIds,
      });
      if (error) throwFromRpcError(error, 'submit assessment');
      const submission = data as { id: string; replayed: boolean; reviewStatus: string };

      if (!submission.replayed) {
        const { error: recError } = await ctx.clinicalDb.rpc('record_lab_recommendations', {
          _submission_id: submission.id,
          _rule_version: labs.ruleVersion,
          _items: labs.recommendations,
        });
        if (recError) throwFromRpcError(recError, 'record lab recommendations');
      }

      return {
        submissionId: submission.id,
        replayed: submission.replayed,
        reviewStatus: submission.reviewStatus,
        patientMessage:
          'Submitted for practitioner review. Your screening responses never produce a diagnosis or order on their own.',
        disclaimer: SCREENING_DISCLAIMER,
      };
    }),

  /** Full result for one submission (screening scores + draft candidates). */
  getResult: clinicalAuthenticatedProcedure
    .input(z.object({ submissionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb
        .from('assessment_submissions')
        .select(
          'id, assignment_id, organization_id, patient_id, submitted_at, questionnaire_version, scoring_version, rule_version, registry_version, content_hash, evaluation, elevated_category_ids, moderate_or_higher_category_ids, review_status, reviewed_by, reviewed_at, intake, attestation',
        )
        .eq('id', input.submissionId)
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load submission' });
      if (!data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Submission not found or access denied' });

      const { data: recs } = await ctx.clinicalDb
        .from('lab_recommendations')
        .select('id, lab_id, panel_name, vendor, priority, source_category_ids, why, highest_band, status, decision_note, decided_at')
        .eq('patient_id', data.patient_id as string)
        .order('created_at', { ascending: true });

      return { submission: data, labRecommendations: recs ?? [] };
    }),

  /** All assignments + submissions for one patient (chart/timeline feed). */
  listForPatient: patientAccessProcedure.query(async ({ ctx }) => {
    const [assignments, submissions] = await Promise.all([
      ctx.clinicalDb
        .from('assessment_assignments')
        .select('id, definition_id, status, module_ids, due_at, created_at')
        .eq('patient_id', ctx.patient.id)
        .order('created_at', { ascending: false }),
      ctx.clinicalDb
        .from('assessment_submissions')
        .select('id, assignment_id, submitted_at, review_status, elevated_category_ids, questionnaire_version, scoring_version')
        .eq('patient_id', ctx.patient.id)
        .order('submitted_at', { ascending: false }),
    ]);
    if (assignments.error || submissions.error) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load assessments' });
    }
    return { assignments: assignments.data ?? [], submissions: submissions.data ?? [] };
  }),
});

export const clinicalRecommendationsRouter = createTRPCRouter({
  /** Draft lab candidates for a submission, with rule provenance. */
  getLabs: clinicalAuthenticatedProcedure
    .input(z.object({ submissionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: set, error } = await ctx.clinicalDb
        .from('lab_recommendation_sets')
        .select('id, rule_version, created_at')
        .eq('submission_id', input.submissionId)
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load recommendations' });
      if (!set) return { set: null, recommendations: [] };
      const { data: recs, error: recErr } = await ctx.clinicalDb
        .from('lab_recommendations')
        .select('id, lab_id, panel_name, vendor, priority, source_category_ids, why, highest_band, status, decision_note, decided_by, decided_at')
        .eq('set_id', set.id as string)
        .order('created_at', { ascending: true });
      if (recErr) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load recommendations' });
      return { set, recommendations: recs ?? [] };
    }),

  /** Practitioner marks one lab candidate as an order DRAFT (never an order). */
  createLabOrderDraft: practitionerProcedure
    .input(z.object({ recommendationId: z.string().uuid(), note: z.string().max(2000).nullable().default(null) }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('decide_lab_recommendation', {
        _recommendation_id: input.recommendationId,
        _decision: 'create_order_draft',
        _note: input.note,
      });
      if (error) throwFromRpcError(error, 'create lab order draft');
      return data as { id: string; status: string };
    }),

  /**
   * Create a protocol DRAFT from registry products (IDs validated in the
   * registry module here AND by FK + RPC in the database). Approval is a
   * separate, gated step that fails while products are pending_verification.
   */
  createProtocolDraft: practitionerProcedure
    .input(
      z.object({
        patientId: z.string().uuid(),
        submissionId: z.string().uuid().nullable().default(null),
        templateId: z.string().nullable().default(null),
        name: z.string().min(1).max(200),
        purpose: z.string().min(1).max(2000),
        triggeringSource: z.string().min(1).max(200),
        linkedGoal: z.string().max(400).nullable().default(null),
        scheduleSummary: z.string().max(2000).nullable().default(null),
        recheckPlan: z.string().max(2000).nullable().default(null),
        startCriteria: z.string().max(2000).nullable().default(null),
        stopCriteria: z.string().max(2000).nullable().default(null),
        items: z
          .array(
            z.object({
              productId: z.string().min(1),
              productVersion: z.number().int().min(1).default(1),
              doseText: z.string().min(1).max(400),
              schedule: z.string().min(1).max(200),
              durationDays: z.number().int().min(1).max(730).nullable().default(null),
              monitoring: z.array(z.string().max(400)).default([]),
            }),
          )
          .min(1)
          .max(30),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { unknown } = partitionKnownProductIds(input.items.map((i) => i.productId));
      if (unknown.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Rejected: not in the approved supplement registry: ${unknown.join(', ')}`,
        });
      }
      let templateVersion: number | null = null;
      if (input.templateId) {
        const tpl = getProtocolTemplate(input.templateId);
        if (!tpl) throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown protocol template: ${input.templateId}` });
        templateVersion = tpl.version;
      }
      const { data, error } = await ctx.clinicalDb.rpc('create_protocol_draft', {
        _organization_id: ctx.membership.organizationId,
        _patient_id: input.patientId,
        _submission_id: input.submissionId,
        _template_id: input.templateId,
        _template_version: templateVersion,
        _name: input.name,
        _purpose: input.purpose,
        _triggering_source: input.triggeringSource,
        _items: input.items,
        _linked_goal: input.linkedGoal,
        _schedule_summary: input.scheduleSummary,
        _recheck_plan: input.recheckPlan,
        _start_criteria: input.startCriteria,
        _stop_criteria: input.stopCriteria,
      });
      if (error) throwFromRpcError(error, 'create protocol draft');
      return data as { id: string; items: number; status: string };
    }),

  /** Record a practitioner decision on a lab candidate. */
  recordDecision: practitionerProcedure
    .input(
      z.object({
        recommendationId: z.string().uuid(),
        decision: z.enum(['approve', 'modify', 'dismiss', 'request_data']),
        note: z.string().max(2000).nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('decide_lab_recommendation', {
        _recommendation_id: input.recommendationId,
        _decision: input.decision,
        _note: input.note,
      });
      if (error) throwFromRpcError(error, 'record recommendation decision');
      return data as { id: string; status: string };
    }),
});

export const clinicalRegistryRouter = createTRPCRouter({
  /**
   * Products a protocol may be APPROVED with. With the authoritative owner
   * list unfound, this is EMPTY by design — drafts may reference
   * pending_verification products, approvals cannot.
   */
  listApprovedSupplements: clinicalAuthenticatedProcedure.query(() => {
    assertRegistryIntegrity();
    return {
      registryVersion: REGISTRY.registryVersion,
      supplementsVersion: REGISTRY.supplements.version,
      authoritativeListStatus: REGISTRY.supplements.authoritativeListStatus,
      approved: listApprovedProducts(),
      draftable: listDraftableProducts().map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        formulation: p.formulation,
        doseText: p.doseText,
        approvalState: p.approvalState,
        provenance: p.provenance,
      })),
    };
  }),

  /** A versioned protocol template (registry IDs only). */
  getProtocolTemplate: clinicalAuthenticatedProcedure
    .input(z.object({ templateId: z.string().min(1) }))
    .query(({ input }) => {
      const tpl = getProtocolTemplate(input.templateId);
      if (!tpl) throw new TRPCError({ code: 'NOT_FOUND', message: 'Unknown protocol template' });
      return tpl;
    }),
});
