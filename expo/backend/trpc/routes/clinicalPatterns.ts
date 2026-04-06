import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../create-context";
import { createServerSupabaseClient } from "../../supabase-server";
import { assertOwnership } from "../ownership";

const AlertStatusSchema = z.enum([
  "new",
  "viewed",
  "acknowledged",
  "shared_with_doctor",
  "resolved",
  "dismissed",
]);

const SeveritySchema = z.enum(["informational", "attention", "urgent"]);

const ConfidenceSchema = z.enum(["low", "moderate", "high"]);

/** Severity ordering for sorting (higher = more urgent) */
const SEVERITY_ORDER: Record<string, number> = {
  urgent: 3,
  attention: 2,
  informational: 1,
};

/**
 * Map pattern rule data_sources entries to biometric type codes
 * used in clinic_biometric_types / clinic_biometric_readings.
 */
const DATA_SOURCE_TO_BIOMETRIC: Record<string, string[]> = {
  spo2: ["oxygen_sat"],
  resting_hr: ["heart_rate"],
  heart_rate_pattern: ["heart_rate"],
  hrv: ["hrv"],
  blood_pressure: ["bp_systolic", "bp_diastolic"],
  blood_glucose: ["glucose"],
  fasting_glucose: ["glucose"],
  weight: ["weight"],
  body_fat: ["body_fat"],
  body_temperature: ["temperature"],
  sleep_duration: ["sleep_hours"],
  sleep_quality: ["sleep_quality"],
  sleep_stages: ["sleep_quality"],
  recovery_score: ["sleep_quality"],
  energy_level: ["sleep_quality"],
  stress_score: ["hrv"],
  workout_intensity: ["steps"],
};

/**
 * Map pattern rule data_sources to lab test codes
 * used in clinic_lab_tests / clinic_lab_results.
 */
const DATA_SOURCE_TO_LAB: Record<string, string[]> = {
  hba1c: ["HBA1C"],
  tsh: ["TSH"],
  hscrp: ["CRP"],
  ferritin: ["FERRITIN"],
  hemoglobin: ["B12"], // closest proxy in seed data
};

interface PatternRule {
  pattern_id: string;
  pattern_name: string;
  category: string;
  data_sources: string[];
  detection_logic: { rules: DetectionRule[] };
  confidence_thresholds: Record<string, { criteria_met: number }>;
  severity: string;
  recommended_action: string;
  recommended_tests: string[] | null;
  medical_disclaimer: string;
  is_active: boolean;
}

interface DetectionRule {
  metric: string;
  operator: string;
  value?: number;
  value_type?: string;
  values?: string[];
  window_days?: number;
  min_occurrences?: number;
  min_readings?: number;
  low?: number;
  high?: number;
  [key: string]: unknown;
}

interface BiometricReading {
  value: number;
  reading_time: string;
  biometric_code: string;
  context: string | null;
}

interface LabResult {
  value: number;
  result_date: string;
  lab_code: string;
}

/**
 * Evaluate a single detection rule against available biometric / lab data.
 * Returns true if the rule condition is met.
 */
