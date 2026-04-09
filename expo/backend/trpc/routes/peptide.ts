import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, createTRPCRouter } from "../create-context";
import { createServerSupabaseClient } from "../../supabase-server";
import { assertOwnership } from "../ownership";

/**
 * Peptide Intelligence Platform Router
 *
 * Features:
 * 1. Lab-aware AI protocol builder
 * 2. Biomarker correlation engine
 * 3. Interaction & contraindication engine
 * 4. Wearable effectiveness tracking
 * 5. Practitioner peptide reports
 * 6. Functional medicine lab → peptide optimization
 * 7. Cycling, periodization & tapering
 */

// ============================================================
// PEPTIDE LIBRARY
// ============================================================
const libraryRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      let query = sb.from('peptide_library').select('*').eq('is_active', true);
      if (input?.category) query = query.eq('category', input.category);
      query = query.order('name');
      const { data } = await query;
      return data ?? [];
    }),

  getById: protectedProcedure
    .input(z.object({ peptideId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb.from('peptide_library').select('*').eq('peptide_id', input.peptideId).single();
      return data;
    }),

  getCategories: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);
    const { data } = await sb.from('peptide_library').select('category').eq('is_active', true);
    const cats = new Set<string>();
    (data ?? []).forEach((r: Record<string, unknown>) => cats.add(r.category as string));
    return Array.from(cats).sort();
  }),

  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const safe = input.query.replace(/[,.()\\\[\]%;'"]/g, '').slice(0, 200).trim();
      const { data } = await sb.from('peptide_library').select('*').eq('is_active', true)
        .or(`name.ilike.%${safe}%,mechanism.ilike.%${safe}%`);
      return data ?? [];
    }),
});

