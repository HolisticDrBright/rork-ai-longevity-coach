import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../../create-context';
import { createServerSupabaseClient } from '../../../supabase-server';
import { runMiner } from '../../../services/patterns/miner';
import { generateHypotheses, type Paradigm } from '../../../services/patterns/hypothesizer';
import { runEffectivenessJob } from '../../../services/interventions/effectivenessJob';
import { backfillInterventionEvents } from '../../../services/interventions/backfill';
import { interpretOutcome } from '../../../services/interventions/interpreter';
import { isFlagEnabled, getUserRoles } from '../../../lib/featureFlags';
import { Sentry } from '../../../../lib/sentry';

const KILL_SWITCH_FLAG = 'pattern_kill_switch';
const PATIENT_SURFACE_FLAG = 'pattern_surface_to_patients';
const CONSENT_VERSION = '2026-04-16-v1';

const PARADIGM_ENUM = z.enum([
  'western', 'functional', 'naturopathic',
  'tcm', 'ayurvedic', 'biohacking', 'synergistic',
]);

async function requirePractitioner(sb: any, userId: string): Promise<string[]> {
  const roles = await getUserRoles(sb, userId);
  if (!roles.includes('practitioner') && !roles.includes('admin')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Practitioner or admin only' });
  }
  return roles;
}

async function requireAdmin(sb: any, userId: string): Promise<string[]> {
  const roles = await getUserRoles(sb, userId);
  if (!roles.includes('admin')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
  }
  return roles;
}

async function requireKillSwitchOff(sb: any, userId: string): Promise<void> {
  const roles = await getUserRoles(sb, userId);
  const killed = await isFlagEnabled(sb, KILL_SWITCH_FLAG, { id: userId, roles });
  if (killed) {
    throw new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Pattern engine paused by admin (kill switch on)',
    });
  }
}