function evaluateRule(
  rule: DetectionRule,
  biometrics: BiometricReading[],
  labs: LabResult[],
): boolean {
  const metric = rule.metric;
  const windowDays = rule.window_days ?? 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);
  const cutoffStr = cutoff.toISOString();

  // --- Biometric average checks ---
  if (
    metric.startsWith("spo2") ||
    metric.startsWith("resting_hr") ||
    metric.startsWith("hr_") ||
    metric.startsWith("bp_") ||
    metric.startsWith("sleep_") ||
    metric.startsWith("hrv") ||
    metric.startsWith("recovery") ||
    metric.startsWith("energy") ||
    metric.startsWith("body_temp") ||
    metric.startsWith("glucose") ||
    metric.startsWith("fasting_glucose") ||
    metric.startsWith("stress")
  ) {
    // Determine which biometric codes to look at based on metric name
    let codes: string[] = [];
    if (metric.startsWith("spo2")) codes = ["oxygen_sat"];
    else if (metric.startsWith("resting_hr") || metric.startsWith("hr_"))
      codes = ["heart_rate"];
    else if (metric.startsWith("bp_systolic")) codes = ["bp_systolic"];
    else if (metric.startsWith("bp_diastolic")) codes = ["bp_diastolic"];
    else if (metric.startsWith("bp_")) codes = ["bp_systolic", "bp_diastolic"];
    else if (metric.startsWith("sleep_duration")) codes = ["sleep_hours"];
    else if (metric.startsWith("sleep_quality") || metric.startsWith("recovery") || metric.startsWith("energy"))
      codes = ["sleep_quality"];
    else if (metric.startsWith("hrv") || metric.startsWith("stress"))
      codes = ["hrv"];
    else if (metric.startsWith("body_temp")) codes = ["temperature"];
    else if (metric.startsWith("glucose") || metric.startsWith("fasting_glucose"))
      codes = ["glucose"];

    const relevant = biometrics.filter(
      (b) => codes.includes(b.biometric_code) && b.reading_time >= cutoffStr,
    );

    if (relevant.length === 0) return false;

    const minReadings = rule.min_readings ?? rule.min_occurrences ?? 1;
    const avg =
      relevant.reduce((sum, r) => sum + r.value, 0) / relevant.length;

    // Operators
    if (rule.operator === "<") {
      const threshold = rule.value ?? 0;
      const matchCount = relevant.filter((r) => r.value < threshold).length;
      return matchCount >= minReadings;
    }
    if (rule.operator === ">") {
      const threshold = rule.value ?? 0;
      const matchCount = relevant.filter((r) => r.value > threshold).length;
      return matchCount >= minReadings;
    }
    if (rule.operator === "==") {
      const threshold = rule.value ?? 0;
      return avg === threshold;
    }
    if (rule.operator === "true") {
      // Boolean-style rules: check if average deviates significantly
      // e.g., hrv_erratic, hrv_decline, training_load_increase
      // Simplified: consider met if we have sufficient data points with high variance
      if (relevant.length < 3) return false;
      const mean = avg;
      const variance =
        relevant.reduce((sum, r) => sum + Math.pow(r.value - mean, 2), 0) /
        relevant.length;
      const cv = Math.sqrt(variance) / (mean || 1);
      return cv > 0.3; // coefficient of variation > 30% suggests instability
    }
    if (rule.operator === "outside" && rule.low != null && rule.high != null) {
      return avg < rule.low || avg > rule.high;
    }
  }

  // --- Lab result checks ---
  if (
    metric === "hba1c" ||
    metric === "tsh" ||
    metric === "hscrp" ||
    metric === "ferritin"
  ) {
    let labCodes: string[] = [];
    if (metric === "hba1c") labCodes = ["HBA1C"];
    else if (metric === "tsh") labCodes = ["TSH"];
    else if (metric === "hscrp") labCodes = ["CRP"];
    else if (metric === "ferritin") labCodes = ["FERRITIN"];

    const relevant = labs.filter((l) => labCodes.includes(l.lab_code));
    if (relevant.length === 0) return false;

    // Use most recent result
    const latest = relevant.sort(
      (a, b) =>
        new Date(b.result_date).getTime() - new Date(a.result_date).getTime(),
    )[0];

    if (rule.operator === ">" && rule.value != null) {
      return latest.value > rule.value;
    }
    if (rule.operator === "<" && rule.value != null) {
      return latest.value < rule.value;
    }
    if (rule.operator === "outside" && rule.low != null && rule.high != null) {
      return latest.value < rule.low || latest.value > rule.high;
    }
  }

  // --- Symptom correlation (simplified: always false without symptom tracking) ---
  if (rule.operator === "any" && rule.values) {
    return false;
  }

  return false;
}

/**
 * Determine confidence level based on how many criteria were met.
 */
function determineConfidence(
  criteriaMet: number,
  thresholds: Record<string, { criteria_met: number }>,
): string | null {
  if (thresholds.high && criteriaMet >= thresholds.high.criteria_met) {
    return "high";
  }
  if (thresholds.moderate && criteriaMet >= thresholds.moderate.criteria_met) {
    return "moderate";
  }
  if (thresholds.low && criteriaMet >= thresholds.low.criteria_met) {
    return "low";
  }
  return null;
}