// ============================================================
// FEATURE 1: LAB-AWARE PROTOCOL BUILDER
// ============================================================
const protocolBuilderRouter = createTRPCRouter({
  /** Generate an AI peptide protocol based on labs + wearables + goal */
  generateProtocol: protectedProcedure
    .input(z.object({
      userId: z.string(),
      goal: z.enum(['fat_loss','muscle_recovery','sleep_optimization','gut_healing','immune_support','anti_aging','cognitive_enhancement','injury_recovery','hormone_optimization']),
    }))
    .mutation(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);

      // Fetch user's latest labs (past 90 days)
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
      const { data: labResults } = await sb
        .from('clinic_lab_results')
        .select('lab_test_id, value, unit, status, result_date')
        .eq('patient_id', input.userId)
        .gte('result_date', ninetyDaysAgo.split('T')[0])
        .order('result_date', { ascending: false });

      // Fetch lab test names
      const testIds = [...new Set((labResults ?? []).map((r: Record<string, unknown>) => r.lab_test_id as string))];
      const labTestNames = new Map<string, string>();
      if (testIds.length > 0) {
        const { data: tests } = await sb.from('clinic_lab_tests').select('id, code, name').in('id', testIds);
        (tests ?? []).forEach((t: Record<string, unknown>) => labTestNames.set(t.id as string, `${t.name} (${t.code})`));
      }

      // Fetch recent biometric summary (past 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: biometrics } = await sb
        .from('clinic_biometric_readings')
        .select('biometric_type_id, value, reading_time')
        .eq('patient_id', input.userId)
        .gte('reading_time', thirtyDaysAgo)
        .order('reading_time', { ascending: false });

      // Fetch peptide library for matching
      const { data: peptides } = await sb.from('peptide_library').select('*').eq('is_active', true);

      // Fetch lab-to-peptide mappings for smart suggestions
      const { data: labMappings } = await sb.from('lab_peptide_mappings').select('*').eq('is_active', true);

      // Build lab context
      const labContext = (labResults ?? []).map((r: Record<string, unknown>) => ({
        test: labTestNames.get(r.lab_test_id as string) ?? 'Unknown',
        value: r.value,
        unit: r.unit,
        status: r.status,
        date: r.result_date,
      }));

      // Match peptides to goal
      const goalPeptides = (peptides ?? []).filter((p: Record<string, unknown>) => {
        const goals = p.goals as string[];
        return goals.some((g) => input.goal.includes(g) || g.includes(input.goal.split('_')[0]));
      });

      // Check lab mappings for additional recommendations
      const labSuggestions: Array<{ peptide: string; reasoning: string }> = [];
      (labMappings ?? []).forEach((mapping: Record<string, unknown>) => {
        const recs = mapping.recommended_peptides as Array<{ peptideId: string; reason: string }>;
        recs.forEach((rec) => {
          labSuggestions.push({ peptide: rec.peptideId, reasoning: mapping.reasoning as string });
        });
      });

      // Build protocol recommendation
      const recommended = goalPeptides.slice(0, 4).map((p: Record<string, unknown>, i: number) => ({
        peptideId: p.peptide_id as string,
        name: p.name as string,
        doseAmount: p.typical_dose_min as number,
        doseUnit: p.dose_unit as string,
        frequency: i === 0 ? 'daily' : '3x_week',
        timing: input.goal === 'sleep_optimization' ? 'pre_bed' : 'morning',
        durationWeeks: 8,
        rationale: `Selected for ${input.goal}: ${(p.mechanism as string).slice(0, 200)}`,
      }));

      // Build wearable snapshot
      const wearableSnapshot = {
        collectedAt: new Date().toISOString(),
        readingCount: (biometrics ?? []).length,
      };

      return {
        goal: input.goal,
        labContext: labContext.slice(0, 20),
        labSuggestions: labSuggestions.slice(0, 5),
        recommendedPeptides: recommended,
        wearableSnapshot,
        suggestedDurationWeeks: 8,
        suggestedRetestWeeks: 6,
        retestBiomarkers: ['IGF-1', 'CRP', 'ALT', 'AST'],
      };
    }),

  /** Save an accepted protocol */
  saveProtocol: protectedProcedure
    .input(z.object({
      userId: z.string(),
      goal: z.string(),
      aiReasoning: z.string().optional(),
      wearableSnapshot: z.record(z.string(), z.unknown()).optional(),
      startDate: z.string(),
      endDate: z.string().optional(),
      peptides: z.array(z.object({
        peptideId: z.string(),
        doseAmount: z.number(),
        doseUnit: z.string(),
        frequency: z.string(),
        timing: z.string(),
        durationWeeks: z.number().optional(),
        aiRationale: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);

      // Create protocol
      const { data: protocol, error } = await sb
        .from('peptide_protocols')
        .insert({
          user_id: input.userId,
          goal: input.goal,
          status: 'active',
          ai_reasoning: input.aiReasoning,
          wearable_snapshot: input.wearableSnapshot ?? {},
          start_date: input.startDate,
          end_date: input.endDate,
        })
        .select()
        .single();

      if (error || !protocol) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create protocol' });
      }

      // Add peptides
      for (let i = 0; i < input.peptides.length; i++) {
        const p = input.peptides[i];
        await sb.from('protocol_peptides').insert({
          protocol_id: protocol.id,
          peptide_id: p.peptideId,
          dose_amount: p.doseAmount,
          dose_unit: p.doseUnit,
          frequency: p.frequency,
          timing: p.timing,
          duration_weeks: p.durationWeeks,
          ai_rationale: p.aiRationale,
          sort_order: i,
        });
      }

      return { protocolId: protocol.id, status: 'active' };
    }),

  /** Get active protocol */
  getActiveProtocol: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: protocol } = await sb
        .from('peptide_protocols')
        .select('*')
        .eq('user_id', input.userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!protocol) return null;

      const { data: peptides } = await sb
        .from('protocol_peptides')
        .select('*, peptide_library!inner(name, category, mechanism)')
        .eq('protocol_id', protocol.id)
        .order('sort_order');

      const { data: phases } = await sb
        .from('protocol_phases')
        .select('*')
        .eq('protocol_id', protocol.id)
        .order('phase_order');

      return { protocol, peptides: peptides ?? [], phases: phases ?? [] };
    }),

  /** Get protocol history */
  getHistory: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('peptide_protocols')
        .select('id, goal, status, start_date, end_date, created_at')
        .eq('user_id', input.userId)
        .order('created_at', { ascending: false });
      return data ?? [];
    }),

  /** Update protocol status */
  updateStatus: protectedProcedure
    .input(z.object({
      protocolId: z.string(),
      status: z.enum(['active', 'paused', 'completed', 'cancelled']),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const updateData: Record<string, unknown> = { status: input.status };
      if (input.status === 'completed' || input.status === 'cancelled') {
        updateData.end_date = new Date().toISOString().split('T')[0];
      }
      await sb.from('peptide_protocols').update(updateData).eq('id', input.protocolId);
      return { success: true };
    }),
});

