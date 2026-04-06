import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, createTRPCRouter } from "../create-context";
import { createServerSupabaseClient } from "../../supabase-server";

/**
 * Daily Health Score Router
 *
 * Calculates a composite daily wellness score (0-100) from:
 * - Sleep quality (25%)
 * - Recovery/HRV (20%)
 * - Nutrition compliance (15%)
 * - Supplement adherence (15%)
 * - Activity (15%)
 * - Symptom burden (10%)
 */

interface ComponentScores {
  sleep: number;
  recovery: number;
  nutrition: number;
  supplements: number;
  activity: number;
  symptoms: number;
}

const WEIGHTS: Record<keyof ComponentScores, number> = {
  sleep: 0.25,
  recovery: 0.20,
  nutrition: 0.15,
  supplements: 0.15,
  activity: 0.15,
  symptoms: 0.10,
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export const healthScoreRouter = createTRPCRouter({
  /**
   * Calculate today's health score from available data
   */
  calculate: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        date: z.string().optional(), // ISO date string, defaults to today
      })
    )
    .mutation(async ({ ctx, input }) => {
      console.log('[HealthScore] Calculating daily score');
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const targetDate = input.date ?? new Date().toISOString().split('T')[0];
      const dayStart = `${targetDate}T00:00:00Z`;
      const dayEnd = `${targetDate}T23:59:59Z`;

      const components: ComponentScores = {
        sleep: 50,
        recovery: 50,
        nutrition: 50,
        supplements: 50,
        activity: 50,
        symptoms: 75,
      };
      let componentCount = 0;

      // 1. Sleep score — from sleep_hours and sleep_quality biometric readings
      const { data: sleepReadings } = await sb
        .from('clinic_biometric_readings')
        .select('value, biometric_type_id')
        .eq('patient_id', input.userId)
        .gte('reading_time', dayStart)
        .lte('reading_time', dayEnd);

      // Get biometric type codes for categorization
      const { data: bioTypes } = await sb
        .from('clinic_biometric_types')
        .select('id, code');

      const typeCodeMap = new Map<string, string>();
      (bioTypes ?? []).forEach((t: Record<string, unknown>) => {
        typeCodeMap.set(t.id as string, t.code as string);
      });

      if (sleepReadings && sleepReadings.length > 0) {
        const categorized = sleepReadings.reduce(
          (acc: Record<string, number[]>, r: Record<string, unknown>) => {
            const code = typeCodeMap.get(r.biometric_type_id as string) ?? 'unknown';
            if (!acc[code]) acc[code] = [];
            acc[code].push(r.value as number);
            return acc;
          },
          {}
        );

        // Sleep score
        if (categorized.sleep_hours) {
          const avgHours = categorized.sleep_hours.reduce((a, b) => a + b, 0) / categorized.sleep_hours.length;
          // Optimal: 7-9 hours. Score drops below 7 and above 10.
          if (avgHours >= 7 && avgHours <= 9) {
            components.sleep = 90 + (avgHours >= 7.5 && avgHours <= 8.5 ? 10 : 0);
          } else if (avgHours >= 6) {
            components.sleep = 60 + (avgHours - 6) * 30;
          } else {
            components.sleep = clamp(avgHours / 6 * 60);
          }
          componentCount++;
        }
        if (categorized.sleep_quality) {
          const avgQuality = categorized.sleep_quality.reduce((a, b) => a + b, 0) / categorized.sleep_quality.length;
          components.sleep = clamp((components.sleep + avgQuality) / 2);
          componentCount++;
        }

        // Recovery score from HRV and heart rate
        if (categorized.hrv) {
          const avgHrv = categorized.hrv.reduce((a, b) => a + b, 0) / categorized.hrv.length;
          // Higher HRV is better. Normalize: 20ms=30, 40ms=60, 60ms=80, 80ms+=95
          components.recovery = clamp(30 + (avgHrv - 20) * 1.1);
          componentCount++;
        }
        if (categorized.heart_rate) {
          const avgHr = categorized.heart_rate.reduce((a, b) => a + b, 0) / categorized.heart_rate.length;
          // Lower resting HR is better. 50=95, 60=85, 70=70, 80=55, 90+=40
          const hrScore = clamp(120 - avgHr * 0.8);
          components.recovery = clamp((components.recovery + hrScore) / 2);
          componentCount++;
        }

        // Activity score from steps
        if (categorized.steps) {
          const totalSteps = categorized.steps.reduce((a, b) => a + b, 0);
          const stepGoal = 10000;
          components.activity = clamp((totalSteps / stepGoal) * 100);
          componentCount++;
        }
      }

      // 2. Symptom burden — inverse of reported symptoms (if any)
      // Lower symptom load = higher score
      // For now use a simplified approach: no symptoms today = 90, each symptom reduces
      const { data: symptoms } = await sb
        .from('clinic_alert_events')
        .select('severity')
        .eq('patient_id', input.userId)
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd);

      if (symptoms && symptoms.length > 0) {
        const severityDeductions: Record<string, number> = {
          critical: 20,
          high: 15,
          medium: 10,
          low: 5,
          info: 2,
        };
        let totalDeduction = 0;
        symptoms.forEach((s: Record<string, unknown>) => {
          totalDeduction += severityDeductions[s.severity as string] ?? 5;
        });
        components.symptoms = clamp(90 - totalDeduction);
        componentCount++;
      }

      // 3. Compute weighted score
      const score = clamp(
        components.sleep * WEIGHTS.sleep +
        components.recovery * WEIGHTS.recovery +
        components.nutrition * WEIGHTS.nutrition +
        components.supplements * WEIGHTS.supplements +
        components.activity * WEIGHTS.activity +
        components.symptoms * WEIGHTS.symptoms
      );

      // 4. Upsert into daily_health_scores
      const { data, error } = await sb
        .from('daily_health_scores')
        .upsert(
          {
            user_id: input.userId,
            date: targetDate,
            score,
            components,
            component_count: componentCount,
          },
          { onConflict: 'user_id,date' }
        )
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to save health score',
        });
      }

      return {
        score,
        date: targetDate,
        components,
        componentCount,
        calculatedAt: new Date().toISOString(),
      };
    }),

  /**
   * Get today's health score with trend
   */
  getToday: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const today = new Date().toISOString().split('T')[0];

      const { data: todayScore } = await sb
        .from('daily_health_scores')
        .select('*')
        .eq('user_id', input.userId)
        .eq('date', today)
        .single();

      // Get yesterday's score for trend
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const { data: yesterdayScore } = await sb
        .from('daily_health_scores')
        .select('score')
        .eq('user_id', input.userId)
        .eq('date', yesterday)
        .single();

      if (!todayScore) {
        return null;
      }

      const previousScore = (yesterdayScore?.score as number) ?? null;
      const scoreDiff = previousScore != null ? (todayScore.score as number) - previousScore : 0;
      const trend =
        scoreDiff > 3 ? 'improving' as const :
        scoreDiff < -3 ? 'declining' as const :
        'stable' as const;

      return {
        id: todayScore.id as string,
        score: todayScore.score as number,
        date: todayScore.date as string,
        components: todayScore.components as Record<string, number>,
        componentCount: todayScore.component_count as number,
        previousScore,
        trend,
        trendDiff: scoreDiff,
        calculatedAt: todayScore.calculated_at as string,
      };
    }),

  /**
   * Get historical health scores
   */
  getHistory: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        days: z.number().min(7).max(365).default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - input.days);

      const { data, error } = await sb
        .from('daily_health_scores')
        .select('*')
        .eq('user_id', input.userId)
        .gte('date', cutoff.toISOString().split('T')[0])
        .order('date', { ascending: true });

      if (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch health score history',
        });
      }

      const scores = (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        score: row.score as number,
        date: row.date as string,
        components: row.components as Record<string, number>,
        componentCount: row.component_count as number,
      }));

      // Compute stats
      const values = scores.map((s) => s.score);
      const avg = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
      const best = values.length > 0 ? Math.max(...values) : 0;
      const worst = values.length > 0 ? Math.min(...values) : 0;

      // Trend: compare first half avg to second half avg
      let trend: 'improving' | 'stable' | 'declining' = 'stable';
      if (values.length >= 6) {
        const mid = Math.floor(values.length / 2);
        const firstHalf = values.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
        const secondHalf = values.slice(mid).reduce((a, b) => a + b, 0) / (values.length - mid);
        if (secondHalf - firstHalf > 3) trend = 'improving';
        else if (firstHalf - secondHalf > 3) trend = 'declining';
      }

      return {
        scores,
        stats: { average: avg, best, worst, trend, totalDays: values.length },
      };
    }),

  /**
   * Get a specific component's history
   */
  getComponentHistory: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        component: z.enum(['sleep', 'recovery', 'nutrition', 'supplements', 'activity', 'symptoms']),
        days: z.number().min(7).max(365).default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - input.days);

      const { data } = await sb
        .from('daily_health_scores')
        .select('date, components')
        .eq('user_id', input.userId)
        .gte('date', cutoff.toISOString().split('T')[0])
        .order('date', { ascending: true });

      const values = (data ?? []).map((row: Record<string, unknown>) => ({
        date: row.date as string,
        value: ((row.components as Record<string, number>)?.[input.component]) ?? 0,
      }));

      const nums = values.map((v) => v.value);
      const avg = nums.length > 0 ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;

      return {
        component: input.component,
        values,
        average: avg,
        min: nums.length > 0 ? Math.min(...nums) : 0,
        max: nums.length > 0 ? Math.max(...nums) : 0,
      };
    }),
});