export const clinicalPatternsRouter = createTRPCRouter({
  /**
   * Get all active clinical pattern rules.
   */
  getPatternRules: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);

    const { data, error } = await sb
      .from("clinical_pattern_rules")
      .select("*")
      .eq("is_active", true)
      .order("category");

    if (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch pattern rules",
      });
    }

    return data;
  }),

  /**
   * Run the clinical pattern detection engine for a user.
   * Queries biometric readings and lab results from the last 30 days,
   * evaluates each active pattern rule, and inserts newly detected patterns.
   */
  runDetection: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);

      // 1. Fetch all active pattern rules
      const { data: rules, error: rulesError } = await sb
        .from("clinical_pattern_rules")
        .select("*")
        .eq("is_active", true);

      if (rulesError || !rules) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch pattern rules",
        });
      }

      // 2. Fetch biometric readings for the last 30 days
      //    Join with biometric types to get the code
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: rawBiometrics } = await sb
        .from("clinic_biometric_readings")
        .select(
          "value, reading_time, unit, context, biometric_type_id, clinic_biometric_types(code)",
        )
        .gte("reading_time", thirtyDaysAgo.toISOString())
        .order("reading_time", { ascending: false });

      const biometrics: BiometricReading[] = (rawBiometrics ?? []).map(
        (r: any) => ({
          value: r.value,
          reading_time: r.reading_time,
          biometric_code: r.clinic_biometric_types?.code ?? "",
          context: r.context,
        }),
      );

      // 3. Fetch lab results (all time, but we focus on most recent)
      const { data: rawLabs } = await sb
        .from("clinic_lab_results")
        .select("value, result_date, lab_test_id, clinic_lab_tests(code)")
        .order("result_date", { ascending: false });

      const labs: LabResult[] = (rawLabs ?? []).map((r: any) => ({
        value: r.value,
        result_date: r.result_date,
        lab_code: r.clinic_lab_tests?.code ?? "",
      }));

      // 4. Check for existing detections in the last 30 days (dedup)
      const { data: recentDetections } = await sb
        .from("detected_clinical_patterns")
        .select("pattern_id, detected_at")
        .eq("user_id", input.userId)
        .gte("detected_at", thirtyDaysAgo.toISOString());

      const recentPatternIds = new Set(
        (recentDetections ?? []).map((d: any) => d.pattern_id),
      );

      // 5. Evaluate each rule
      const newDetections: Array<{
        user_id: string;
        pattern_id: string;
        confidence: string;
        severity: string;
        evidence: Record<string, unknown>;
        triggered_values: Record<string, unknown>;
      }> = [];

      for (const rule of rules as PatternRule[]) {
        // Skip if already detected in last 30 days
        if (recentPatternIds.has(rule.pattern_id)) {
          continue;
        }

        const logic = rule.detection_logic as { rules: DetectionRule[] };
        if (!logic.rules || !Array.isArray(logic.rules)) continue;

        // Check which data sources the user has data for
        const relevantBiometricCodes = new Set<string>();
        for (const src of rule.data_sources) {
          const mapped = DATA_SOURCE_TO_BIOMETRIC[src];
          if (mapped) mapped.forEach((c) => relevantBiometricCodes.add(c));
        }

        const relevantLabCodes = new Set<string>();
        for (const src of rule.data_sources) {
          const mapped = DATA_SOURCE_TO_LAB[src];
          if (mapped) mapped.forEach((c) => relevantLabCodes.add(c));
        }

        const hasBiometricData = biometrics.some((b) =>
          relevantBiometricCodes.has(b.biometric_code),
        );
        const hasLabData = labs.some((l) => relevantLabCodes.has(l.lab_code));

        // Skip if user has no relevant data at all
        if (!hasBiometricData && !hasLabData) continue;

        // Evaluate each sub-rule
        let criteriaMet = 0;
        const triggeredValues: Record<string, unknown> = {};
        const evidence: Record<string, unknown> = {};

        for (const subRule of logic.rules) {
          const passed = evaluateRule(subRule, biometrics, labs);
          if (passed) {
            criteriaMet++;
            triggeredValues[subRule.metric] = {
              operator: subRule.operator,
              threshold: subRule.value ?? subRule.values ?? null,
            };
          }
        }

        // Determine confidence
        const confidence = determineConfidence(
          criteriaMet,
          rule.confidence_thresholds as Record<
            string,
            { criteria_met: number }
          >,
        );

        if (confidence) {
          evidence.criteria_evaluated = logic.rules.length;
          evidence.criteria_met = criteriaMet;
          evidence.data_sources_available = {
            biometric: hasBiometricData,
            lab: hasLabData,
          };
          evidence.biometric_readings_count = biometrics.filter((b) =>
            relevantBiometricCodes.has(b.biometric_code),
          ).length;

          newDetections.push({
            user_id: input.userId,
            pattern_id: rule.pattern_id,
            confidence,
            severity: rule.severity,
            evidence,
            triggered_values: triggeredValues,
          });
        }
      }

      // 6. Insert new detections
      if (newDetections.length > 0) {
        const { error: insertError } = await sb
          .from("detected_clinical_patterns")
          .insert(newDetections);

        if (insertError) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to save detected patterns",
          });
        }
      }

      return {
        detected: newDetections.length,
        patterns: newDetections.map((d) => ({
          patternId: d.pattern_id,
          confidence: d.confidence,
          severity: d.severity,
          criteriaMet: d.evidence.criteria_met,
        })),
      };
    }),

  /**
   * Get alerts (detected patterns) for a user.
   * Sorted by severity (urgent first), then by detection date (newest first).
   */
  getAlerts: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        status: AlertStatusSchema.optional(),
        severity: SeveritySchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);

      let query = sb
        .from("detected_clinical_patterns")
        .select(
          "*, clinical_pattern_rules!detected_clinical_patterns_pattern_id_fkey(pattern_name, category, recommended_action, recommended_tests, medical_disclaimer)",
        )
        .eq("user_id", input.userId)
        .order("detected_at", { ascending: false });

      if (input.status) {
        query = query.eq("status", input.status);
      }
      if (input.severity) {
        query = query.eq("severity", input.severity);
      }

      const { data, error } = await query;

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch alerts",
        });
      }

      // Sort by severity (urgent first), then by date
      const sorted = (data ?? []).sort((a: any, b: any) => {
        const severityDiff =
          (SEVERITY_ORDER[b.severity] ?? 0) -
          (SEVERITY_ORDER[a.severity] ?? 0);
        if (severityDiff !== 0) return severityDiff;
        return (
          new Date(b.detected_at).getTime() -
          new Date(a.detected_at).getTime()
        );
      });

      return sorted;
    }),

  /**
   * Get full detail for a single alert, including rule info and evidence.
   */
  getAlertDetail: protectedProcedure
    .input(z.object({ alertId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from("detected_clinical_patterns")
        .select(
          "*, clinical_pattern_rules!detected_clinical_patterns_pattern_id_fkey(*)",
        )
        .eq("id", input.alertId)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert not found",
        });
      }

      // Mark as viewed if it was new
      if (data.status === "new") {
        await sb
          .from("detected_clinical_patterns")
          .update({ status: "viewed", viewed_at: new Date().toISOString() })
          .eq("id", input.alertId);
      }

      return data;
    }),

  /**
   * Update the status of an alert (e.g., acknowledged, shared_with_doctor, resolved).
   */
  updateAlertStatus: protectedProcedure
    .input(
      z.object({
        alertId: z.string(),
        status: AlertStatusSchema,
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const updates: Record<string, unknown> = {
        status: input.status,
      };

      if (input.notes) {
        updates.user_notes = input.notes;
      }

      if (input.status === "viewed") {
        updates.viewed_at = new Date().toISOString();
      }

      if (input.status === "resolved") {
        updates.resolved_at = new Date().toISOString();
      }

      const { data, error } = await sb
        .from("detected_clinical_patterns")
        .update(updates)
        .eq("id", input.alertId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update alert status",
        });
      }

      return data;
    }),

  /**
   * Dismiss an alert with an optional reason.
   */
  dismissAlert: protectedProcedure
    .input(
      z.object({
        alertId: z.string(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const updates: Record<string, unknown> = {
        status: "dismissed",
      };

      if (input.reason) {
        updates.user_notes = input.reason;
      }

      const { data, error } = await sb
        .from("detected_clinical_patterns")
        .update(updates)
        .eq("id", input.alertId)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to dismiss alert",
        });
      }

      return data;
    }),
});