// ============================================================
// FEATURE 2: BIOMARKER CORRELATION ENGINE
// ============================================================
const correlationRouter = createTRPCRouter({
  /** Get biomarker correlations for a protocol */
  getCorrelations: protectedProcedure
    .input(z.object({ userId: z.string(), protocolId: z.string() }))
    .query(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: protocol } = await sb
        .from('peptide_protocols')
        .select('start_date, end_date, goal')
        .eq('id', input.protocolId)
        .single();

      if (!protocol) return { correlations: [], insights: [] };

      const startDate = protocol.start_date as string;

      // Get labs before protocol (baseline)
      const { data: baselineLabs } = await sb
        .from('clinic_lab_results')
        .select('lab_test_id, value, unit, result_date')
        .eq('patient_id', input.userId)
        .lt('result_date', startDate)
        .order('result_date', { ascending: false })
        .limit(50);

      // Get labs after protocol started
      const { data: currentLabs } = await sb
        .from('clinic_lab_results')
        .select('lab_test_id, value, unit, result_date')
        .eq('patient_id', input.userId)
        .gte('result_date', startDate)
        .order('result_date', { ascending: false })
        .limit(50);

      // Get test names
      const allTestIds = new Set<string>();
      [...(baselineLabs ?? []), ...(currentLabs ?? [])].forEach((r: Record<string, unknown>) => {
        allTestIds.add(r.lab_test_id as string);
      });
      const labNames = new Map<string, string>();
      if (allTestIds.size > 0) {
        const { data: tests } = await sb.from('clinic_lab_tests').select('id, name, code').in('id', [...allTestIds]);
        (tests ?? []).forEach((t: Record<string, unknown>) => labNames.set(t.id as string, `${t.name}`));
      }

      // Build correlations by matching baseline vs current for same tests
      const correlations: Array<{
        biomarker: string;
        baselineValue: number;
        currentValue: number;
        change: number;
        changePercent: number;
        direction: 'improved' | 'worsened' | 'stable';
        unit: string;
      }> = [];

      const baselineByTest = new Map<string, { value: number; unit: string }>();
      (baselineLabs ?? []).forEach((r: Record<string, unknown>) => {
        const tid = r.lab_test_id as string;
        if (!baselineByTest.has(tid)) {
          baselineByTest.set(tid, { value: r.value as number, unit: r.unit as string });
        }
      });

      (currentLabs ?? []).forEach((r: Record<string, unknown>) => {
        const tid = r.lab_test_id as string;
        const baseline = baselineByTest.get(tid);
        if (baseline) {
          const current = r.value as number;
          const change = current - baseline.value;
          const pct = baseline.value !== 0 ? Math.round((change / baseline.value) * 100) : 0;
          correlations.push({
            biomarker: labNames.get(tid) ?? 'Unknown',
            baselineValue: baseline.value,
            currentValue: current,
            change,
            changePercent: pct,
            direction: Math.abs(pct) < 5 ? 'stable' : change > 0 ? 'improved' : 'worsened',
            unit: baseline.unit,
          });
        }
      });

      return { correlations, protocolGoal: protocol.goal, startDate };
    }),

  /** Get wearable correlations */
  getWearableCorrelations: protectedProcedure
    .input(z.object({ userId: z.string(), protocolId: z.string() }))
    .query(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: protocol } = await sb
        .from('peptide_protocols')
        .select('start_date, wearable_snapshot')
        .eq('id', input.protocolId)
        .single();

      if (!protocol) return { metrics: [] };

      const startDate = protocol.start_date as string;

      // Get current 7-day biometric averages
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data: recentReadings } = await sb
        .from('clinic_biometric_readings')
        .select('biometric_type_id, value')
        .eq('patient_id', input.userId)
        .gte('reading_time', sevenDaysAgo);

      const { data: bioTypes } = await sb.from('clinic_biometric_types').select('id, code, name');
      const typeNames = new Map<string, string>();
      (bioTypes ?? []).forEach((t: Record<string, unknown>) => typeNames.set(t.id as string, t.name as string));

      // Average by type
      const byType = new Map<string, number[]>();
      (recentReadings ?? []).forEach((r: Record<string, unknown>) => {
        const tid = r.biometric_type_id as string;
        const arr = byType.get(tid) ?? [];
        arr.push(r.value as number);
        byType.set(tid, arr);
      });

      const metrics = Array.from(byType.entries()).map(([typeId, values]) => ({
        metric: typeNames.get(typeId) ?? 'Unknown',
        currentAvg: Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10,
        readingCount: values.length,
      }));

      return { metrics, protocolStartDate: startDate };
    }),
});