export const patternsRouter = createTRPCRouter({
  // ── Admin: miner ─────────────────────────────────────────────

  runMinerNow: protectedProcedure.mutation(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);
    await requireAdmin(sb, ctx.user.id);
    await requireKillSwitchOff(sb, ctx.user.id);
    Sentry.addBreadcrumb({ category: 'patterns.miner', message: 'manual_trigger', data: { user: ctx.user.id } });
    try {
      const result = await runMiner(sb, { triggeredBy: ctx.user.id });
      return result;
    } catch (err) {
      Sentry.captureException(err, { tags: { subsystem: 'pattern_miner' } });
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: (err as Error).message });
    }
  }),

  getMinerRuns: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      await requirePractitioner(sb, ctx.user.id);
      const { data } = await sb
        .from('pattern_miner_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(input?.limit ?? 20);
      return data ?? [];
    }),

  // ── Practitioner: pattern inbox ──────────────────────────────

  listPatterns: protectedProcedure
    .input(z.object({
      status: z.array(z.string()).optional(),
      kind: z.string().optional(),
      minNovelty: z.number().min(0).max(1).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      await requirePractitioner(sb, ctx.user.id);
      let query = sb.from('discovered_patterns').select('*');
      if (input?.status?.length) query = query.in('status', input.status);
      else query = query.in('status', ['candidate', 'under_review']);
      if (input?.kind) query = query.eq('kind', input.kind);
      if (input?.minNovelty != null) query = query.gte('novelty_score', input.minNovelty);
      query = query.order('q_value', { ascending: true }).limit(input?.limit ?? 50);
      const { data, error } = await query;
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      return data ?? [];
    }),

  getPattern: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      await requirePractitioner(sb, ctx.user.id);

      const [
        patternRes,
        hypothesesRes,
        observationsRes,
        reviewsRes,
      ] = await Promise.all([
        sb.from('discovered_patterns').select('*').eq('id', input.id).maybeSingle(),
        sb.from('pattern_hypotheses').select('*').eq('pattern_id', input.id).order('generated_at'),
        sb.from('pattern_observations').select('*').eq('pattern_id', input.id).limit(200),
        sb.from('pattern_reviews').select('*').eq('pattern_id', input.id).order('created_at', { ascending: false }),
      ]);

      if (patternRes.error || !patternRes.data) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Pattern not found' });
      }
      return {
        pattern: patternRes.data,
        hypotheses: hypothesesRes.data ?? [],
        observations: observationsRes.data ?? [],
        reviews: reviewsRes.data ?? [],
      };
    }),

  // ── Practitioner: hypothesis generation ──────────────────────

  requestParadigmHypothesis: protectedProcedure
    .input(z.object({
      patternId: z.string().uuid(),
      paradigms: z.array(PARADIGM_ENUM).min(1),
      forceRegenerate: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      await requirePractitioner(sb, ctx.user.id);
      await requireKillSwitchOff(sb, ctx.user.id);

      const { data: pattern } = await sb
        .from('discovered_patterns')
        .select('*')
        .eq('id', input.patternId)
        .maybeSingle();
      if (!pattern) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pattern not found' });

      // If not forcing, skip paradigms that already exist
      let requested = input.paradigms;
      if (!input.forceRegenerate) {
        const { data: existing } = await sb
          .from('pattern_hypotheses')
          .select('paradigm')
          .eq('pattern_id', input.patternId);
        const have = new Set((existing ?? []).map((r: any) => r.paradigm));
        requested = requested.filter(p => !have.has(p) || p === 'synergistic');
      }

      if (requested.length === 0) {
        return { generated: [], failed: [], skipped: input.paradigms };
      }

      try {
        const result = await generateHypotheses(sb, {
          patternId: input.patternId,
          kind: pattern.kind,
          leftEntity: pattern.left_entity,
          rightEntity: pattern.right_entity,
          method: pattern.method,
          timeLagDays: pattern.time_lag_days,
          effectSize: pattern.effect_size,
          pValue: pattern.p_value,
          qValue: pattern.q_value,
          nPatients: pattern.n_patients,
          requestedParadigms: requested as Paradigm[],
        });

        // Move pattern into under_review on first hypothesis generation
        if (pattern.status === 'candidate') {
          await sb.from('discovered_patterns').update({ status: 'under_review' }).eq('id', input.patternId);
        }

        Sentry.addBreadcrumb({
          category: 'patterns.hypothesize',
          message: 'generated',
          data: { paradigms: result.generated, failed: result.failed },
        });

        return { ...result, skipped: [] };
      } catch (err) {
        Sentry.captureException(err, {
          tags: { subsystem: 'pattern_hypothesizer' },
          extra: { patternId: input.patternId, paradigms: requested },
        });
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: (err as Error).message });
      }
    }),

  // ── Practitioner: lifecycle transitions ──────────────────────

  reviewPattern: protectedProcedure
    .input(z.object({
      patternId: z.string().uuid(),
      action: z.enum([
        'promote_research', 'promote_clinical', 'reject', 'retire', 'comment', 'request_regenerate',
      ]),
      notes: z.string().optional(),
      paradigmScores: z.record(z.string(), z.number().int().min(1).max(5)).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      await requirePractitioner(sb, ctx.user.id);

      const { data: pattern } = await sb
        .from('discovered_patterns')
        .select('status')
        .eq('id', input.patternId)
        .maybeSingle();
      if (!pattern) throw new TRPCError({ code: 'NOT_FOUND', message: 'Pattern not found' });

      const validTransitions: Record<string, string[]> = {
        candidate: ['promote_research', 'reject', 'comment', 'request_regenerate'],
        under_review: ['promote_research', 'reject', 'comment', 'request_regenerate'],
        research_signal: ['promote_clinical', 'retire', 'comment'],
        clinical_signal: ['retire', 'comment'],
        rejected: ['comment'],
        retired: ['comment'],
      };
      if (!validTransitions[pattern.status]?.includes(input.action)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid transition: cannot ${input.action} from ${pattern.status}`,
        });
      }

      let toStatus: string | null = null;
      switch (input.action) {
        case 'promote_research': toStatus = 'research_signal'; break;
        case 'promote_clinical': toStatus = 'clinical_signal'; break;
        case 'reject': toStatus = 'rejected'; break;
        case 'retire': toStatus = 'retired'; break;
        default: toStatus = null;
      }

      if (toStatus) {
        // If hypothesizer flagged safety concerns, block auto-promotion to clinical_signal
        if (input.action === 'promote_clinical') {
          const { data: hypotheses } = await sb
            .from('pattern_hypotheses')
            .select('safety_concerns, safety_override')
            .eq('pattern_id', input.patternId);
          const hasSafetyFlags = (hypotheses ?? []).some((h: any) =>
            (h.safety_concerns?.length ?? 0) > 0 || h.safety_override
          );
          const { data: priorReviews } = await sb
            .from('pattern_reviews')
            .select('reviewer_id')
            .eq('pattern_id', input.patternId)
            .eq('action', 'promote_research');
          if (hasSafetyFlags && (priorReviews ?? []).length < 1) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'Safety concerns flagged — requires a second practitioner review before clinical promotion',
            });
          }
        }

        await sb
          .from('discovered_patterns')
          .update({ status: toStatus })
          .eq('id', input.patternId);
      }

      const { data: review } = await sb
        .from('pattern_reviews')
        .insert({
          pattern_id: input.patternId,
          reviewer_id: ctx.user.id,
          action: input.action,
          from_status: pattern.status,
          to_status: toStatus,
          notes: input.notes,
          paradigm_scores: input.paradigmScores ?? null,
        })
        .select()
        .maybeSingle();

      Sentry.addBreadcrumb({
        category: 'patterns.review',
        message: input.action,
        data: { patternId: input.patternId, from: pattern.status, to: toStatus },
      });

      return { review, newStatus: toStatus ?? pattern.status };
    }),

  setPatternVisibleStats: protectedProcedure
    .input(z.object({
      patternId: z.string().uuid(),
      patientVisibleStatistics: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      await requirePractitioner(sb, ctx.user.id);
      const { data, error } = await sb
        .from('discovered_patterns')
        .update({ patient_visible_statistics: input.patientVisibleStatistics })
        .eq('id', input.patternId)
        .select()
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      return data;
    }),

  // ── Paradigm preferences ─────────────────────────────────────

  getPractitionerParadigmPrefs: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);
    await requirePractitioner(sb, ctx.user.id);
    const { data } = await sb
      .from('practitioner_paradigm_prefs')
      .select('*')
      .eq('practitioner_id', ctx.user.id)
      .maybeSingle();
    if (data) return data;
    // Create default row on first access
    const { data: created } = await sb
      .from('practitioner_paradigm_prefs')
      .insert({
        practitioner_id: ctx.user.id,
        default_paradigms: ['western', 'functional', 'synergistic'],
      })
      .select()
      .maybeSingle();
    return created;
  }),

  updatePractitionerParadigmPrefs: protectedProcedure
    .input(z.object({
      defaultParadigms: z.array(PARADIGM_ENUM).optional(),
      alwaysIncludeSynergistic: z.boolean().optional(),
      patientOverrides: z.record(z.string(), z.array(PARADIGM_ENUM)).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      await requirePractitioner(sb, ctx.user.id);
      const updates: Record<string, unknown> = {};
      if (input.defaultParadigms !== undefined) updates.default_paradigms = input.defaultParadigms;
      if (input.alwaysIncludeSynergistic !== undefined) updates.always_include_synergistic = input.alwaysIncludeSynergistic;
      if (input.patientOverrides !== undefined) updates.patient_overrides = input.patientOverrides;
      updates.practitioner_id = ctx.user.id;

      const { data, error } = await sb
        .from('practitioner_paradigm_prefs')
        .upsert(updates as any, { onConflict: 'practitioner_id' })
        .select()
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      return data;
    }),

  // ── Stats ────────────────────────────────────────────────────

  getStats: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);
    await requirePractitioner(sb, ctx.user.id);

    const [
      patternsRes,
      hypothesesRes,
      reviewsRes,
      runsRes,
    ] = await Promise.all([
      sb.from('discovered_patterns').select('status, created_at, updated_at'),
      sb.from('pattern_hypotheses').select('paradigm, input_tokens, output_tokens, latency_ms, generated_at'),
      sb.from('pattern_reviews').select('paradigm_scores, action, created_at'),
      sb.from('pattern_miner_runs').select('*').order('started_at', { ascending: false }).limit(20),
    ]);

    const byStatus: Record<string, number> = {};
    for (const p of patternsRes.data ?? []) {
      byStatus[(p as any).status] = (byStatus[(p as any).status] ?? 0) + 1;
    }

    const byParadigm: Record<string, { count: number; totalInput: number; totalOutput: number; totalLatency: number }> = {};
    for (const h of hypothesesRes.data ?? []) {
      const p = (h as any).paradigm;
      if (!byParadigm[p]) byParadigm[p] = { count: 0, totalInput: 0, totalOutput: 0, totalLatency: 0 };
      byParadigm[p].count++;
      byParadigm[p].totalInput += Number((h as any).input_tokens ?? 0);
      byParadigm[p].totalOutput += Number((h as any).output_tokens ?? 0);
      byParadigm[p].totalLatency += Number((h as any).latency_ms ?? 0);
    }

    const paradigmScores: Record<string, number[]> = {};
    for (const r of reviewsRes.data ?? []) {
      const scores = (r as any).paradigm_scores;
      if (!scores) continue;
      for (const [p, s] of Object.entries(scores)) {
        if (typeof s !== 'number') continue;
        if (!paradigmScores[p]) paradigmScores[p] = [];
        paradigmScores[p].push(s);
      }
    }

    const paradigmScoreStats = Object.fromEntries(
      Object.entries(paradigmScores).map(([p, arr]) => [
        p,
        { n: arr.length, mean: arr.reduce((a, b) => a + b, 0) / arr.length },
      ])
    );

    return {
      byStatus,
      byParadigm: Object.entries(byParadigm).map(([paradigm, s]) => ({
        paradigm,
        count: s.count,
        meanInputTokens: s.count > 0 ? Math.round(s.totalInput / s.count) : 0,
        meanOutputTokens: s.count > 0 ? Math.round(s.totalOutput / s.count) : 0,
        meanLatencyMs: s.count > 0 ? Math.round(s.totalLatency / s.count) : 0,
      })),
      paradigmScoreStats,
      recentRuns: runsRes.data ?? [],
    };
  }),

  // ── Patient-facing endpoints ─────────────────────────────────

  getClaudeFlagState: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);
    const roles = await getUserRoles(sb, ctx.user.id);
    const surfaceEnabled = await isFlagEnabled(sb, PATIENT_SURFACE_FLAG, { id: ctx.user.id, roles });
    const { data: profile } = await sb
      .from('profiles')
      .select('research_cohort_opt_in, surface_experimental_insights')
      .eq('id', ctx.user.id)
      .maybeSingle();
    return {
      surfaceFlagEnabled: surfaceEnabled,
      researchOptedIn: !!profile?.research_cohort_opt_in,
      surfaceOptedIn: !!profile?.surface_experimental_insights,
      consentVersion: CONSENT_VERSION,
    };
  }),

  optInToResearchCohort: protectedProcedure
    .input(z.object({ optIn: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('profiles')
        .update({
          research_cohort_opt_in: input.optIn,
          research_cohort_opted_in_at: input.optIn ? new Date().toISOString() : null,
        })
        .eq('id', ctx.user.id)
        .select()
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      return data;
    }),

  setSurfaceExperimentalInsights: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('profiles')
        .update({ surface_experimental_insights: input.enabled })
        .eq('id', ctx.user.id)
        .select()
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      return data;
    }),

  listMyExperimentalPatterns: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);
    const roles = await getUserRoles(sb, ctx.user.id);
    const surfaceEnabled = await isFlagEnabled(sb, PATIENT_SURFACE_FLAG, { id: ctx.user.id, roles });
    if (!surfaceEnabled) return [];

    const { data: profile } = await sb
      .from('profiles')
      .select('surface_experimental_insights')
      .eq('id', ctx.user.id)
      .maybeSingle();
    if (!profile?.surface_experimental_insights) return [];

    // Patient RLS returns only research_signal+ patterns they've been exposed to.
    const { data } = await sb
      .from('discovered_patterns')
      .select('*, pattern_hypotheses(*), patient_pattern_exposures(*)')
      .in('status', ['research_signal', 'clinical_signal']);
    return data ?? [];
  }),

  acknowledgeExperimental: protectedProcedure
    .input(z.object({ patternId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('patient_pattern_exposures')
        .upsert({
          patient_id: ctx.user.id,
          pattern_id: input.patternId,
          consent_version: CONSENT_VERSION,
          acknowledged_experimental: true,
          acknowledged_at: new Date().toISOString(),
        }, { onConflict: 'patient_id,pattern_id' })
        .select()
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      return data;
    }),

  setHiddenParadigms: protectedProcedure
    .input(z.object({
      patternId: z.string().uuid(),
      hiddenParadigms: z.array(PARADIGM_ENUM),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('patient_pattern_exposures')
        .upsert({
          patient_id: ctx.user.id,
          pattern_id: input.patternId,
          consent_version: CONSENT_VERSION,
          hidden_paradigms: input.hiddenParadigms,
        }, { onConflict: 'patient_id,pattern_id' })
        .select()
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      return data;
    }),

  // ── Intervention events (client-side on adding/removing interventions) ──

  recordInterventionEvent: protectedProcedure
    .input(z.object({
      interventionType: z.enum(['supplement', 'peptide', 'protocol', 'lifestyle_task', 'diet_change']),
      interventionId: z.string().uuid(),
      interventionLabel: z.string(),
      event: z.enum(['start', 'stop', 'dose_change', 'pause', 'resume']),
      doseSnapshot: z.record(z.string(), z.unknown()).optional(),
      startedAt: z.string(),
      endedAt: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      // Snapshot concurrent interventions for confounder analysis
      const { data: concurrent } = await sb
        .from('intervention_events')
        .select('id, intervention_type, intervention_label, intervention_id')
        .eq('patient_id', ctx.user.id)
        .eq('event', 'start')
        .is('ended_at', null);

      const { data, error } = await sb
        .from('intervention_events')
        .insert({
          patient_id: ctx.user.id,
          intervention_type: input.interventionType,
          intervention_id: input.interventionId,
          intervention_label: input.interventionLabel,
          event: input.event,
          dose_snapshot: input.doseSnapshot,
          started_at: input.startedAt,
          ended_at: input.endedAt,
          concurrent_interventions: concurrent ?? [],
          notes: input.notes,
          source: 'user',
        })
        .select()
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      return data;
    }),

  // ── Effectiveness admin endpoints ────────────────────────────

  runEffectivenessNow: protectedProcedure.mutation(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);
    await requireAdmin(sb, ctx.user.id);
    Sentry.addBreadcrumb({ category: 'interventions.effectiveness', message: 'manual_trigger' });
    try {
      return await runEffectivenessJob(sb);
    } catch (err) {
      Sentry.captureException(err, { tags: { subsystem: 'effectiveness_job' } });
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: (err as Error).message });
    }
  }),

  backfillInterventions: protectedProcedure.mutation(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);
    await requireAdmin(sb, ctx.user.id);
    try {
      return await backfillInterventionEvents(sb);
    } catch (err) {
      Sentry.captureException(err, { tags: { subsystem: 'intervention_backfill' } });
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: (err as Error).message });
    }
  }),

  interpretEffectiveness: protectedProcedure
    .input(z.object({
      sourceType: z.enum(['patient_outcome', 'cohort_effectiveness']),
      sourceId: z.string().uuid(),
      paradigms: z.array(PARADIGM_ENUM).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      await requirePractitioner(sb, ctx.user.id);
      await requireKillSwitchOff(sb, ctx.user.id);

      // Resolve source row
      let table: string;
      if (input.sourceType === 'patient_outcome') table = 'intervention_outcomes';
      else table = 'intervention_effectiveness';

      const { data: source } = await sb.from(table).select('*').eq('id', input.sourceId).maybeSingle();
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Source row not found' });

      let interventionLabel = 'Unknown';
      let cohortContext: Record<string, unknown> | undefined;

      if (input.sourceType === 'patient_outcome') {
        const { data: evt } = await sb
          .from('intervention_events')
          .select('intervention_label')
          .eq('id', (source as any).intervention_event_id)
          .maybeSingle();
        interventionLabel = evt?.intervention_label ?? 'Unknown';
      } else {
        interventionLabel = (source as any).intervention_id;
        cohortContext = {
          n_patients: (source as any).n_patients,
          mean_effect_size: (source as any).mean_effect_size,
          response_rate: (source as any).response_rate,
          adverse_rate: (source as any).adverse_rate,
        };
      }

      const result = await interpretOutcome(sb, {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        interventionLabel,
        outcomeLabel: (source as any).outcome_id,
        baselineValue: (source as any).baseline_value ?? null,
        responseValue: (source as any).response_value ?? null,
        delta: (source as any).delta ?? null,
        deltaPct: (source as any).delta_pct ?? null,
        direction: (source as any).direction ?? 'inconclusive',
        effectSize: (source as any).effect_size ?? (source as any).mean_effect_size ?? null,
        confidence: (source as any).confidence ?? 'medium',
        confoundFlags: (source as any).confound_flags ?? [],
        paradigms: input.paradigms as Paradigm[],
        cohortContext,
      });
      return result;
    }),

  // ── Effectiveness queries ────────────────────────────────────

  listEffectiveness: protectedProcedure
    .input(z.object({
      outcomeType: z.string().optional(),
      outcomeId: z.string().optional(),
      minResponseRate: z.number().min(0).max(1).optional(),
      minN: z.number().int().min(1).default(10),
      limit: z.number().int().min(1).max(200).default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      let query = sb.from('intervention_effectiveness').select('*').gte('n_patients', input?.minN ?? 10);
      if (input?.outcomeType) query = query.eq('outcome_type', input.outcomeType);
      if (input?.outcomeId) query = query.eq('outcome_id', input.outcomeId);
      if (input?.minResponseRate != null) query = query.gte('response_rate', input.minResponseRate);
      query = query.order('response_rate', { ascending: false }).limit(input?.limit ?? 50);
      const { data, error } = await query;
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      return data ?? [];
    }),

  getMyInterventionOutcomes: protectedProcedure
    .input(z.object({ minConfidence: z.enum(['high', 'medium', 'low']).default('medium') }).optional())
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data: profile } = await sb
        .from('profiles')
        .select('surface_experimental_insights')
        .eq('id', ctx.user.id)
        .maybeSingle();
      if (!profile?.surface_experimental_insights) return [];

      const allowed = input?.minConfidence === 'high' ? ['high']
        : input?.minConfidence === 'low' ? ['high', 'medium', 'low']
        : ['high', 'medium'];

      const { data } = await sb
        .from('intervention_outcomes')
        .select('*, intervention_events!inner(patient_id, intervention_label, intervention_type, started_at)')
        .eq('intervention_events.patient_id', ctx.user.id)
        .in('confidence', allowed);
      return data ?? [];
    }),

  getEffectivenessForIntervention: protectedProcedure
    .input(z.object({ interventionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('intervention_effectiveness')
        .select('*')
        .eq('intervention_id', input.interventionId)
        .order('response_rate', { ascending: false });
      return data ?? [];
    }),
});
