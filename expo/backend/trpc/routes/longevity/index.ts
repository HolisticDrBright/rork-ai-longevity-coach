import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../../create-context';
import { createServerSupabaseClient } from '../../../supabase-server';
import { IntakeInputSchema, LongevityStatusSchema } from './schemas';
import { generateProtocolFromIntake } from './generator';
import { generateProtocolWithClaude } from '../../../services/longevity/claudeGenerator';
import { buildOutcomeReport } from '../../../services/longevity/outcomeReport';
import { isFlagEnabled, getUserRoles, listFlags, setFlag } from '../../../lib/featureFlags';
import { Sentry } from '../../../../lib/sentry';

const OUTCOME_NARRATIVE_FLAG = 'longevity_claude_narrative';

const LONGEVITY_CLAUDE_FLAG = 'longevity_claude_generation';

export const longevityRouter = createTRPCRouter({
  // ── Intake management ───────────────────────────────────────

  createIntake: protectedProcedure
    .input(IntakeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('longevity_intakes')
        .insert({
          user_id: ctx.user.id,
          biological_age: input.biologicalAge,
          chronological_age: input.chronologicalAge,
          weight_current: input.weightCurrent,
          weight_ideal: input.weightIdeal,
          height: input.height,
          sex: input.sex,
          menstrual_status: input.menstrualStatus,
          body_composition: input.bodyComposition,
          fitness_level: input.fitnessLevel,
          diet_type: input.dietType,
          conditions: input.conditions,
          sensitivities: input.sensitivities,
          oppositions: input.oppositions,
          longevity_goals: input.longevityGoals,
          preferred_brands: input.preferredBrands,
          modalities: input.modalities,
          top_complaints: input.topComplaints,
          lifestyle_factors: input.lifestyleFactors,
          labs: input.labs ?? {},
          notes: input.notes,
        })
        .select()
        .single();

      if (error || !data) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create intake' });
      return data;
    }),

  updateIntake: protectedProcedure
    .input(z.object({
      intakeId: z.string().uuid(),
      data: IntakeInputSchema.partial(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const dbUpdates: Record<string, any> = {};
      const d = input.data;
      if (d.biologicalAge !== undefined) dbUpdates.biological_age = d.biologicalAge;
      if (d.chronologicalAge !== undefined) dbUpdates.chronological_age = d.chronologicalAge;
      if (d.weightCurrent !== undefined) dbUpdates.weight_current = d.weightCurrent;
      if (d.weightIdeal !== undefined) dbUpdates.weight_ideal = d.weightIdeal;
      if (d.height !== undefined) dbUpdates.height = d.height;
      if (d.sex !== undefined) dbUpdates.sex = d.sex;
      if (d.menstrualStatus !== undefined) dbUpdates.menstrual_status = d.menstrualStatus;
      if (d.fitnessLevel !== undefined) dbUpdates.fitness_level = d.fitnessLevel;
      if (d.dietType !== undefined) dbUpdates.diet_type = d.dietType;
      if (d.conditions !== undefined) dbUpdates.conditions = d.conditions;
      if (d.sensitivities !== undefined) dbUpdates.sensitivities = d.sensitivities;
      if (d.oppositions !== undefined) dbUpdates.oppositions = d.oppositions;
      if (d.longevityGoals !== undefined) dbUpdates.longevity_goals = d.longevityGoals;
      if (d.preferredBrands !== undefined) dbUpdates.preferred_brands = d.preferredBrands;
      if (d.modalities !== undefined) dbUpdates.modalities = d.modalities;
      if (d.topComplaints !== undefined) dbUpdates.top_complaints = d.topComplaints;
      if (d.lifestyleFactors !== undefined) dbUpdates.lifestyle_factors = d.lifestyleFactors;
      if (d.labs !== undefined) dbUpdates.labs = d.labs;
      if (d.notes !== undefined) dbUpdates.notes = d.notes;

      const { data, error } = await sb
        .from('longevity_intakes')
        .update(dbUpdates)
        .eq('id', input.intakeId)
        .eq('user_id', ctx.user.id)
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update intake' });
      return data;
    }),

  getLatestIntake: protectedProcedure
    .query(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('longevity_intakes')
        .select('*')
        .eq('user_id', ctx.user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    }),

  getIntake: protectedProcedure
    .input(z.object({ intakeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      // RLS allows practitioners to read any intake; this app-layer check
      // restricts direct patient fetches to the owner. Practitioners read
      // via the practitioner portal routes with explicit assignment checks.
      const { data, error } = await sb
        .from('longevity_intakes')
        .select('*')
        .eq('id', input.intakeId)
        .eq('user_id', ctx.user.id)
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch intake' });
      if (!data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Intake not found' });
      return data;
    }),

  // ── Protocol generation ─────────────────────────────────────

  generateProtocol: protectedProcedure
    .input(z.object({ intakeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      // 1. Fetch intake
      const { data: intakeRow, error: intakeError } = await sb
        .from('longevity_intakes')
        .select('*')
        .eq('id', input.intakeId)
        .single();

      if (intakeError || !intakeRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Intake not found' });
      }

      // 2. Build intake input for generator
      const intakeInput = {
        biologicalAge: intakeRow.biological_age,
        chronologicalAge: intakeRow.chronological_age,
        weightCurrent: intakeRow.weight_current,
        weightIdeal: intakeRow.weight_ideal,
        height: intakeRow.height,
        sex: intakeRow.sex as any,
        menstrualStatus: intakeRow.menstrual_status as any,
        bodyComposition: intakeRow.body_composition,
        fitnessLevel: intakeRow.fitness_level as any,
        dietType: intakeRow.diet_type as any,
        conditions: intakeRow.conditions ?? [],
        sensitivities: intakeRow.sensitivities ?? [],
        oppositions: intakeRow.oppositions ?? [],
        longevityGoals: intakeRow.longevity_goals ?? [],
        preferredBrands: intakeRow.preferred_brands ?? [],
        modalities: intakeRow.modalities ?? [],
        topComplaints: intakeRow.top_complaints ?? [],
        lifestyleFactors: intakeRow.lifestyle_factors ?? [],
        labs: intakeRow.labs ?? {},
        notes: intakeRow.notes,
      };

      // 3. Pick generation path based on feature flag.
      //    Flag ON  → try Claude, fall back to deterministic on failure (silent to the user).
      //    Flag OFF → deterministic path only (default for everyone at launch).
      const userRoles = await getUserRoles(sb, ctx.user.id);
      const claudeEnabled = await isFlagEnabled(sb, LONGEVITY_CLAUDE_FLAG, {
        id: ctx.user.id,
        roles: userRoles,
      });

      let generated;
      let generationMethod: 'deterministic' | 'claude' | 'claude_fallback' = 'deterministic';
      let generationMs: number | null = null;
      let systemPromptVersion: string | null = null;
      let model: string | null = null;

      if (claudeEnabled) {
        const claudeStart = Date.now();
        try {
          Sentry.addBreadcrumb({
            category: 'longevity.claude',
            message: 'generation_start',
            data: { userId: ctx.user.id, intakeId: input.intakeId },
          });
          const claudeResult = await generateProtocolWithClaude(intakeInput);
          generated = claudeResult.protocol;
          generationMethod = 'claude';
          generationMs = claudeResult.generationMs;
          systemPromptVersion = claudeResult.systemPromptVersion;
          model = claudeResult.model;
          Sentry.addBreadcrumb({
            category: 'longevity.claude',
            message: 'generation_success',
            data: {
              durationMs: claudeResult.generationMs,
              attempts: claudeResult.attempts,
              model: claudeResult.model,
            },
          });
        } catch (err) {
          // Silent fallback — the patient still gets a valid protocol from
          // the deterministic engine. Log so we can track quality over time.
          Sentry.captureException(err, {
            tags: { feature: 'longevity_claude_generation', phase: 'generation' },
            extra: {
              userId: ctx.user.id,
              intakeId: input.intakeId,
              elapsedMs: Date.now() - claudeStart,
            },
          });
          console.log('[Longevity] Claude generation failed, falling back to deterministic', err);
          generated = generateProtocolFromIntake(intakeInput);
          generationMethod = 'claude_fallback';
          generationMs = Date.now() - claudeStart;
        }
      } else {
        const detStart = Date.now();
        generated = generateProtocolFromIntake(intakeInput);
        generationMs = Date.now() - detStart;
      }

      // 4. Find the next version number
      const { data: existing } = await sb
        .from('longevity_protocols')
        .select('version')
        .eq('intake_id', input.intakeId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersion = (existing?.version ?? 0) + 1;

      // 5. Determine initial status
      const needsReview = generated.practitionerReviewRequired.length > 0;
      const initialStatus = needsReview ? 'pending_review' : 'draft';

      // 6. Save with generation provenance
      const { data: savedProtocol, error: saveError } = await sb
        .from('longevity_protocols')
        .insert({
          intake_id: input.intakeId,
          user_id: ctx.user.id,
          version: nextVersion,
          months: generated.months,
          summary: generated.summary,
          pulsing_calendar: generated.pulsingCalendar,
          safety_notes: generated.safetyNotes,
          practitioner_review_required: generated.practitionerReviewRequired,
          status: initialStatus,
          generation_method: generationMethod,
          generation_ms: generationMs,
          system_prompt_version: systemPromptVersion,
          model,
        })
        .select()
        .maybeSingle();

      if (saveError || !savedProtocol) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to save protocol' });
      }

      return savedProtocol;
    }),

  // ── Protocol retrieval ──────────────────────────────────────

  getProtocol: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('longevity_protocols')
        .select('*')
        .eq('id', input.protocolId)
        .eq('user_id', ctx.user.id)
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch protocol' });
      if (!data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Protocol not found' });
      return data;
    }),

  getLatestProtocol: protectedProcedure
    .query(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('longevity_protocols')
        .select('*')
        .eq('user_id', ctx.user.id)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    }),

  listProtocols: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('longevity_protocols')
        .select('*')
        .eq('user_id', ctx.user.id)
        .order('generated_at', { ascending: false })
        .limit(input?.limit ?? 10);
      return data ?? [];
    }),

  updateProtocolStatus: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      status: LongevityStatusSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const updates: Record<string, any> = { status: input.status };
      if (input.status === 'active') updates.started_at = new Date().toISOString();
      if (input.status === 'completed' || input.status === 'archived') updates.completed_at = new Date().toISOString();

      const { data, error } = await sb
        .from('longevity_protocols')
        .update(updates)
        .eq('id', input.protocolId)
        .eq('user_id', ctx.user.id)
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update status' });
      return data;
    }),

  // ── Practitioner actions ────────────────────────────────────

  addPractitionerNotes: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid(), notes: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      // Require practitioner/admin role to add notes.
      const { data: roles } = await sb.from('user_roles').select('role').eq('user_id', ctx.user.id);
      const isPractitioner = (roles ?? []).some((r: { role: string }) => r.role === 'practitioner' || r.role === 'admin');
      if (!isPractitioner) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only practitioners can add notes' });
      }

      const { data, error } = await sb
        .from('longevity_protocols')
        .update({ practitioner_notes: input.notes })
        .eq('id', input.protocolId)
        .select()
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add notes' });
      if (!data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Protocol not found or access denied' });
      return data;
    }),

  approveProtocol: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      // Require practitioner/admin role to approve.
      const { data: roles } = await sb.from('user_roles').select('role').eq('user_id', ctx.user.id);
      const isPractitioner = (roles ?? []).some((r: { role: string }) => r.role === 'practitioner' || r.role === 'admin');
      if (!isPractitioner) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only practitioners can approve protocols' });
      }

      const { data, error } = await sb
        .from('longevity_protocols')
        .update({
          practitioner_approved: true,
          approved_at: new Date().toISOString(),
          approved_by: ctx.user.id,
          status: 'approved',
        })
        .eq('id', input.protocolId)
        .select()
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to approve protocol' });
      if (!data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Protocol not found or access denied' });
      return data;
    }),

  // ── Progress tracking ───────────────────────────────────────

  logProgress: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      month: z.number().int().min(1).max(6),
      day: z.number().int().optional(),
      itemKey: z.string(),
      itemCategory: z.enum(['supplement', 'peptide', 'fasting', 'exercise', 'modality', 'lifestyle', 'lab']).optional(),
      taken: z.boolean(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('longevity_protocol_progress')
        .insert({
          protocol_id: input.protocolId,
          user_id: ctx.user.id,
          month: input.month,
          day: input.day,
          item_key: input.itemKey,
          item_category: input.itemCategory,
          taken: input.taken,
          notes: input.notes,
        })
        .select()
        .single();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to log progress' });
      return data;
    }),

  getProgress: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      month: z.number().int().min(1).max(6).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      let query = sb
        .from('longevity_protocol_progress')
        .select('*')
        .eq('protocol_id', input.protocolId)
        .eq('user_id', ctx.user.id)
        .order('logged_at', { ascending: false });

      if (input.month) query = query.eq('month', input.month);

      const { data } = await query;
      return data ?? [];
    }),

  getProgressStats: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('longevity_protocol_progress')
        .select('month, item_category, taken')
        .eq('protocol_id', input.protocolId)
        .eq('user_id', ctx.user.id);

      const rows = data ?? [];
      const total = rows.length;
      const taken = rows.filter((r: any) => r.taken).length;

      const byMonth: Record<number, { total: number; taken: number }> = {};
      for (const row of rows) {
        const m = (row as any).month;
        if (!byMonth[m]) byMonth[m] = { total: 0, taken: 0 };
        byMonth[m].total++;
        if ((row as any).taken) byMonth[m].taken++;
      }

      return {
        total,
        taken,
        adherencePercent: total > 0 ? Math.round((taken / total) * 100) : 0,
        byMonth: Object.entries(byMonth).map(([month, stats]) => ({
          month: Number(month),
          total: stats.total,
          taken: stats.taken,
          percent: stats.total > 0 ? Math.round((stats.taken / stats.total) * 100) : 0,
        })),
      };
    }),

  // ── Feature flag admin (admin only) ─────────────────────────

  listFlags: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);
    const roles = await getUserRoles(sb, ctx.user.id);
    if (!roles.includes('admin')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
    }
    return listFlags(sb);
  }),

  setFlag: protectedProcedure
    .input(z.object({
      key: z.string(),
      enabledUserIds: z.array(z.string().uuid()).optional(),
      enabledRoles: z.array(z.string()).optional(),
      rolloutPct: z.number().int().min(0).max(100).optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const roles = await getUserRoles(sb, ctx.user.id);
      if (!roles.includes('admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
      }
      return setFlag(sb, input.key, {
        enabledUserIds: input.enabledUserIds,
        enabledRoles: input.enabledRoles,
        rolloutPct: input.rolloutPct,
        description: input.description,
        updatedBy: ctx.user.id,
      });
    }),

  // ── Current user's Claude flag state (for UI disclosure) ────

  getClaudeFlagState: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);
    const roles = await getUserRoles(sb, ctx.user.id);
    const enabled = await isFlagEnabled(sb, LONGEVITY_CLAUDE_FLAG, {
      id: ctx.user.id,
      roles,
    });
    return { enabled };
  }),

  // ── A/B evaluation (practitioner/admin only) ────────────────

  listAbEvaluations: protectedProcedure
    .input(z.object({ fixtureId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const roles = await getUserRoles(sb, ctx.user.id);
      if (!roles.includes('practitioner') && !roles.includes('admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Practitioner or admin only' });
      }
      let query = sb.from('longevity_ab_evaluations').select('*').order('generated_at', { ascending: false });
      if (input?.fixtureId) query = query.eq('patient_fixture_id', input.fixtureId);
      const { data, error } = await query;
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch evaluations' });
      return data ?? [];
    }),

  saveAbEvaluationReview: protectedProcedure
    .input(z.object({
      evaluationId: z.string().uuid(),
      score: z.number().int().min(1).max(5),
      winner: z.enum(['deterministic', 'claude', 'tie', 'neither']),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const roles = await getUserRoles(sb, ctx.user.id);
      if (!roles.includes('practitioner') && !roles.includes('admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Practitioner or admin only' });
      }
      const { data, error } = await sb
        .from('longevity_ab_evaluations')
        .update({
          reviewer_id: ctx.user.id,
          reviewer_score: input.score,
          reviewer_winner: input.winner,
          reviewer_notes: input.notes,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', input.evaluationId)
        .select()
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to save review' });
      if (!data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evaluation not found' });
      return data;
    }),

  getGenerationStats: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);
    const roles = await getUserRoles(sb, ctx.user.id);
    if (!roles.includes('practitioner') && !roles.includes('admin')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Practitioner or admin only' });
    }
    const { data } = await sb
      .from('longevity_protocols')
      .select('generation_method, generation_ms, model, created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    const rows = data ?? [];
    const methods: Record<string, { count: number; totalMs: number }> = {
      deterministic: { count: 0, totalMs: 0 },
      claude: { count: 0, totalMs: 0 },
      claude_fallback: { count: 0, totalMs: 0 },
    };
    for (const row of rows) {
      const m = (row as any).generation_method ?? 'deterministic';
      if (!methods[m]) methods[m] = { count: 0, totalMs: 0 };
      methods[m].count++;
      methods[m].totalMs += Number((row as any).generation_ms ?? 0);
    }

    const claudeAttempts = methods.claude.count + methods.claude_fallback.count;
    const claudeSuccessRate = claudeAttempts > 0
      ? Math.round((methods.claude.count / claudeAttempts) * 100)
      : null;

    return {
      sampleSize: rows.length,
      byMethod: Object.entries(methods).map(([method, s]) => ({
        method,
        count: s.count,
        meanMs: s.count > 0 ? Math.round(s.totalMs / s.count) : 0,
      })),
      claudeSuccessRate,
    };
  }),

  // ── Month 6 Outcome Report (practitioner-only writes) ───────

  outcomeReportGenerate: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const roles = await getUserRoles(sb, ctx.user.id);
      if (!roles.includes('practitioner') && !roles.includes('admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Practitioner or admin only' });
      }

      // Opt the narrative into Claude only when the flag says so for this user.
      const useClaude = await isFlagEnabled(sb, OUTCOME_NARRATIVE_FLAG, {
        id: ctx.user.id,
        roles,
      });

      try {
        Sentry.addBreadcrumb({
          category: 'longevity.outcome_report',
          message: 'build_start',
          data: { protocolId: input.protocolId, useClaude },
        });
        const result = await buildOutcomeReport(sb, input.protocolId, { useClaude });

        const { data: saved, error: saveError } = await sb
          .from('longevity_outcome_reports')
          .insert({
            protocol_id: input.protocolId,
            user_id: result.report.userId,
            report: result.report,
            narrative_summary: [
              ...result.report.narrative.topWins.map(w => `✓ ${w}`),
              '',
              ...result.report.narrative.topGaps.map(g => `• ${g}`),
              '',
              result.report.narrative.maintenanceRecommendation,
            ].join('\n'),
            narrative_generation_method: result.narrativeMethod,
            narrative_system_prompt_version: result.narrativeSystemPromptVersion,
            data_completeness_pct: result.report.dataCompletenessPct,
          })
          .select()
          .maybeSingle();

        if (saveError || !saved) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to save outcome report' });
        }
        return saved;
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: 'longevity_outcome_report' },
          extra: { protocolId: input.protocolId },
        });
        throw err instanceof TRPCError
          ? err
          : new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Outcome report build failed' });
      }
    }),

  outcomeReportGet: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('longevity_outcome_reports')
        .select('*')
        .eq('protocol_id', input.protocolId)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    }),

  outcomeReportUpdateNarrative: protectedProcedure
    .input(z.object({
      reportId: z.string().uuid(),
      narrativeSummary: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const roles = await getUserRoles(sb, ctx.user.id);
      if (!roles.includes('practitioner') && !roles.includes('admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Practitioner or admin only' });
      }
      const { data, error } = await sb
        .from('longevity_outcome_reports')
        .update({
          narrative_summary: input.narrativeSummary,
          narrative_generation_method: 'practitioner_override',
        })
        .eq('id', input.reportId)
        .select()
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to save narrative' });
      if (!data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' });
      return data;
    }),

  outcomeReportApprove: protectedProcedure
    .input(z.object({ reportId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const roles = await getUserRoles(sb, ctx.user.id);
      if (!roles.includes('practitioner') && !roles.includes('admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Practitioner or admin only' });
      }
      const { data, error } = await sb
        .from('longevity_outcome_reports')
        .update({
          practitioner_approved: true,
          approved_at: new Date().toISOString(),
          approved_by: ctx.user.id,
        })
        .eq('id', input.reportId)
        .select()
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to approve report' });
      if (!data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' });
      return data;
    }),

  outcomeReportShare: protectedProcedure
    .input(z.object({ reportId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const roles = await getUserRoles(sb, ctx.user.id);
      if (!roles.includes('practitioner') && !roles.includes('admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Practitioner or admin only' });
      }
      const { data, error } = await sb
        .from('longevity_outcome_reports')
        .update({
          shared_with_patient: true,
          shared_at: new Date().toISOString(),
        })
        .eq('id', input.reportId)
        .eq('practitioner_approved', true)
        .select()
        .maybeSingle();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to share report' });
      if (!data) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Report must be approved before sharing' });

      // Queue an in-app notification so the patient sees "Results ready".
      await sb.from('notification_queue').insert({
        user_id: data.user_id,
        date: new Date().toISOString().split('T')[0],
        notification_type: 'longevity_outcome_ready',
        payload_json: { reportId: data.id, protocolId: data.protocol_id },
      });

      return data;
    }),

  // ── Month 6 reassessment reminder ───────────────────────────

  /**
   * Practitioner-invokable check that queues a "upload Month 6 labs"
   * notification when the patient has completed 80% of their progress items.
   * Idempotent: won't duplicate for the same protocol.
   */
  checkReassessmentReminder: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const roles = await getUserRoles(sb, ctx.user.id);
      if (!roles.includes('practitioner') && !roles.includes('admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Practitioner or admin only' });
      }

      const { data: protocol } = await sb
        .from('longevity_protocols')
        .select('id, user_id, status')
        .eq('id', input.protocolId)
        .maybeSingle();
      if (!protocol) throw new TRPCError({ code: 'NOT_FOUND', message: 'Protocol not found' });

      const { data: progressRows } = await sb
        .from('longevity_protocol_progress')
        .select('taken')
        .eq('protocol_id', input.protocolId);

      const total = (progressRows ?? []).length;
      const taken = (progressRows ?? []).filter((r: any) => r.taken).length;
      const pct = total > 0 ? (taken / total) * 100 : 0;

      if (pct < 80) {
        return { queued: false, reason: 'Below 80% adherence threshold', adherencePct: Math.round(pct) };
      }

      // De-dupe: skip if we already queued this reminder.
      const { data: existing } = await sb
        .from('notification_queue')
        .select('id')
        .eq('user_id', protocol.user_id)
        .eq('notification_type', 'longevity_reassessment_due')
        .contains('payload_json', { protocolId: input.protocolId })
        .maybeSingle();
      if (existing) return { queued: false, reason: 'Already queued', adherencePct: Math.round(pct) };

      await sb.from('notification_queue').insert({
        user_id: protocol.user_id,
        date: new Date().toISOString().split('T')[0],
        notification_type: 'longevity_reassessment_due',
        payload_json: { protocolId: input.protocolId, adherencePct: Math.round(pct) },
      });

      return { queued: true, adherencePct: Math.round(pct) };
    }),

  // ── Clinic patient → longevity protocol lookup ───────────────

  getLatestProtocolForClinicPatient: protectedProcedure
    .input(z.object({ clinicPatientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const roles = await getUserRoles(sb, ctx.user.id);
      if (!roles.includes('practitioner') && !roles.includes('admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Practitioner or admin only' });
      }
      // Resolve clinic patient → auth user via email.
      const { data: patient } = await sb
        .from('clinic_patients')
        .select('email')
        .eq('id', input.clinicPatientId)
        .maybeSingle();
      if (!patient?.email) return null;

      const { data: profile } = await sb
        .from('profiles')
        .select('id')
        .eq('email', patient.email)
        .maybeSingle();
      if (!profile?.id) return null;

      const { data: protocol } = await sb
        .from('longevity_protocols')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return protocol;
    }),

  // ── Cohort analytics (anonymized aggregates) ────────────────

  cohortStats: protectedProcedure
    .input(z.object({ days: z.number().int().min(7).max(365).default(90) }).optional())
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const roles = await getUserRoles(sb, ctx.user.id);
      if (!roles.includes('practitioner') && !roles.includes('admin')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Practitioner or admin only' });
      }
      const days = input?.days ?? 90;
      const since = new Date(Date.now() - days * 86400000).toISOString();

      const { data } = await sb
        .from('longevity_outcome_reports')
        .select('report, generated_at, data_completeness_pct')
        .gte('generated_at', since)
        .eq('practitioner_approved', true);

      const rows = data ?? [];
      const n = rows.length;

      const truAgeDeltas: number[] = [];
      const crpDeltas: number[] = [];
      const hrvDeltas: number[] = [];
      const completeness: number[] = [];

      for (const row of rows) {
        const r = (row as any).report;
        const dc = (row as any).data_completeness_pct;
        if (typeof dc === 'number') completeness.push(dc);
        const ta = r?.biologicalAge?.deltaYears;
        if (typeof ta === 'number') truAgeDeltas.push(ta);
        const crpD = r?.inflammation?.crp?.deltaPercent;
        if (typeof crpD === 'number') crpDeltas.push(crpD);
        const hrvD = r?.wearables?.hrv?.deltaPercent;
        if (typeof hrvD === 'number') hrvDeltas.push(hrvD);
      }

      const median = (arr: number[]): number | null => {
        if (arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
      };

      return {
        n,
        windowDays: days,
        medianTruAgeDeltaYears: median(truAgeDeltas),
        medianCrpDeltaPercent: median(crpDeltas),
        medianHrvDeltaPercent: median(hrvDeltas),
        meanDataCompletenessPct: completeness.length > 0
          ? Math.round(completeness.reduce((a, b) => a + b, 0) / completeness.length)
          : null,
      };
    }),
});