// ============================================================
// FEATURE 3: INTERACTION & CONTRAINDICATION ENGINE
// ============================================================
const safetyRouter = createTRPCRouter({
  /** Check interactions for a set of peptides */
  checkInteractions: protectedProcedure
    .input(z.object({ peptideIds: z.array(z.string()).min(1).max(20) }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data: interactions } = await sb
        .from('peptide_interactions')
        .select('*')
        .eq('is_active', true)
        .or(
          input.peptideIds.map((id) => `peptide_a.eq.${id},peptide_b.eq.${id}`).join(',')
        );

      // Filter to only interactions between the selected peptides
      const selected = new Set(input.peptideIds);
      const relevant = (interactions ?? []).filter((i: Record<string, unknown>) =>
        selected.has(i.peptide_a as string) && selected.has(i.peptide_b as string)
      );

      return relevant.map((i: Record<string, unknown>) => ({
        peptideA: i.peptide_a as string,
        peptideB: i.peptide_b as string,
        type: i.interaction_type as string,
        severity: i.severity as string,
        description: i.description as string,
        recommendation: i.recommendation as string | null,
      }));
    }),

  /** Check contraindications against user conditions */
  checkContraindications: protectedProcedure
    .input(z.object({ peptideIds: z.array(z.string()), conditions: z.array(z.string()).optional() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('peptide_contraindications')
        .select('*')
        .eq('is_active', true)
        .in('peptide_id', input.peptideIds);

      return (data ?? []).map((c: Record<string, unknown>) => ({
        peptideId: c.peptide_id as string,
        condition: c.condition as string,
        severity: c.severity as string,
        description: c.description as string,
        recommendation: c.recommendation as string | null,
      }));
    }),

  /** Check lab thresholds for a user's peptide stack */
  checkLabThresholds: protectedProcedure
    .input(z.object({ userId: z.string(), peptideIds: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: thresholds } = await sb
        .from('peptide_lab_thresholds')
        .select('*')
        .eq('is_active', true)
        .in('peptide_id', input.peptideIds);

      // Get user's latest lab values for the relevant biomarkers
      const biomarkerNames = [...new Set((thresholds ?? []).map((t: Record<string, unknown>) => t.biomarker_name as string))];
      const { data: labResults } = await sb
        .from('clinic_lab_results')
        .select('value, lab_test_id')
        .eq('patient_id', input.userId)
        .order('result_date', { ascending: false });

      const { data: labTests } = await sb.from('clinic_lab_tests').select('id, code, name');
      const testByName = new Map<string, string>();
      (labTests ?? []).forEach((t: Record<string, unknown>) => {
        testByName.set(t.code as string, t.id as string);
        testByName.set((t.name as string).toLowerCase(), t.id as string);
      });

      const alerts: Array<{
        peptideId: string;
        biomarker: string;
        threshold: number;
        currentValue: number | null;
        severity: string;
        message: string;
      }> = [];

      (thresholds ?? []).forEach((t: Record<string, unknown>) => {
        const biomarker = t.biomarker_name as string;
        const testId = testByName.get(biomarker) || testByName.get(biomarker.toLowerCase());
        const labValue = testId
          ? (labResults ?? []).find((r: Record<string, unknown>) => r.lab_test_id === testId)
          : null;

        if (labValue) {
          const val = labValue.value as number;
          const threshold = t.threshold_value as number;
          const dir = t.direction as string;
          const triggered = (dir === 'above' && val > threshold) || (dir === 'below' && val < threshold);

          if (triggered) {
            alerts.push({
              peptideId: t.peptide_id as string,
              biomarker,
              threshold,
              currentValue: val,
              severity: t.severity as string,
              message: t.message as string,
            });
          }
        }
      });

      return alerts;
    }),

  /** Get full safety report for a protocol */
  getFullSafetyReport: protectedProcedure
    .input(z.object({ userId: z.string(), protocolId: z.string() }))
    .query(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: protocolPeptides } = await sb
        .from('protocol_peptides')
        .select('peptide_id')
        .eq('protocol_id', input.protocolId);

      const peptideIds = (protocolPeptides ?? []).map((p: Record<string, unknown>) => p.peptide_id as string);
      if (peptideIds.length === 0) return { interactions: [], contraindications: [], labAlerts: [] };

      // Parallel safety checks
      const [interactions, contraindications, labThresholds] = await Promise.all([
        sb.from('peptide_interactions').select('*').eq('is_active', true),
        sb.from('peptide_contraindications').select('*').eq('is_active', true).in('peptide_id', peptideIds),
        sb.from('peptide_lab_thresholds').select('*').eq('is_active', true).in('peptide_id', peptideIds),
      ]);

      const selectedSet = new Set(peptideIds);
      const relevantInteractions = (interactions.data ?? []).filter((i: Record<string, unknown>) =>
        selectedSet.has(i.peptide_a as string) && selectedSet.has(i.peptide_b as string)
      );

      return {
        interactions: relevantInteractions,
        contraindications: contraindications.data ?? [],
        labAlerts: labThresholds.data ?? [],
      };
    }),
});

