import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, createTRPCRouter } from "../create-context";
import { createServerSupabaseClient } from "../../supabase-server";
import { assertOwnership } from "../ownership";

const REPORT_TYPE = z.enum(["comprehensive", "alert_specific", "lab_summary", "custom"]);

const SHARED_VIA = z.enum(["email", "download", "in_app_message", "print"]);

const ALL_SECTIONS = [
  "demographics",
  "longevity_score",
  "labs",
  "biometrics",
  "supplements",
  "symptoms",
  "detected_patterns",
  "recommendations",
] as const;

const ALERT_SECTIONS = [
  "demographics",
  "alert_details",
  "relevant_labs",
  "relevant_biometrics",
  "recommendations",
] as const;

const LAB_SUMMARY_SECTIONS = ["demographics", "all_labs"] as const;

function getSectionsForType(
  reportType: z.infer<typeof REPORT_TYPE>,
  customSections?: string[]
): string[] {
  switch (reportType) {
    case "comprehensive":
      return [...ALL_SECTIONS];
    case "alert_specific":
      return [...ALERT_SECTIONS];
    case "lab_summary":
      return [...LAB_SUMMARY_SECTIONS];
    case "custom":
      return customSections && customSections.length > 0
        ? customSections
        : [...ALL_SECTIONS];
  }
}

function computeAge(birthDate: string): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const now = new Date();
  const diffMs = now.getTime() - birth.getTime();
  return Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000));
}

