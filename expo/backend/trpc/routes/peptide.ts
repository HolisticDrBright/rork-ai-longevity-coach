import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../create-context";
import { createServerSupabaseClient } from "../../supabase-server";

// ============================================================
// Zod Schemas
// ============================================================

const GoalSchema = z.enum([
  'fat_loss', 'sleep', 'recovery', 'injury_rehab', 'cognition',
  'longevity', 'libido', 'metabolic_health', 'muscle_growth',
  'skin_health', 'immune_support',
]);

const ProtocolStatusSchema = z.enum(['draft', 'active', 'paused', 'completed', 'archived']);
const DoseUnitSchema = z.enum(['mcg', 'mg', 'IU']);
const DoseStatusSchema = z.enum(['taken', 'skipped', 'partial']);
const PhaseTypeSchema = z.enum(['loading', 'active', 'maintenance', 'taper', 'off']);
const TaperTypeSchema = z.enum(['none', 'linear', 'step']);
const LabTypeSchema = z.enum([
  'blood_panel', 'dutch', 'gi_map', 'oat', 'mycotoxin',
  'heavy_metal', 'viral', 'lyme', 'sibo', 'gut_zoomer',
]);

const LabValueSchema = z.object({
  biomarker: z.string(),
  value: z.number(),
});

const ProtocolPeptideInput = z.object({
  peptideId: z.string().uuid(),
  doseAmount: z.number().positive(),
  doseUnit: DoseUnitSchema,
  frequency: z.string(),
  timing: z.string().optional(),
  durationWeeks: z.number().int().positive().optional(),
  aiRationale: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

// ============================================================
// Goal-to-category mapping for protocol generation
// ============================================================

const GOAL_CATEGORY_MAP: Record<string, string[]> = {
  fat_loss: ['weight_management', 'gh_secretagogue', 'mitochondrial'],
  sleep: ['sleep', 'bioregulator', 'gh_secretagogue'],
  recovery: ['healing', 'gh_secretagogue'],
  injury_rehab: ['healing'],
  cognition: ['cognitive', 'bioregulator', 'mitochondrial'],
  longevity: ['longevity', 'mitochondrial', 'bioregulator'],
  libido: ['sexual_health', 'hormone'],
  metabolic_health: ['weight_management', 'mitochondrial'],
  muscle_growth: ['gh_secretagogue', 'healing'],
  skin_health: ['skin', 'healing'],
  immune_support: ['immune', 'antimicrobial', 'bioregulator'],
};

const GOAL_REASONING: Record<string, string> = {
  fat_loss: 'Protocol optimized for fat metabolism, appetite regulation, and body composition improvement.',
  sleep: 'Protocol designed to enhance sleep architecture, promote deep sleep, and optimize nocturnal GH release.',
  recovery: 'Protocol focused on tissue repair, anti-inflammation, and accelerated recovery.',
  injury_rehab: 'Targeted healing protocol for injury recovery with tissue repair peptides.',
  cognition: 'Nootropic protocol for enhanced focus, memory, and neuroprotection.',
  longevity: 'Anti-aging protocol targeting telomere maintenance, mitochondrial function, and cellular repair.',
  libido: 'Protocol targeting central and peripheral sexual function pathways.',
  metabolic_health: 'Metabolic optimization protocol for glucose control and mitochondrial function.',
  muscle_growth: 'Anabolic protocol for lean mass gain via GH optimization and muscle repair.',
  skin_health: 'Skin rejuvenation protocol targeting collagen synthesis and tissue repair.',
  immune_support: 'Immune modulation protocol enhancing both innate and adaptive immunity.',
};

// ============================================================
// Router
// ============================================================

export const peptideRouter = createTRPCRouter({
  // ── Feature 1: Library & Protocol Builder ──────────────────

  getLibrary: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      goal: GoalSchema.optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      let query = sb.from('peptide_library').select('*').eq('active', true);

      if (input?.category) {
        query = query.eq('category', input.category);
      }
      if (input?.goal) {
        query = query.contains('goals', [input.goal]);
      }
      if (input?.search) {
        query = query.or(`name.ilike.%${input.search}%,slug.ilike.%${input.search}%`);
      }

      const { data, error } = await query.order('name');
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch peptide library' });
      return data ?? [];
    }),

  getPeptideBySlug: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb.from('peptide_library').select('*').eq('slug', input.slug).single();
      if (error || !data) throw new TRPCError({ code: 'NOT_FOUND', message: `Peptide '${input.slug}' not found` });
      return data;
    }),

  generateProtocol: protectedProcedure
    .input(z.object({
      goal: GoalSchema,
      labData: z.array(LabValueSchema).optional(),
      wearableData: z.record(z.string(), z.number()).optional(),
      conditions: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      // 1. Get peptides matching goal categories
      const categories = GOAL_CATEGORY_MAP[input.goal] ?? [];
      const { data: allPeptides } = await sb
        .from('peptide_library')
        .select('*')
        .eq('active', true)
        .in('category', categories);

      if (!allPeptides?.length) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No peptides found for this goal' });
      }

      // 2. Score peptides by goal relevance
      const scored = allPeptides
        .filter((p: any) => (p.goals ?? []).includes(input.goal))
        .map((p: any) => ({
          ...p,
          score: (p.goals ?? []).includes(input.goal) ? 10 : 5,
        }))
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 4); // Top 4 peptides

      // 3. Check lab thresholds
      const warnings: { severity: string; message: string }[] = [];
      if (input.labData?.length) {
        const slugs = scored.map((p: any) => p.slug);
        const { data: thresholds } = await sb
          .from('peptide_lab_thresholds')
          .select('*')
          .in('peptide_slug', slugs);

        for (const threshold of thresholds ?? []) {
          const labValue = input.labData.find(l => l.biomarker === threshold.biomarker_name);
          if (labValue) {
            const triggered = threshold.direction === 'above'
              ? labValue.value > threshold.threshold_value
              : labValue.value < threshold.threshold_value;
            if (triggered) {
              warnings.push({
                severity: threshold.severity,
                message: `${threshold.message} (${threshold.biomarker_name}: ${labValue.value})`,
              });
            }
          }
        }
      }

      // 4. Check contraindications
      if (input.conditions?.length) {
        const slugs = scored.map((p: any) => p.slug);
        const { data: contras } = await sb
          .from('peptide_contraindications')
          .select('*')
          .in('peptide_slug', slugs);

        for (const contra of contras ?? []) {
          if (input.conditions.some(c => c.toLowerCase().includes(contra.condition.toLowerCase()))) {
            warnings.push({
              severity: contra.severity,
              message: `${contra.peptide_slug}: ${contra.description}`,
            });
          }
        }
      }

      // 5. Build recommendation
      const peptides = scored.map((p: any) => ({
        slug: p.slug,
        name: p.name,
        doseAmount: p.typical_dose_min + (p.typical_dose_max - p.typical_dose_min) / 2,
        doseUnit: p.dose_unit,
        frequency: p.category === 'gh_secretagogue' ? 'Daily, 5 days on / 2 days off' :
                   p.category === 'healing' ? 'Daily' :
                   p.category === 'weight_management' ? 'Weekly' :
                   p.category === 'bioregulator' ? 'Daily for 10 days, then 20 days off' :
                   'Daily',
        timing: p.category === 'gh_secretagogue' ? 'Pre-bed, empty stomach' :
                p.category === 'sleep' ? 'Pre-bed' :
                p.category === 'cognitive' ? 'Morning' :
                'Morning or evening',
        durationWeeks: p.category === 'bioregulator' ? 4 :
                       p.category === 'healing' ? 8 :
                       12,
        rationale: `${p.name} recommended for ${input.goal.replace(/_/g, ' ')}. ${p.mechanism}`,
      }));

      return {
        goal: input.goal,
        peptides,
        reasoning: GOAL_REASONING[input.goal] ?? 'Custom protocol generated based on your health data.',
        warnings,
        suggestedRetestTimeline: 'Recheck relevant biomarkers in 6-8 weeks after protocol start.',
        labSnapshot: input.labData?.reduce((acc, l) => ({ ...acc, [l.biomarker]: l.value }), {}),
        wearableSnapshot: input.wearableData,
      };
    }),

  saveProtocol: protectedProcedure
    .input(z.object({
      name: z.string(),
      goal: z.string(),
      aiReasoning: z.string().optional(),
      suggestedRetestTimeline: z.string().optional(),
      labSnapshotId: z.string().uuid().optional(),
      wearableSnapshot: z.record(z.string(), z.number()).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      peptides: z.array(ProtocolPeptideInput),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: protocol, error: protocolError } = await sb
        .from('peptide_protocols')
        .insert({
          user_id: ctx.user.id,
          name: input.name,
          goal: input.goal,
          status: 'active',
          ai_reasoning: input.aiReasoning,
          suggested_retest_timeline: input.suggestedRetestTimeline,
          lab_snapshot_id: input.labSnapshotId,
          wearable_snapshot: input.wearableSnapshot,
          start_date: input.startDate ?? new Date().toISOString().split('T')[0],
          end_date: input.endDate,
        })
        .select()
        .single();

      if (protocolError || !protocol) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create protocol' });
      }

      if (input.peptides.length > 0) {
        const peptideRows = input.peptides.map((p, i) => ({
          protocol_id: protocol.id,
          peptide_id: p.peptideId,
          dose_amount: p.doseAmount,
          dose_unit: p.doseUnit,
          frequency: p.frequency,
          timing: p.timing,
          duration_weeks: p.durationWeeks,
          ai_rationale: p.aiRationale,
          sort_order: p.sortOrder ?? i,
        }));

        const { error: pepError } = await sb.from('protocol_peptides').insert(peptideRows);
        if (pepError) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add peptides to protocol' });
        }
      }

      return protocol;
    }),

  getActiveProtocol: protectedProcedure
    .query(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('peptide_protocols')
        .select('*, protocol_peptides(*, peptide_library(*))')
        .eq('user_id', ctx.user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch active protocol' });
      return data;
    }),

  getProtocolHistory: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(50).default(20),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;

      const { data, error, count } = await sb
        .from('peptide_protocols')
        .select('*, protocol_peptides(*, peptide_library(*))', { count: 'exact' })
        .eq('user_id', ctx.user.id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch protocol history' });
      return { data: data ?? [], total: count ?? 0 };
    }),

  updateProtocolStatus: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      status: ProtocolStatusSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const updates: Record<string, any> = { status: input.status };
      if (input.status === 'completed' || input.status === 'archived') {
        updates.end_date = new Date().toISOString().split('T')[0];
      }

      const { data, error } = await sb
        .from('peptide_protocols')
        .update(updates)
        .eq('id', input.protocolId)
        .eq('user_id', ctx.user.id)
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update protocol status' });
      return data;
    }),

  // ── Feature 2: Biomarker Correlation Engine ────────────────

  getCorrelations: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('peptide_correlation_insights')
        .select('*')
        .eq('protocol_id', input.protocolId)
        .eq('user_id', ctx.user.id)
        .order('generated_at', { ascending: false });

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch correlations' });
      return data ?? [];
    }),

  getWearableCorrelations: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('peptide_correlation_insights')
        .select('*')
        .eq('protocol_id', input.protocolId)
        .eq('user_id', ctx.user.id)
        .eq('insight_type', 'wearable')
        .order('generated_at', { ascending: false });

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch wearable correlations' });
      return data ?? [];
    }),

  saveCorrelationInsight: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      insightType: z.enum(['biomarker', 'wearable', 'composite']),
      metricName: z.string(),
      baselineValue: z.number().optional(),
      currentValue: z.number().optional(),
      changePercent: z.number().optional(),
      direction: z.enum(['improved', 'declined', 'stable']),
      confidence: z.enum(['strong', 'moderate', 'weak']),
      aiExplanation: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('peptide_correlation_insights')
        .insert({
          user_id: ctx.user.id,
          protocol_id: input.protocolId,
          insight_type: input.insightType,
          metric_name: input.metricName,
          baseline_value: input.baselineValue,
          current_value: input.currentValue,
          change_percent: input.changePercent,
          direction: input.direction,
          confidence: input.confidence,
          ai_explanation: input.aiExplanation,
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to save insight' });
      return data;
    }),

  generateInsights: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      // Get baseline and current wearable snapshots
      const { data: snapshots } = await sb
        .from('peptide_wearable_snapshots')
        .select('*')
        .eq('protocol_id', input.protocolId)
        .eq('user_id', ctx.user.id)
        .in('snapshot_type', ['baseline', 'current'])
        .order('captured_at', { ascending: true });

      if (!snapshots || snapshots.length < 2) {
        return { insights: [], message: 'Need both baseline and current wearable snapshots to generate insights.' };
      }

      const baseline = snapshots.find((s: any) => s.snapshot_type === 'baseline');
      const current = snapshots.find((s: any) => s.snapshot_type === 'current');
      if (!baseline || !current) {
        return { insights: [], message: 'Missing baseline or current snapshot.' };
      }

      const metrics = [
        { key: 'hrv_avg', name: 'HRV', unit: 'ms', higherBetter: true },
        { key: 'resting_hr_avg', name: 'Resting Heart Rate', unit: 'bpm', higherBetter: false },
        { key: 'deep_sleep_pct', name: 'Deep Sleep', unit: '%', higherBetter: true },
        { key: 'rem_sleep_pct', name: 'REM Sleep', unit: '%', higherBetter: true },
        { key: 'total_sleep_min', name: 'Total Sleep', unit: 'min', higherBetter: true },
        { key: 'spo2_avg', name: 'SpO2', unit: '%', higherBetter: true },
        { key: 'recovery_score_avg', name: 'Recovery Score', unit: '', higherBetter: true },
        { key: 'steps_avg', name: 'Daily Steps', unit: '', higherBetter: true },
      ];

      const insights = [];
      for (const metric of metrics) {
        const baseVal = baseline[metric.key];
        const currVal = current[metric.key];
        if (baseVal == null || currVal == null) continue;

        const changePct = ((currVal - baseVal) / baseVal) * 100;
        const isImproved = metric.higherBetter ? currVal > baseVal : currVal < baseVal;
        const direction = Math.abs(changePct) < 3 ? 'stable' : isImproved ? 'improved' : 'declined';
        const confidence = Math.abs(changePct) > 15 ? 'strong' : Math.abs(changePct) > 7 ? 'moderate' : 'weak';

        const explanation = direction === 'improved'
          ? `${metric.name} improved from ${baseVal}${metric.unit} to ${currVal}${metric.unit} (${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%).`
          : direction === 'declined'
          ? `${metric.name} declined from ${baseVal}${metric.unit} to ${currVal}${metric.unit} (${changePct.toFixed(1)}%). Consider protocol adjustment.`
          : `${metric.name} stable at ${currVal}${metric.unit}.`;

        insights.push({
          insightType: 'wearable' as const,
          metricName: metric.name,
          baselineValue: baseVal,
          currentValue: currVal,
          changePercent: parseFloat(changePct.toFixed(1)),
          direction,
          confidence,
          aiExplanation: explanation,
        });
      }

      // Save insights to DB
      if (insights.length > 0) {
        await sb.from('peptide_correlation_insights').insert(
          insights.map(i => ({
            user_id: ctx.user.id,
            protocol_id: input.protocolId,
            insight_type: i.insightType,
            metric_name: i.metricName,
            baseline_value: i.baselineValue,
            current_value: i.currentValue,
            change_percent: i.changePercent,
            direction: i.direction,
            confidence: i.confidence,
            ai_explanation: i.aiExplanation,
          }))
        );
      }

      return { insights };
    }),

  // ── Feature 3: Interaction & Safety Engine ─────────────────

  checkInteractions: protectedProcedure
    .input(z.object({ peptideSlugs: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const slugs = input.peptideSlugs;

      const { data, error } = await sb
        .from('peptide_interactions')
        .select('*')
        .or(
          slugs.map(s => `peptide_a_slug.eq.${s},peptide_b_slug.eq.${s}`).join(',')
        );

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to check interactions' });

      // Filter to only interactions between peptides in the provided list
      const relevant = (data ?? []).filter((i: any) =>
        slugs.includes(i.peptide_a_slug) && slugs.includes(i.peptide_b_slug)
      );

      return relevant;
    }),

  checkContraindications: protectedProcedure
    .input(z.object({
      peptideSlugs: z.array(z.string()).min(1),
      conditions: z.array(z.string()),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from('peptide_contraindications')
        .select('*')
        .in('peptide_slug', input.peptideSlugs);

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to check contraindications' });

      // Filter to matching conditions
      const matches = (data ?? []).filter((c: any) =>
        input.conditions.some(cond => cond.toLowerCase().includes(c.condition.toLowerCase()))
      );

      return matches;
    }),

  checkLabThresholds: protectedProcedure
    .input(z.object({
      peptideSlugs: z.array(z.string()).min(1),
      labValues: z.array(LabValueSchema),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from('peptide_lab_thresholds')
        .select('*')
        .in('peptide_slug', input.peptideSlugs);

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to check lab thresholds' });

      const triggered = [];
      for (const threshold of data ?? []) {
        const labValue = input.labValues.find(l => l.biomarker === threshold.biomarker_name);
        if (labValue) {
          const isTrig = threshold.direction === 'above'
            ? labValue.value > threshold.threshold_value
            : labValue.value < threshold.threshold_value;
          if (isTrig) {
            triggered.push({
              ...threshold,
              actualValue: labValue.value,
            });
          }
        }
      }

      return triggered;
    }),

  getFullSafetyReport: protectedProcedure
    .input(z.object({
      peptideSlugs: z.array(z.string()).min(1),
      conditions: z.array(z.string()).default([]),
      labValues: z.array(LabValueSchema).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const slugs = input.peptideSlugs;

      // 1. Interactions
      const { data: interactionData } = await sb
        .from('peptide_interactions')
        .select('*')
        .or(slugs.map(s => `peptide_a_slug.eq.${s},peptide_b_slug.eq.${s}`).join(','));

      const interactions = (interactionData ?? []).filter((i: any) =>
        slugs.includes(i.peptide_a_slug) && slugs.includes(i.peptide_b_slug)
      );

      // 2. Contraindications
      const { data: contraData } = await sb
        .from('peptide_contraindications')
        .select('*')
        .in('peptide_slug', slugs);

      const contraindications = (contraData ?? []).filter((c: any) =>
        input.conditions.length === 0 ||
        input.conditions.some(cond => cond.toLowerCase().includes(c.condition.toLowerCase()))
      );

      // 3. Lab thresholds
      const { data: thresholdData } = await sb
        .from('peptide_lab_thresholds')
        .select('*')
        .in('peptide_slug', slugs);

      const labThresholds = [];
      for (const t of thresholdData ?? []) {
        const labValue = input.labValues.find(l => l.biomarker === t.biomarker_name);
        if (labValue) {
          const triggered = t.direction === 'above' ? labValue.value > t.threshold_value : labValue.value < t.threshold_value;
          if (triggered) labThresholds.push({ ...t, actualValue: labValue.value });
        }
      }

      // Determine overall severity
      const allSeverities = [
        ...interactions.map((i: any) => i.severity),
        ...contraindications.map((c: any) => c.severity),
        ...labThresholds.map((l: any) => l.severity),
      ];

      const severityOrder = ['critical', 'warning', 'caution', 'info'];
      const overallSeverity = severityOrder.find(s => allSeverities.includes(s)) ?? 'info';
      const safeToStart = !allSeverities.includes('critical');

      return {
        interactions,
        contraindications,
        labThresholds,
        overallSeverity,
        safeToStart,
      };
    }),

  // ── Feature 4: Dose Logging & Tracking ─────────────────────

  logDose: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      protocolPeptideId: z.string().uuid(),
      doseAmount: z.number().positive(),
      doseUnit: DoseUnitSchema,
      injectionSite: z.string().optional(),
      notes: z.string().optional(),
      loggedAt: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('peptide_dose_logs')
        .insert({
          user_id: ctx.user.id,
          protocol_id: input.protocolId,
          protocol_peptide_id: input.protocolPeptideId,
          dose_amount: input.doseAmount,
          dose_unit: input.doseUnit,
          injection_site: input.injectionSite,
          status: 'taken',
          notes: input.notes,
          logged_at: input.loggedAt ?? new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to log dose' });
      return data;
    }),

  skipDose: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      protocolPeptideId: z.string().uuid(),
      doseAmount: z.number().positive(),
      doseUnit: DoseUnitSchema,
      skipReason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('peptide_dose_logs')
        .insert({
          user_id: ctx.user.id,
          protocol_id: input.protocolId,
          protocol_peptide_id: input.protocolPeptideId,
          dose_amount: input.doseAmount,
          dose_unit: input.doseUnit,
          status: 'skipped',
          skip_reason: input.skipReason,
          logged_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to log skipped dose' });
      return data;
    }),

  getDoseLogs: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(100),
    }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      let query = sb
        .from('peptide_dose_logs')
        .select('*')
        .eq('protocol_id', input.protocolId)
        .eq('user_id', ctx.user.id)
        .order('logged_at', { ascending: false })
        .limit(input.limit);

      if (input.startDate) query = query.gte('logged_at', input.startDate);
      if (input.endDate) query = query.lte('logged_at', input.endDate);

      const { data, error } = await query;
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch dose logs' });
      return data ?? [];
    }),

  getAdherence: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      days: z.number().int().min(1).max(365).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const { data: logs, error } = await sb
        .from('peptide_dose_logs')
        .select('*, protocol_peptides(peptide_library(name, slug))')
        .eq('protocol_id', input.protocolId)
        .eq('user_id', ctx.user.id)
        .gte('logged_at', since.toISOString())
        .order('logged_at', { ascending: true });

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch adherence data' });

      const allLogs = logs ?? [];
      const taken = allLogs.filter((l: any) => l.status === 'taken').length;
      const skipped = allLogs.filter((l: any) => l.status === 'skipped').length;
      const total = allLogs.length;

      // Calculate streak
      let currentStreak = 0;
      let longestStreak = 0;
      let tempStreak = 0;
      const sortedByDate = [...allLogs].sort((a: any, b: any) =>
        new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime()
      );

      for (const log of sortedByDate) {
        if ((log as any).status === 'taken') {
          tempStreak++;
          longestStreak = Math.max(longestStreak, tempStreak);
        } else {
          if (currentStreak === 0) currentStreak = tempStreak;
          tempStreak = 0;
        }
      }
      if (currentStreak === 0) currentStreak = tempStreak;
      longestStreak = Math.max(longestStreak, tempStreak);

      // Per-peptide breakdown
      const byPeptide: Record<string, { name: string; taken: number; skipped: number }> = {};
      for (const log of allLogs) {
        const pepName = (log as any).protocol_peptides?.peptide_library?.name ?? 'Unknown';
        const pepId = (log as any).protocol_peptide_id;
        if (!byPeptide[pepId]) byPeptide[pepId] = { name: pepName, taken: 0, skipped: 0 };
        if ((log as any).status === 'taken') byPeptide[pepId].taken++;
        else byPeptide[pepId].skipped++;
      }

      return {
        totalScheduled: total,
        totalTaken: taken,
        totalSkipped: skipped,
        adherencePercent: total > 0 ? Math.round((taken / total) * 100) : 0,
        currentStreak,
        longestStreak,
        byPeptide: Object.entries(byPeptide).map(([peptideId, stats]) => ({
          peptideId,
          peptideName: stats.name,
          taken: stats.taken,
          skipped: stats.skipped,
          percent: stats.taken + stats.skipped > 0 ? Math.round((stats.taken / (stats.taken + stats.skipped)) * 100) : 0,
        })),
      };
    }),

  getInjectionSiteHistory: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      limit: z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('peptide_dose_logs')
        .select('injection_site, logged_at, protocol_peptide_id')
        .eq('protocol_id', input.protocolId)
        .eq('user_id', ctx.user.id)
        .eq('status', 'taken')
        .not('injection_site', 'is', null)
        .order('logged_at', { ascending: false })
        .limit(input.limit);

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch injection history' });
      return data ?? [];
    }),

  // ── Feature 5: Practitioner Reports ────────────────────────

  getProtocolSummary: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      userId: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const targetUserId = input.userId ?? ctx.user.id;

      const { data: protocol, error } = await sb
        .from('peptide_protocols')
        .select('*, protocol_peptides(*, peptide_library(*))')
        .eq('id', input.protocolId)
        .single();

      if (error || !protocol) throw new TRPCError({ code: 'NOT_FOUND', message: 'Protocol not found' });

      // Get correlations
      const { data: correlations } = await sb
        .from('peptide_correlation_insights')
        .select('*')
        .eq('protocol_id', input.protocolId)
        .order('generated_at', { ascending: false });

      // Get wearable snapshots
      const { data: snapshots } = await sb
        .from('peptide_wearable_snapshots')
        .select('*')
        .eq('protocol_id', input.protocolId);

      // Get adherence summary
      const { data: doseLogs } = await sb
        .from('peptide_dose_logs')
        .select('status')
        .eq('protocol_id', input.protocolId);

      const taken = (doseLogs ?? []).filter((l: any) => l.status === 'taken').length;
      const total = (doseLogs ?? []).length;

      return {
        protocol,
        correlations: correlations ?? [],
        wearableSnapshots: snapshots ?? [],
        adherenceSummary: {
          totalDoses: total,
          takenDoses: taken,
          adherencePercent: total > 0 ? Math.round((taken / total) * 100) : 0,
        },
      };
    }),

  addPractitionerNotes: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      notes: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('peptide_protocols')
        .update({ practitioner_notes: input.notes })
        .eq('id', input.protocolId)
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add practitioner notes' });
      return data;
    }),

  approveProtocol: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('peptide_protocols')
        .update({
          practitioner_approved: true,
          approved_at: new Date().toISOString(),
          approved_by: ctx.user.id,
        })
        .eq('id', input.protocolId)
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to approve protocol' });
      return data;
    }),

  // ── Feature 6: Lab Optimization Intelligence ───────────────

  getLabOptimizationSuggestions: protectedProcedure
    .input(z.object({
      labType: LabTypeSchema.optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      let query = sb.from('lab_peptide_mappings').select('*').order('priority_level', { ascending: false });

      if (input?.labType) {
        query = query.eq('lab_type', input.labType);
      }

      const { data, error } = await query;
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch lab suggestions' });

      // Enrich with peptide data
      const allSlugs = [...new Set((data ?? []).flatMap((m: any) => m.recommended_peptide_slugs))];
      const { data: peptides } = await sb
        .from('peptide_library')
        .select('*')
        .in('slug', allSlugs);

      const peptideMap = new Map((peptides ?? []).map((p: any) => [p.slug, p]));

      return (data ?? []).map((mapping: any) => ({
        ...mapping,
        recommendedPeptides: (mapping.recommended_peptide_slugs ?? [])
          .map((slug: string) => peptideMap.get(slug))
          .filter(Boolean),
      }));
    }),

  getLabSuggestionsByType: protectedProcedure
    .input(z.object({ labType: LabTypeSchema }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('lab_peptide_mappings')
        .select('*')
        .eq('lab_type', input.labType)
        .order('priority_level', { ascending: false });

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch suggestions' });
      return data ?? [];
    }),

  // ── Feature 7: Cycling, Periodization & Tapering ───────────

  addPhase: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      phaseName: z.string(),
      phaseOrder: z.number().int(),
      phaseType: PhaseTypeSchema,
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      durationDays: z.number().int().positive().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('protocol_phases')
        .insert({
          protocol_id: input.protocolId,
          phase_name: input.phaseName,
          phase_order: input.phaseOrder,
          phase_type: input.phaseType,
          start_date: input.startDate,
          end_date: input.endDate,
          duration_days: input.durationDays,
          description: input.description,
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add phase' });
      return data;
    }),

  getPhases: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('protocol_phases')
        .select('*')
        .eq('protocol_id', input.protocolId)
        .order('phase_order', { ascending: true });

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch phases' });
      return data ?? [];
    }),

  updatePhase: protectedProcedure
    .input(z.object({
      phaseId: z.string().uuid(),
      phaseName: z.string().optional(),
      phaseType: PhaseTypeSchema.optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      durationDays: z.number().int().positive().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { phaseId, ...updates } = input;
      const dbUpdates: Record<string, any> = {};
      if (updates.phaseName !== undefined) dbUpdates.phase_name = updates.phaseName;
      if (updates.phaseType !== undefined) dbUpdates.phase_type = updates.phaseType;
      if (updates.startDate !== undefined) dbUpdates.start_date = updates.startDate;
      if (updates.endDate !== undefined) dbUpdates.end_date = updates.endDate;
      if (updates.durationDays !== undefined) dbUpdates.duration_days = updates.durationDays;
      if (updates.description !== undefined) dbUpdates.description = updates.description;

      const { data, error } = await sb
        .from('protocol_phases')
        .update(dbUpdates)
        .eq('id', phaseId)
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update phase' });
      return data;
    }),

  deletePhase: protectedProcedure
    .input(z.object({ phaseId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { error } = await sb.from('protocol_phases').delete().eq('id', input.phaseId);
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to delete phase' });
      return { success: true };
    }),

  setPhaseSchedule: protectedProcedure
    .input(z.object({
      protocolPeptideId: z.string().uuid(),
      phaseId: z.string().uuid().optional(),
      phaseName: z.string().optional(),
      phaseOrder: z.number().int().default(0),
      doseAmount: z.number().positive(),
      doseUnit: DoseUnitSchema,
      frequency: z.string(),
      durationDays: z.number().int().positive(),
      isActivePhase: z.boolean().default(true),
      taperType: TaperTypeSchema.default('none'),
      taperStepReduction: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('protocol_schedule')
        .insert({
          protocol_peptide_id: input.protocolPeptideId,
          phase_id: input.phaseId,
          phase_name: input.phaseName,
          phase_order: input.phaseOrder,
          dose_amount: input.doseAmount,
          dose_unit: input.doseUnit,
          frequency: input.frequency,
          duration_days: input.durationDays,
          is_active_phase: input.isActivePhase,
          taper_type: input.taperType,
          taper_step_reduction: input.taperStepReduction,
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to set schedule' });
      return data;
    }),

  getSchedule: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: phases } = await sb
        .from('protocol_phases')
        .select('*')
        .eq('protocol_id', input.protocolId)
        .order('phase_order', { ascending: true });

      const { data: peptides } = await sb
        .from('protocol_peptides')
        .select('*, peptide_library(*), protocol_schedule(*)')
        .eq('protocol_id', input.protocolId)
        .order('sort_order', { ascending: true });

      return {
        phases: phases ?? [],
        peptides: peptides ?? [],
      };
    }),

  // ── Wearable Snapshots ─────────────────────────────────────

  captureWearableSnapshot: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      snapshotType: z.enum(['baseline', 'current', 'final']),
      hrvAvg: z.number().optional(),
      restingHrAvg: z.number().optional(),
      deepSleepPct: z.number().optional(),
      remSleepPct: z.number().optional(),
      totalSleepMin: z.number().optional(),
      spo2Avg: z.number().optional(),
      bodyTempAvg: z.number().optional(),
      stepsAvg: z.number().optional(),
      recoveryScoreAvg: z.number().optional(),
      measurementPeriodDays: z.number().int().default(7),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('peptide_wearable_snapshots')
        .insert({
          user_id: ctx.user.id,
          protocol_id: input.protocolId,
          snapshot_type: input.snapshotType,
          hrv_avg: input.hrvAvg,
          resting_hr_avg: input.restingHrAvg,
          deep_sleep_pct: input.deepSleepPct,
          rem_sleep_pct: input.remSleepPct,
          total_sleep_min: input.totalSleepMin,
          spo2_avg: input.spo2Avg,
          body_temp_avg: input.bodyTempAvg,
          steps_avg: input.stepsAvg,
          recovery_score_avg: input.recoveryScoreAvg,
          measurement_period_days: input.measurementPeriodDays,
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to capture snapshot' });
      return data;
    }),

  getWearableSnapshots: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('peptide_wearable_snapshots')
        .select('*')
        .eq('protocol_id', input.protocolId)
        .eq('user_id', ctx.user.id)
        .order('captured_at', { ascending: true });

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch snapshots' });
      return data ?? [];
    }),
});