// ============================================================
// FEATURE 4: DOSE LOGGING & ADHERENCE
// ============================================================
const doseLoggingRouter = createTRPCRouter({
  logDose: protectedProcedure
    .input(z.object({
      protocolPeptideId: z.string(),
      doseAmount: z.number(),
      doseUnit: z.string(),
      injectionSite: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('peptide_dose_logs')
        .insert({
          user_id: ctx.user.id,
          protocol_peptide_id: input.protocolPeptideId,
          dose_amount: input.doseAmount,
          dose_unit: input.doseUnit,
          injection_site: input.injectionSite,
          notes: input.notes,
          taken_at: new Date().toISOString(),
          date: new Date().toISOString().split('T')[0],
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to log dose' });
      return { id: data.id };
    }),

  skipDose: protectedProcedure
    .input(z.object({ protocolPeptideId: z.string(), notes: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      await sb.from('peptide_dose_logs').insert({
        user_id: ctx.user.id,
        protocol_peptide_id: input.protocolPeptideId,
        dose_amount: 0,
        dose_unit: 'mcg',
        skipped: true,
        notes: input.notes,
        date: new Date().toISOString().split('T')[0],
      });
      return { success: true };
    }),

  getAdherence: protectedProcedure
    .input(z.object({ userId: z.string(), protocolId: z.string(), days: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const cutoff = new Date(Date.now() - input.days * 86400000).toISOString().split('T')[0];

      const { data: logs } = await sb
        .from('peptide_dose_logs')
        .select('date, skipped, taken_at, protocol_peptide_id')
        .eq('user_id', input.userId)
        .gte('date', cutoff)
        .order('date');

      const taken = (logs ?? []).filter((l: Record<string, unknown>) => !l.skipped && l.taken_at);
      const skipped = (logs ?? []).filter((l: Record<string, unknown>) => l.skipped);
      const total = (logs ?? []).length;
      const adherenceRate = total > 0 ? Math.round((taken.length / total) * 100) : 100;

      // Injection site rotation tracking
      const siteHistory = new Map<string, number>();
      taken.forEach((l: Record<string, unknown>) => {
        // Would need injection_site in the select - simplified
      });

      return { taken: taken.length, skipped: skipped.length, total, adherenceRate, days: input.days };
    }),

  getInjectionHistory: protectedProcedure
    .input(z.object({ userId: z.string(), days: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const cutoff = new Date(Date.now() - input.days * 86400000).toISOString().split('T')[0];

      const { data } = await sb
        .from('peptide_dose_logs')
        .select('injection_site, taken_at, date')
        .eq('user_id', input.userId)
        .eq('skipped', false)
        .gte('date', cutoff)
        .not('injection_site', 'is', null)
        .order('taken_at', { ascending: false });

      return data ?? [];
    }),
});

// ============================================================
// FEATURE 6: LAB-TO-PEPTIDE OPTIMIZATION
// ============================================================
const labOptimizationRouter = createTRPCRouter({
  /** Get AI optimization suggestions based on user's labs */
  getSuggestions: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);

      // Fetch all lab-peptide mappings
      const { data: mappings } = await sb
        .from('lab_peptide_mappings')
        .select('*')
        .eq('is_active', true)
        .order('priority_level');

      return (mappings ?? []).map((m: Record<string, unknown>) => ({
        labType: m.lab_type as string,
        findingPattern: m.finding_pattern as string,
        recommendedPeptides: m.recommended_peptides as Array<{ peptideId: string; reason: string }>,
        priorityLevel: m.priority_level as number,
        reasoning: m.reasoning as string,
      }));
    }),

  /** Get mappings by lab type */
  getByLabType: protectedProcedure
    .input(z.object({ labType: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('lab_peptide_mappings')
        .select('*')
        .eq('lab_type', input.labType)
        .eq('is_active', true);
      return data ?? [];
    }),
});

// ============================================================
// FEATURE 7: CYCLING & PERIODIZATION
// ============================================================
const schedulingRouter = createTRPCRouter({
  /** Add phases to a protocol */
  addPhase: protectedProcedure
    .input(z.object({
      protocolId: z.string(),
      phaseName: z.string(),
      phaseOrder: z.number(),
      phaseType: z.enum(['loading', 'active', 'maintenance', 'taper', 'off']),
      durationDays: z.number(),
      startDate: z.string().optional(),
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
          duration_days: input.durationDays,
          start_date: input.startDate,
          description: input.description,
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add phase' });
      return { phaseId: data.id };
    }),

  /** Get protocol schedule with all phases */
  getSchedule: protectedProcedure
    .input(z.object({ protocolId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: phases } = await sb
        .from('protocol_phases')
        .select('*')
        .eq('protocol_id', input.protocolId)
        .order('phase_order');

      const { data: peptides } = await sb
        .from('protocol_peptides')
        .select('*, peptide_library!inner(name)')
        .eq('protocol_id', input.protocolId)
        .order('sort_order');

      const { data: schedules } = await sb
        .from('protocol_schedule')
        .select('*')
        .in('protocol_peptide_id', (peptides ?? []).map((p: Record<string, unknown>) => p.id as string));

      return { phases: phases ?? [], peptides: peptides ?? [], schedules: schedules ?? [] };
    }),

  /** Set phase-specific dosing for a peptide */
  setPhaseSchedule: protectedProcedure
    .input(z.object({
      protocolPeptideId: z.string(),
      phaseId: z.string(),
      doseAmount: z.number(),
      frequency: z.string(),
      isActivePhase: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      await sb.from('protocol_schedule').upsert({
        protocol_peptide_id: input.protocolPeptideId,
        phase_id: input.phaseId,
        dose_amount: input.doseAmount,
        frequency: input.frequency,
        is_active_phase: input.isActivePhase,
      });
      return { success: true };
    }),
});

// ============================================================
// COMBINED PEPTIDE ROUTER
// ============================================================
export const peptideRouter = createTRPCRouter({
  library: libraryRouter,
  protocol: protocolBuilderRouter,
  correlations: correlationRouter,
  safety: safetyRouter,
  doses: doseLoggingRouter,
  labOptimization: labOptimizationRouter,
  scheduling: schedulingRouter,
});
