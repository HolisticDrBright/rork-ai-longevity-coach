import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, createTRPCRouter } from "../create-context";
import { createServerSupabaseClient } from "../../supabase-server";

/**
 * Score a single lab value 0-100 based on reference ranges.
 * 100 = within optimal (ref) range, deducted linearly as value deviates.
 */
function scoreLabValue(
  value: number,
  refLow: number | null,
  refHigh: number | null
): number {
  // If no reference range at all, give a neutral 75
  if (refLow == null && refHigh == null) return 75;

  // One-sided ranges
  if (refLow != null && refHigh == null) {
    if (value >= refLow) return 100;
    const deviation = (refLow - value) / refLow;
    return Math.max(0, Math.round(100 - deviation * 200));
  }
  if (refLow == null && refHigh != null) {
    if (value <= refHigh) return 100;
    const deviation = (value - refHigh) / refHigh;
    return Math.max(0, Math.round(100 - deviation * 200));
  }

  // Both bounds present
  const low = refLow!;
  const high = refHigh!;
  if (value >= low && value <= high) return 100;

  const range = high - low;
  if (value < low) {
    const deviation = (low - value) / range;
    return Math.max(0, Math.round(100 - deviation * 100));
  }
  // value > high
  const deviation = (value - high) / range;
  return Math.max(0, Math.round(100 - deviation * 100));
}

/**
 * Score a single biometric value 0-100 based on normal ranges.
 */
function scoreBiometricValue(
  value: number,
  normalLow: number | null,
  normalHigh: number | null
): number {
  if (normalLow == null && normalHigh == null) return 75;

  if (normalLow != null && normalHigh == null) {
    if (value >= normalLow) return 100;
    const deviation = (normalLow - value) / normalLow;
    return Math.max(0, Math.round(100 - deviation * 200));
  }
  if (normalLow == null && normalHigh != null) {
    if (value <= normalHigh) return 100;
    const deviation = (value - normalHigh) / normalHigh;
    return Math.max(0, Math.round(100 - deviation * 200));
  }

  const low = normalLow!;
  const high = normalHigh!;
  if (value >= low && value <= high) return 100;

  const range = high - low;
  if (value < low) {
    const deviation = (low - value) / range;
    return Math.max(0, Math.round(100 - deviation * 100));
  }
  const deviation = (value - high) / range;
  return Math.max(0, Math.round(100 - deviation * 100));
}

