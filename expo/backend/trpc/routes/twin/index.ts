import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../../create-context";
import { createServerSupabaseClient } from "../../../supabase-server";
import { resolveSubjectUserId, safeRows } from "../../../services/reasoning/access";
import {
  assessDataQuality,
  detectBiometricChanges,
  detectLabChanges,
  type LabMarkerPoint,
} from "../../../services/reasoning/changeDetection";
import {
  computeCurrentState,
  computeSystemsModel,
} from "../../../services/reasoning/healthTwin";
import { mapRowToEvidence, mapRowToHypothesis } from "../../../services/reasoning/rowMappers";

export const twinRouter = createTRPCRouter({
  /**
   * Adaptive Health Twin — Layer 1 (current state) + Layer 2 (systems model),
   * computed live from the record; trends come from the previous snapshot's
   * systems_state. Layer 3 (response model) arrives with the N-of-1 Lab
   * (Phase 4) and is reported honestly as unavailable until then.
   */
  get: protectedProcedure
    .input(z.object({ patientId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const userId = await resolveSubjectUserId(sb, ctx, input.patientId, "twin.read");

      const [
        profileRows,
        goalRows,
        contraRows,
        biometricRows,
        baselineRows,
        labRows,
        symptomRows,
        supplementRows,
        protocolRows,
        flagRows,
        hypothesisRows,
        snapshotRows,
      ] = await Promise.all([
        safeRows(sb.from("profiles").select("goals").eq("id", userId).limit(1), "profiles"),
        safeRows(sb.from("health_goals").select("primary_goal").eq("user_id", userId).limit(5), "health_goals"),
        safeRows(sb.from("contraindications").select("medications").eq("user_id", userId).limit(1), "contraindications"),
        safeRows(sb.from("daily_biometric_records").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(7), "daily_biometric_records"),
        safeRows(sb.from("daily_baselines").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(1), "daily_baselines"),
        safeRows(sb.from("lab_markers").select("*").eq("user_id", userId).order("collected_at", { ascending: false }).limit(200), "lab_markers"),
        safeRows(sb.from("symptom_logs").select("*").eq("user_id", userId).gte("logged_at", new Date(Date.now() - 14 * 86400000).toISOString()).order("logged_at", { ascending: false }).limit(60), "symptom_logs"),
        safeRows(sb.from("supplement_logs").select("supplement_name, logged_at").eq("user_id", userId).gte("logged_at", new Date(Date.now() - 30 * 86400000).toISOString()).order("logged_at", { ascending: false }).limit(200), "supplement_logs"),
        safeRows(sb.from("protocols").select("supplements_json, status").eq("user_id", userId).eq("status", "active").limit(3), "protocols"),
        safeRows(sb.from("practitioner_flags").select("*").eq("user_id", userId).eq("resolved", false).order("created_at", { ascending: false }).limit(10), "practitioner_flags"),
        safeRows(sb.from("clinical_hypotheses").select("*").eq("user_id", userId).neq("status", "archived"), "clinical_hypotheses"),
        safeRows(sb.from("reasoning_snapshots").select("systems_state, snapshot_number, created_at").eq("user_id", userId).order("snapshot_number", { ascending: false }).limit(1), "reasoning_snapshots"),
      ]);

      // Changes computed over the same windows the pipeline uses.
      const biometricDays = biometricRows.map((r) => ({ ...r, date: String(r.date ?? "") })).reverse();
      const biometricChanges = detectBiometricChanges(biometricDays, baselineRows[0] ?? null);
      const labPoints: LabMarkerPoint[] = labRows
        .map((r) => ({
          markerName: String(r.marker_name ?? ""),
          value: Number(r.marker_value ?? NaN),
          unit: typeof r.unit === "string" ? r.unit : undefined,
          referenceLow: typeof r.reference_range_low === "number" ? r.reference_range_low : null,
          referenceHigh: typeof r.reference_range_high === "number" ? r.reference_range_high : null,
          collectedAt: String(r.collected_at ?? ""),
        }))
        .filter((p) => Number.isFinite(p.value) && p.markerName && p.collectedAt);
      const changes = [...biometricChanges, ...detectLabChanges(labPoints)];

      // Hypotheses with evidence for system review states.
      const hypotheses = hypothesisRows.map(mapRowToHypothesis);
      if (hypotheses.length > 0) {
        const evidenceRows = await safeRows(
          sb.from("evidence_items").select("*").eq("user_id", userId).in("hypothesis_id", hypotheses.map((h) => h.id)),
          "evidence"
        );
        const evidence = evidenceRows.map(mapRowToEvidence);
        for (const h of hypotheses) {
          h.supportingEvidence = evidence.filter((e) => e.hypothesisId === h.id && e.direction === "supports");
          h.contradictingEvidence = evidence.filter((e) => e.hypothesisId === h.id && e.direction === "contradicts");
        }
      }

      const goals = new Set<string>();
      const profileGoals = profileRows[0]?.goals;
      if (Array.isArray(profileGoals)) profileGoals.forEach((g) => typeof g === "string" && goals.add(g));
      for (const r of goalRows) {
        if (typeof r.primary_goal === "string" && r.primary_goal) goals.add(r.primary_goal);
      }

      const medications = Array.isArray(contraRows[0]?.medications)
        ? (contraRows[0]!.medications as string[]).filter((m) => typeof m === "string")
        : [];

      const supplementNames = new Set<string>();
      for (const r of supplementRows) {
        if (typeof r.supplement_name === "string") supplementNames.add(r.supplement_name);
      }
      for (const p of protocolRows) {
        const supps = Array.isArray(p.supplements_json) ? (p.supplements_json as { name?: unknown }[]) : [];
        for (const s of supps) {
          if (typeof s?.name === "string") supplementNames.add(s.name);
        }
      }

      const previousSystems = Array.isArray(snapshotRows[0]?.systems_state)
        ? (snapshotRows[0]!.systems_state as { key: string; score: number | null }[])
        : [];

      const currentState = computeCurrentState({
        goals: [...goals].slice(0, 8),
        symptomRows,
        medications,
        supplementNames: [...supplementNames],
        flagRows,
        labPoints,
        biometricRows,
        changes,
      });

      const systems = computeSystemsModel({
        labPoints,
        changes,
        symptomRows,
        hypotheses,
        hasWearableData: biometricRows.length > 0,
        hasLabData: labPoints.length > 0,
        hasSymptomData: symptomRows.length > 0,
        previousSystems,
      });

      const { issues, missing } = assessDataQuality({
        lastWearableDate: biometricRows[0] ? String(biometricRows[0].date) : null,
        lastLabDate: labPoints[0]?.collectedAt ?? null,
        lastSymptomDate: symptomRows[0] ? String(symptomRows[0].logged_at ?? "") : null,
      });

      return {
        computedAt: new Date().toISOString(),
        currentState,
        systems,
        dataQualityIssues: issues,
        missingData: missing,
        lastSnapshotAt: snapshotRows[0] ? String(snapshotRows[0].created_at ?? "") : null,
        layer3: {
          available: false as const,
          note: "The personalized response model is built from your N-of-1 experiment results and arrives with the N-of-1 Laboratory.",
        },
      };
    }),
});