export const doctorReportRouter = createTRPCRouter({
  /**
   * Generate a doctor report. Builds a structured JSON report_data
   * from the user's health data, then inserts it into doctor_reports.
   */
  generate: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        reportType: REPORT_TYPE,
        alertId: z.string().optional(),
        dateRangeStart: z.string().optional(),
        dateRangeEnd: z.string().optional(),
        sections: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const sections = getSectionsForType(input.reportType, input.sections);

      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const reportData: Record<string, unknown> = {};

      // ---- Demographics ----
      if (
        sections.includes("demographics") ||
        sections.includes("alert_details")
      ) {
        const { data: profile, error } = await sb
          .from("profiles")
          .select("full_name, first_name, last_name, sex, birth_date, height, weight")
          .eq("id", input.userId)
          .single();

        if (error || !profile) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "User profile not found",
          });
        }

        const age = computeAge(profile.birth_date);
        reportData.demographics = {
          name: profile.full_name || `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || "Unknown",
          age,
          sex: profile.sex,
          height: profile.height,
          weight: profile.weight,
        };
      }

      // ---- Longevity Score ----
      if (sections.includes("longevity_score")) {
        const { data: score } = await sb
          .from("longevity_scores")
          .select("*")
          .eq("user_id", input.userId)
          .order("calculated_at", { ascending: false })
          .limit(1)
          .single();

        reportData.longevity_score = score
          ? {
              score: score.score,
              biological_age: score.biological_age,
              chronological_age: score.chronological_age,
              component_scores: score.component_scores,
              lab_count: score.lab_count,
              biometric_count: score.biometric_count,
              calculated_at: score.calculated_at,
            }
          : null;
      }

      // ---- Labs ----
      if (
        sections.includes("labs") ||
        sections.includes("all_labs") ||
        sections.includes("relevant_labs")
      ) {
        const dateFilter = input.dateRangeStart
          ? input.dateRangeStart
          : ninetyDaysAgo.toISOString().slice(0, 10);

        let labQuery = sb
          .from("clinic_lab_results")
          .select(`
            id,
            value,
            value_text,
            unit,
            ref_range_low,
            ref_range_high,
            status,
            result_date,
            clinic_lab_tests (
              name,
              code,
              category,
              unit,
              ref_range_low,
              ref_range_high
            )
          `)
          .eq("patient_id", input.userId)
          .gte("result_date", dateFilter)
          .order("result_date", { ascending: false });

        if (input.dateRangeEnd) {
          labQuery = labQuery.lte("result_date", input.dateRangeEnd);
        }

        const { data: labRows } = await labQuery;

        reportData.labs = (labRows ?? []).map((row: any) => {
          const test = row.clinic_lab_tests as any;
          return {
            id: row.id,
            test_name: test?.name ?? "Unknown",
            test_code: test?.code ?? null,
            category: test?.category ?? null,
            value: row.value,
            value_text: row.value_text,
            unit: row.unit || test?.unit,
            ref_range_low: row.ref_range_low ?? test?.ref_range_low,
            ref_range_high: row.ref_range_high ?? test?.ref_range_high,
            status: row.status,
            result_date: row.result_date,
          };
        });
      }

      // ---- Biometrics ----
      if (
        sections.includes("biometrics") ||
        sections.includes("relevant_biometrics")
      ) {
        const bioSince = input.dateRangeStart
          ? input.dateRangeStart
          : thirtyDaysAgo.toISOString();

        let bioQuery = sb
          .from("clinic_biometric_readings")
          .select(`
            id,
            value,
            unit,
            reading_time,
            context,
            status,
            clinic_biometric_types (
              name,
              code,
              category,
              unit,
              normal_low,
              normal_high
            )
          `)
          .eq("patient_id", input.userId)
          .gte("reading_time", bioSince)
          .order("reading_time", { ascending: false });

        if (input.dateRangeEnd) {
          bioQuery = bioQuery.lte("reading_time", input.dateRangeEnd);
        }

        const { data: bioRows } = await bioQuery;

        reportData.biometrics = (bioRows ?? []).map((row: any) => {
          const btype = row.clinic_biometric_types as any;
          return {
            id: row.id,
            type_name: btype?.name ?? "Unknown",
            type_code: btype?.code ?? null,
            category: btype?.category ?? null,
            value: row.value,
            unit: row.unit || btype?.unit,
            normal_low: btype?.normal_low,
            normal_high: btype?.normal_high,
            status: row.status,
            reading_time: row.reading_time,
            context: row.context,
          };
        });
      }

      // ---- Supplements ----
      if (sections.includes("supplements")) {
        const { data: supplements } = await sb
          .from("supplement_recommendations")
          .select("id, name, category, dosage, form, timing, priority, status")
          .eq("user_id", input.userId)
          .eq("status", "active");

        reportData.supplements = supplements ?? [];
      }

      // ---- Detected Patterns ----
      if (
        sections.includes("detected_patterns") ||
        sections.includes("alert_details")
      ) {
        let patternQuery = sb
          .from("detected_clinical_patterns")
          .select(`
            id,
            pattern_id,
            confidence,
            severity,
            evidence,
            triggered_values,
            status,
            detected_at,
            clinical_pattern_rules (
              pattern_name,
              category,
              recommended_action,
              recommended_tests,
              medical_disclaimer
            )
          `)
          .eq("user_id", input.userId)
          .order("detected_at", { ascending: false });

        // For alert-specific reports, filter to the specific alert
        if (input.reportType === "alert_specific" && input.alertId) {
          patternQuery = patternQuery.eq("id", input.alertId);
        }

        const { data: patterns } = await patternQuery;

        reportData.detected_patterns = (patterns ?? []).map((row: any) => {
          const rule = row.clinical_pattern_rules as any;
          return {
            id: row.id,
            pattern_id: row.pattern_id,
            pattern_name: rule?.pattern_name ?? row.pattern_id,
            category: rule?.category ?? null,
            confidence: row.confidence,
            severity: row.severity,
            evidence: row.evidence,
            triggered_values: row.triggered_values,
            status: row.status,
            detected_at: row.detected_at,
            recommended_action: rule?.recommended_action ?? null,
            recommended_tests: rule?.recommended_tests ?? [],
            medical_disclaimer: rule?.medical_disclaimer ?? null,
          };
        });
      }

      // ---- Recommendations ----
      if (sections.includes("recommendations")) {
        // Aggregate recommendations from detected patterns
        const patterns = (reportData.detected_patterns as any[]) ?? [];
        const recommendations: string[] = [];
        const recommendedTests: string[] = [];

        for (const p of patterns) {
          if (p.recommended_action) {
            recommendations.push(p.recommended_action);
          }
          if (p.recommended_tests) {
            for (const t of p.recommended_tests) {
              if (!recommendedTests.includes(t)) {
                recommendedTests.push(t);
              }
            }
          }
        }

        reportData.recommendations = {
          actions: recommendations,
          suggested_tests: recommendedTests,
        };
      }

      // ---- Build title ----
      const titleMap: Record<string, string> = {
        comprehensive: "Comprehensive Health Report",
        alert_specific: "Health Alert Report",
        lab_summary: "Lab Summary Report",
        custom: "Custom Health Report",
      };
      const title = titleMap[input.reportType] ?? "Health Report";

      // ---- Insert into doctor_reports ----
      const { data: inserted, error: insertErr } = await sb
        .from("doctor_reports")
        .insert({
          user_id: input.userId,
          report_type: input.reportType,
          alert_id: input.alertId ?? null,
          title,
          date_range_start: input.dateRangeStart ?? null,
          date_range_end: input.dateRangeEnd ?? null,
          sections_included: sections,
          report_data: reportData,
          status: "generated",
          generated_at: now.toISOString(),
        })
        .select("id, status, title, generated_at")
        .single();

      if (insertErr || !inserted) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to save doctor report",
        });
      }

      return {
        reportId: inserted.id,
        status: inserted.status,
        title: inserted.title,
        generatedAt: inserted.generated_at,
      };
    }),

  /**
   * Get a single report with full report_data.
   */
  getReport: protectedProcedure
    .input(z.object({ reportId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from("doctor_reports")
        .select("*")
        .eq("id", input.reportId)
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Report not found",
        });
      }

      return {
        id: data.id,
        userId: data.user_id,
        reportType: data.report_type,
        alertId: data.alert_id,
        title: data.title,
        dateRangeStart: data.date_range_start,
        dateRangeEnd: data.date_range_end,
        sectionsIncluded: data.sections_included,
        reportData: data.report_data,
        emailedTo: data.emailed_to,
        emailedAt: data.emailed_at,
        sharedVia: data.shared_via,
        status: data.status,
        generatedAt: data.generated_at,
        createdAt: data.created_at,
      };
    }),

  /**
   * List reports for a user (without full report_data).
   */
  list: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      assertOwnership(ctx.user.id, input.userId);
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from("doctor_reports")
        .select(
          "id, user_id, report_type, alert_id, title, date_range_start, date_range_end, sections_included, emailed_to, emailed_at, shared_via, status, generated_at, created_at"
        )
        .eq("user_id", input.userId)
        .order("generated_at", { ascending: false });

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch reports",
        });
      }

      return (data ?? []).map((row: any) => ({
        id: row.id,
        userId: row.user_id,
        reportType: row.report_type,
        alertId: row.alert_id,
        title: row.title,
        dateRangeStart: row.date_range_start,
        dateRangeEnd: row.date_range_end,
        sectionsIncluded: row.sections_included,
        emailedTo: row.emailed_to,
        emailedAt: row.emailed_at,
        sharedVia: row.shared_via,
        status: row.status,
        generatedAt: row.generated_at,
        createdAt: row.created_at,
      }));
    }),

  /**
   * Mark a report as sent (via email, download, etc.).
   */
  markAsSent: protectedProcedure
    .input(
      z.object({
        reportId: z.string(),
        sentTo: z.string().email(),
        sharedVia: SHARED_VIA,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from("doctor_reports")
        .update({
          emailed_to: input.sentTo,
          emailed_at: new Date().toISOString(),
          shared_via: input.sharedVia,
          status: "sent",
        })
        .eq("id", input.reportId)
        .select("id, status, emailed_to, emailed_at, shared_via")
        .single();

      if (error || !data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Report not found or update failed",
        });
      }

      return {
        reportId: data.id,
        status: data.status,
        emailedTo: data.emailed_to,
        emailedAt: data.emailed_at,
        sharedVia: data.shared_via,
      };
    }),

  /**
   * Delete a report.
   */
  deleteReport: protectedProcedure
    .input(z.object({ reportId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { error } = await sb
        .from("doctor_reports")
        .delete()
        .eq("id", input.reportId);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete report",
        });
      }

      return { success: true };
    }),
});