export const longevityScoreRouter = createTRPCRouter({
  /**
   * Calculate (or recalculate) the longevity score for a user.
   * Upserts a row per user per day.
   */
  calculate: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // ---- 1. Latest lab results (past 90 days) ----
      const { data: labRows, error: labErr } = await sb
        .from("clinic_lab_results")
        .select(`
          id,
          value,
          ref_range_low,
          ref_range_high,
          lab_test_id,
          clinic_lab_tests (
            ref_range_low,
            ref_range_high
          )
        `)
        .eq("patient_id", input.userId)
        .gte("result_date", ninetyDaysAgo.slice(0, 10))
        .order("result_date", { ascending: false });

      if (labErr) {
        console.error("[longevityScore] lab query error", labErr);
      }

      // ---- 2. Recent biometric readings (past 30 days) ----
      const { data: bioRows, error: bioErr } = await sb
        .from("clinic_biometric_readings")
        .select(`
          id,
          value,
          clinic_biometric_types (
            normal_low,
            normal_high
          )
        `)
        .eq("patient_id", input.userId)
        .gte("reading_time", thirtyDaysAgo)
        .order("reading_time", { ascending: false });

      if (bioErr) {
        console.error("[longevityScore] biometric query error", bioErr);
      }

      // ---- 3. User profile for birth_date ----
      const { data: profile, error: profileErr } = await sb
        .from("profiles")
        .select("birth_date")
        .eq("id", input.userId)
        .single();

      if (profileErr || !profile) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User profile not found",
        });
      }

      // Compute chronological age
      let chronologicalAge: number | null = null;
      if (profile.birth_date) {
        const birth = new Date(profile.birth_date);
        const ageDiffMs = now.getTime() - birth.getTime();
        chronologicalAge = Math.floor(ageDiffMs / (365.25 * 24 * 60 * 60 * 1000));
      }

      // ---- 4. Score each component ----

      // Labs score (0-100)
      let labsScore = 75; // default when no labs
      const labs = labRows ?? [];
      if (labs.length > 0) {
        let totalLabScore = 0;
        for (const lab of labs) {
          const testRef = lab.clinic_lab_tests as any;
          const refLow = lab.ref_range_low ?? testRef?.ref_range_low ?? null;
          const refHigh = lab.ref_range_high ?? testRef?.ref_range_high ?? null;
          totalLabScore += scoreLabValue(Number(lab.value), refLow, refHigh);
        }
        labsScore = Math.round(totalLabScore / labs.length);
      }

      // Biometrics score (0-100)
      let biometricsScore = 75; // default when no biometrics
      const bios = bioRows ?? [];
      if (bios.length > 0) {
        let totalBioScore = 0;
        for (const bio of bios) {
          const typeRef = bio.clinic_biometric_types as any;
          const normalLow = typeRef?.normal_low ?? null;
          const normalHigh = typeRef?.normal_high ?? null;
          totalBioScore += scoreBiometricValue(Number(bio.value), normalLow, normalHigh);
        }
        biometricsScore = Math.round(totalBioScore / bios.length);
      }

      // Lifestyle score – placeholder
      const lifestyleScore = 65;

      // Adherence score – placeholder
      const adherenceScore = 70;

      // ---- 5. Weighted composite ----
      const compositeScore = Math.round(
        labsScore * 0.4 +
        biometricsScore * 0.3 +
        lifestyleScore * 0.2 +
        adherenceScore * 0.1
      );

      // ---- 6. Biological age ----
      let biologicalAge: number | null = null;
      if (chronologicalAge != null) {
        if (compositeScore > 70) {
          biologicalAge = Math.round(chronologicalAge - (compositeScore - 70) * 0.5);
        } else if (compositeScore < 50) {
          biologicalAge = Math.round(chronologicalAge + (50 - compositeScore) * 0.5);
        } else {
          biologicalAge = chronologicalAge;
        }
      }

      const componentScores = {
        labs: labsScore,
        biometrics: biometricsScore,
        lifestyle: lifestyleScore,
        adherence: adherenceScore,
      };

      const calculatedAt = now.toISOString();

      // ---- 7. Upsert into longevity_scores ----
      const { data: upserted, error: upsertErr } = await sb
        .from("longevity_scores")
        .upsert(
          {
            user_id: input.userId,
            score: compositeScore,
            biological_age: biologicalAge,
            chronological_age: chronologicalAge,
            component_scores: componentScores,
            lab_count: labs.length,
            biometric_count: bios.length,
            calculated_at: calculatedAt,
          },
          { onConflict: "user_id,calculated_at::date" }
        )
        .select()
        .single();

      if (upsertErr) {
        // Fallback: try an insert (some Supabase versions don't support expression-based onConflict)
        const { data: inserted, error: insertErr } = await sb
          .from("longevity_scores")
          .insert({
            user_id: input.userId,
            score: compositeScore,
            biological_age: biologicalAge,
            chronological_age: chronologicalAge,
            component_scores: componentScores,
            lab_count: labs.length,
            biometric_count: bios.length,
            calculated_at: calculatedAt,
          })
          .select()
          .single();

        if (insertErr) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to save longevity score",
          });
        }

        return {
          score: compositeScore,
          biologicalAge,
          chronologicalAge,
          components: componentScores,
          calculatedAt,
        };
      }

      return {
        score: compositeScore,
        biologicalAge,
        chronologicalAge,
        components: componentScores,
        calculatedAt,
      };
    }),

  /**
   * Get the current (latest) longevity score for a user, plus trend info.
   */
  getCurrent: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: rows, error } = await sb
        .from("longevity_scores")
        .select("*")
        .eq("user_id", input.userId)
        .order("calculated_at", { ascending: false })
        .limit(2);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch longevity score",
        });
      }

      if (!rows || rows.length === 0) {
        return null;
      }

      const latest = rows[0];
      const previous = rows.length > 1 ? rows[1] : null;

      const previousScore = previous?.score ?? undefined;
      let trend: "improving" | "stable" | "declining" = "stable";
      let trendPercent = 0;

      if (previous) {
        const diff = latest.score - previous.score;
        trendPercent = previous.score !== 0
          ? Math.round((diff / previous.score) * 100)
          : 0;

        if (diff > 2) {
          trend = "improving";
        } else if (diff < -2) {
          trend = "declining";
        }
      }

      const components = latest.component_scores as {
        labs: number;
        biometrics: number;
        lifestyle: number;
        adherence: number;
      };

      return {
        id: latest.id,
        userId: latest.user_id,
        score: latest.score,
        biologicalAge: latest.biological_age,
        chronologicalAge: latest.chronological_age,
        componentScores: components,
        labCount: latest.lab_count,
        biometricCount: latest.biometric_count,
        calculatedAt: latest.calculated_at,
        previousScore,
        trend,
        trendPercent,
      };
    }),

  /**
   * Get score history for a user over the given number of days.
   */
  getHistory: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        days: z.number().min(7).max(365).default(90),
      })
    )
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const since = new Date(
        Date.now() - input.days * 24 * 60 * 60 * 1000
      ).toISOString();

      const { data, error } = await sb
        .from("longevity_scores")
        .select("*")
        .eq("user_id", input.userId)
        .gte("calculated_at", since)
        .order("calculated_at", { ascending: true });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch longevity score history",
        });
      }

      return (data ?? []).map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        score: row.score,
        biologicalAge: row.biological_age,
        chronologicalAge: row.chronological_age,
        componentScores: row.component_scores as {
          labs: number;
          biometrics: number;
          lifestyle: number;
          adherence: number;
        },
        labCount: row.lab_count,
        biometricCount: row.biometric_count,
        calculatedAt: row.calculated_at,
      }));
    }),
});
