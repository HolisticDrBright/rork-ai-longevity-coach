import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTRPCRouter,
  protectedProcedure,
  practitionerProcedure,
  getAppRoles,
} from "../../create-context";
import { createServerSupabaseClient } from "../../../supabase-server";
import { writeAuditEvent } from "../../../services/reasoning/audit";
import {
  mapClinicalFacts,
  mapHormoneEntries,
  mapLabMarkers,
  mapLabPanels,
  mapMealLogs,
  mapProtocols,
  mapSupplementLogs,
  mapSymptomLogs,
  mapWearableDays,
  mergeTimeline,
} from "../../../services/reasoning/timeline";
import {
  assessDataQuality,
  detectBiometricChanges,
  detectLabChanges,
  type LabMarkerPoint,
} from "../../../services/reasoning/changeDetection";
import {
  computeSupportScore,
  diffSnapshots,
  statusFromScore,
  toSnapshotEntry,
} from "../../../services/reasoning/scoring";
import {
  mapRowToEvidence,
  mapRowToHypothesis,
  mapRowToRelationship,
  mapRowToReview,
  mapRowToSnapshot,
} from "../../../services/reasoning/rowMappers";
import type { ClinicalHypothesis, TimelineEvent } from "@/types/reasoning";

export const REASONING_PIPELINE_VERSION = "1.0.0";

const timelineKindSchema = z.enum([
  "lab_panel",
  "lab_marker",
  "symptom",
  "protocol",
  "supplement",
  "meal",
  "wearable_day",
  "hormone",
  "clinical_fact",
  "snapshot",
]);

type Ctx = {
  user: { id: string; email: string | undefined; role: string };
  sessionToken: string;
};

/**
 * Resolves which user's record is being accessed. Self-access is always
 * allowed; cross-user access requires practitioner/admin role AND an active,
 * patient-consented relationship. Cross-user access is audited.
 */
async function resolveSubjectUserId(
  sb: SupabaseClient,
  ctx: Ctx,
  patientId: string | undefined,
  action: string
): Promise<string> {
  const target = patientId ?? ctx.user.id;
  if (target === ctx.user.id) return target;

  const roles = await getAppRoles(ctx.sessionToken, ctx.user.id);
  const isPractitioner = roles.includes("practitioner") || roles.includes("admin");
  if (!isPractitioner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Practitioner role required" });
  }

  const { data, error } = await sb
    .from("practitioner_patient_relationships")
    .select("id, status")
    .eq("practitioner_id", ctx.user.id)
    .eq("patient_id", target)
    .eq("status", "active")
    .limit(1);

  if (error || !data || data.length === 0) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No active authorization for this patient",
    });
  }

  await writeAuditEvent(sb, {
    actorId: ctx.user.id,
    actorRole: "practitioner",
    action,
    resourceType: "patient_record",
    patientId: target,
  });

  return target;
}

/** Queries that tolerate missing tables (remote schema drift) return []. */
async function safeRows(
  query: PromiseLike<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }>,
  label: string
): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await query;
    if (error) {
      console.log(`[Reasoning] ${label} query failed: ${error.code ?? "unknown"}`);
      return [];
    }
    return data ?? [];
  } catch {
    console.log(`[Reasoning] ${label} query failed`);
    return [];
  }
}

async function loadHypothesesWithEvidence(
  sb: SupabaseClient,
  userId: string,
  includeArchived: boolean
): Promise<ClinicalHypothesis[]> {
  let query = sb
    .from("clinical_hypotheses")
    .select("*")
    .eq("user_id", userId)
    .order("support_score", { ascending: false });
  if (!includeArchived) {
    query = query.neq("status", "archived");
  }
  const rows = await safeRows(query, "hypotheses");
  const hypotheses = rows.map(mapRowToHypothesis);
  if (hypotheses.length === 0) return [];

  const evidenceRows = await safeRows(
    sb
      .from("evidence_items")
      .select("*")
      .eq("user_id", userId)
      .in("hypothesis_id", hypotheses.map((h) => h.id)),
    "evidence"
  );
  const evidence = evidenceRows.map(mapRowToEvidence);
  for (const h of hypotheses) {
    h.supportingEvidence = evidence.filter(
      (e) => e.hypothesisId === h.id && e.direction === "supports"
    );
    h.contradictingEvidence = evidence.filter(
      (e) => e.hypothesisId === h.id && e.direction === "contradicts"
    );
  }
  return hypotheses;
}

const timelineRouter = createTRPCRouter({
  get: protectedProcedure
    .input(
      z.object({
        patientId: z.string().uuid().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        kinds: z.array(timelineKindSchema).optional(),
        limitPerSource: z.number().min(1).max(500).default(200),
      })
    )
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const userId = await resolveSubjectUserId(sb, ctx, input.patientId, "reasoning.timeline.read");
      const limit = input.limitPerSource;

      const [labPanels, labMarkers, symptoms, protocols, supplements, meals, wearables, hormones, facts] =
        await Promise.all([
          safeRows(sb.from("lab_panels").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(limit), "lab_panels"),
          safeRows(sb.from("lab_markers").select("*").eq("user_id", userId).order("collected_at", { ascending: false }).limit(limit), "lab_markers"),
          safeRows(sb.from("symptom_logs").select("*").eq("user_id", userId).order("logged_at", { ascending: false }).limit(limit), "symptom_logs"),
          safeRows(sb.from("protocols").select("*").eq("user_id", userId).order("start_date", { ascending: false }).limit(limit), "protocols"),
          safeRows(sb.from("supplement_logs").select("*").eq("user_id", userId).order("logged_at", { ascending: false }).limit(limit), "supplement_logs"),
          safeRows(sb.from("meal_logs").select("*").eq("user_id", userId).order("meal_time", { ascending: false }).limit(limit), "meal_logs"),
          safeRows(sb.from("daily_biometric_records").select("id,user_id,date,primary_source,hrv,resting_hr,sleep_duration_minutes,steps,data_quality_score,created_at").eq("user_id", userId).order("date", { ascending: false }).limit(limit), "daily_biometric_records"),
          safeRows(sb.from("hormone_entries").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(limit), "hormone_entries"),
          safeRows(sb.from("clinical_facts").select("*").eq("user_id", userId).is("deleted_at", null).order("observed_at", { ascending: false }).limit(limit), "clinical_facts"),
        ]);

      const events: TimelineEvent[] = [
        ...mapLabPanels(labPanels),
        ...mapLabMarkers(labMarkers),
        ...mapSymptomLogs(symptoms),
        ...mapProtocols(protocols),
        ...mapSupplementLogs(supplements),
        ...mapMealLogs(meals),
        ...mapWearableDays(wearables),
        ...mapHormoneEntries(hormones),
        ...mapClinicalFacts(facts),
      ];

      return mergeTimeline(events, { from: input.from, to: input.to, kinds: input.kinds });
    }),
});

const hypothesesRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        patientId: z.string().uuid().optional(),
        includeArchived: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const userId = await resolveSubjectUserId(sb, ctx, input.patientId, "reasoning.hypotheses.read");
      return loadHypothesesWithEvidence(sb, userId, input.includeArchived);
    }),

  create: practitionerProcedure
    .input(
      z.object({
        patientId: z.string().uuid(),
        name: z.string().min(3).max(200),
        description: z.string().max(4000).optional(),
        systems: z.array(z.string()).default([]),
        missingEvidence: z.array(z.string()).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const userId = await resolveSubjectUserId(sb, ctx, input.patientId, "reasoning.hypotheses.create");

      const { data, error } = await sb
        .from("clinical_hypotheses")
        .insert({
          user_id: userId,
          name: input.name,
          description: input.description ?? null,
          status: "proposed",
          support_score: 50,
          systems: input.systems,
          missing_evidence: input.missingEvidence,
          source_type: "practitioner_entered",
          review_status: "accepted",
          created_by: ctx.user.id,
          reviewed_by: ctx.user.id,
          reviewed_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (error || !data) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create hypothesis" });
      }

      await writeAuditEvent(sb, {
        actorId: ctx.user.id,
        actorRole: "practitioner",
        action: "reasoning.hypothesis.create",
        resourceType: "clinical_hypothesis",
        resourceId: String(data.id),
        patientId: userId,
      });

      return mapRowToHypothesis(data as Record<string, unknown>);
    }),

  updateStatus: practitionerProcedure
    .input(
      z.object({
        hypothesisId: z.string().uuid(),
        status: z.enum(["proposed", "under_review", "supported", "weakened", "unresolved", "rejected", "archived"]),
        note: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      // RLS restricts the update to hypotheses of self or authorized patients.
      const { data, error } = await sb
        .from("clinical_hypotheses")
        .update({
          status: input.status,
          score_change_reason: input.note ?? null,
          reviewed_by: ctx.user.id,
          reviewed_at: new Date().toISOString(),
          review_status: input.status === "rejected" ? "rejected" : "accepted",
          archived_at: input.status === "archived" ? new Date().toISOString() : null,
        })
        .eq("id", input.hypothesisId)
        .select("*")
        .single();

      if (error || !data) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Hypothesis not found or not authorized" });
      }

      await writeAuditEvent(sb, {
        actorId: ctx.user.id,
        actorRole: "practitioner",
        action: "reasoning.hypothesis.update_status",
        resourceType: "clinical_hypothesis",
        resourceId: input.hypothesisId,
        patientId: String((data as Record<string, unknown>).user_id),
        details: { status: input.status },
      });

      return mapRowToHypothesis(data as Record<string, unknown>);
    }),

  addEvidence: practitionerProcedure
    .input(
      z.object({
        hypothesisId: z.string().uuid(),
        patientId: z.string().uuid(),
        direction: z.enum(["supports", "contradicts", "neutral"]),
        summary: z.string().min(3).max(2000),
        evidenceType: z.string().default("practitioner_note"),
        strength: z.number().min(0).max(1).optional(),
        factId: z.string().uuid().optional(),
        citation: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const userId = await resolveSubjectUserId(sb, ctx, input.patientId, "reasoning.evidence.add");

      const { data, error } = await sb
        .from("evidence_items")
        .insert({
          user_id: userId,
          hypothesis_id: input.hypothesisId,
          direction: input.direction,
          evidence_type: input.evidenceType,
          fact_id: input.factId ?? null,
          source_type: "practitioner_entered",
          summary: input.summary,
          strength: input.strength ?? null,
          citation: input.citation ?? null,
          created_by: ctx.user.id,
        })
        .select("*")
        .single();

      if (error || !data) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to add evidence" });
      }

      return mapRowToEvidence(data as Record<string, unknown>);
    }),
});

const analysisRouter = createTRPCRouter({
  run: protectedProcedure
    .input(
      z.object({
        patientId: z.string().uuid().optional(),
        trigger: z
          .enum(["manual", "new_lab", "new_symptom", "schedule", "wearable_trend"])
          .default("manual"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const startedAt = Date.now();
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const userId = await resolveSubjectUserId(sb, ctx, input.patientId, "reasoning.analysis.run");

      // ---- Stage 1-2: gather + validate inputs -------------------------------
      const [biometricRows, baselineRows, labRows, symptomRows] = await Promise.all([
        safeRows(
          sb.from("daily_biometric_records").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(30),
          "daily_biometric_records"
        ),
        safeRows(
          sb.from("daily_baselines").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(1),
          "daily_baselines"
        ),
        safeRows(
          sb.from("lab_markers").select("*").eq("user_id", userId).order("collected_at", { ascending: false }).limit(200),
          "lab_markers"
        ),
        safeRows(
          sb.from("symptom_logs").select("*").eq("user_id", userId).order("logged_at", { ascending: false }).limit(50),
          "symptom_logs"
        ),
      ]);

      // ---- Stage 4: deterministic change detection ---------------------------
      const biometricDays = biometricRows
        .map((r) => ({ ...r, date: String(r.date ?? "") }))
        .reverse();
      const biometricChanges = detectBiometricChanges(biometricDays, baselineRows[0] ?? null);

      const labPoints: LabMarkerPoint[] = labRows.map((r) => ({
        markerName: String(r.marker_name ?? ""),
        value: Number(r.marker_value ?? NaN),
        unit: typeof r.unit === "string" ? r.unit : undefined,
        referenceLow: typeof r.reference_range_low === "number" ? r.reference_range_low : null,
        referenceHigh: typeof r.reference_range_high === "number" ? r.reference_range_high : null,
        collectedAt: String(r.collected_at ?? ""),
      })).filter((p) => Number.isFinite(p.value) && p.markerName && p.collectedAt);
      const labChanges = detectLabChanges(labPoints);

      const detectedChanges = [...biometricChanges, ...labChanges];

      // ---- Stage 11: data quality + missing data -----------------------------
      const { issues, missing } = assessDataQuality({
        lastWearableDate: biometricRows[0] ? String(biometricRows[0].date) : null,
        lastLabDate: labPoints[0]?.collectedAt ?? null,
        lastSymptomDate: symptomRows[0] ? String(symptomRows[0].logged_at ?? "") : null,
      });

      // ---- Stage 7: recompute hypothesis support from the evidence ledger ----
      const hypotheses = await loadHypothesesWithEvidence(sb, userId, false);
      for (const h of hypotheses) {
        const evidence = [...(h.supportingEvidence ?? []), ...(h.contradictingEvidence ?? [])];
        const newScore = computeSupportScore(evidence, h.missingEvidence.length);
        if (newScore !== h.supportScore) {
          const reason = `Recomputed from ${evidence.length} evidence item(s) on ${input.trigger} run`;
          const newStatus =
            h.status === "rejected" || h.status === "archived" || h.status === "under_review"
              ? h.status
              : statusFromScore(newScore, evidence.length);
          await sb
            .from("clinical_hypotheses")
            .update({
              prior_support_score: h.supportScore,
              support_score: newScore,
              score_change_reason: reason,
              status: newStatus,
            })
            .eq("id", h.id);
          h.priorSupportScore = h.supportScore;
          h.supportScore = newScore;
          h.scoreChangeReason = reason;
          h.status = newStatus;
        }
      }

      // ---- Stage 3: record significant changes as rule_engine facts ----------
      const significant = detectedChanges.filter((c) => c.severity === "significant");
      for (const change of significant) {
        const { data: existing } = await sb
          .from("clinical_facts")
          .select("id")
          .eq("user_id", userId)
          .eq("fact_type", "change")
          .eq("code", change.metric)
          .gte("observed_at", new Date(Date.now() - 7 * 86400000).toISOString())
          .limit(1);
        if (existing && existing.length > 0) continue; // dedupe within a week

        await sb.from("clinical_facts").insert({
          user_id: userId,
          fact_type: "change",
          code: change.metric,
          label: `${change.label} ${change.direction} ${change.magnitudePercent}% vs baseline`,
          value_num: change.currentValue,
          unit: change.unit ?? null,
          value_json: change as unknown as Record<string, unknown>,
          observed_at: change.observedAt,
          source_type: "rule_engine",
          source: "reasoning.change_detection",
          data_quality: change.dataQuality ?? null,
          review_status: "pending_review",
          created_by: ctx.user.id,
        });
      }

      // ---- Stage 14: versioned snapshot + diff -------------------------------
      const prevRows = await safeRows(
        sb.from("reasoning_snapshots").select("*").eq("user_id", userId).order("snapshot_number", { ascending: false }).limit(1),
        "reasoning_snapshots"
      );
      const previous = prevRows[0] ? mapRowToSnapshot(prevRows[0]) : null;

      const hypothesesState = hypotheses.map((h) =>
        toSnapshotEntry(h, [...(h.supportingEvidence ?? []), ...(h.contradictingEvidence ?? [])])
      );
      const diff = diffSnapshots(previous, hypothesesState, detectedChanges);

      const snapshotInsert = {
        user_id: userId,
        snapshot_number: (previous?.snapshotNumber ?? 0) + 1,
        trigger: input.trigger,
        pipeline_version: REASONING_PIPELINE_VERSION,
        inputs_summary: {
          biometricDays: biometricRows.length,
          labMarkers: labPoints.length,
          symptoms: symptomRows.length,
          hypotheses: hypotheses.length,
        },
        hypotheses_state: hypothesesState,
        detected_changes: detectedChanges,
        data_quality_issues: issues,
        missing_data: missing,
        diff_from_previous: diff,
        previous_snapshot_id: previous?.id ?? null,
        created_by: ctx.user.id,
      };

      const { data: snapRow, error: snapError } = await sb
        .from("reasoning_snapshots")
        .insert(snapshotInsert)
        .select("*")
        .single();

      if (snapError || !snapRow) {
        console.log(`[Reasoning] snapshot insert failed: ${snapError?.code ?? "unknown"}`);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Analysis ran but the snapshot could not be stored. Has the clinical reasoning migration been applied?",
        });
      }

      // ---- Stage 15: queue practitioner review for significant findings ------
      for (const change of significant) {
        const { data: existingReview } = await sb
          .from("practitioner_reviews")
          .select("id")
          .eq("patient_id", userId)
          .eq("subject_type", "snapshot_change")
          .eq("subject_id", change.metric)
          .eq("status", "pending")
          .limit(1);
        if (existingReview && existingReview.length > 0) continue;

        await sb.from("practitioner_reviews").insert({
          patient_id: userId,
          subject_type: "snapshot_change",
          subject_id: change.metric,
          priority: "elevated",
          proposed_summary: `${change.label} ${change.direction} of ${change.magnitudePercent}% vs baseline (rule engine, ${change.windowDays || "single"}-day window).`,
          context: { change, snapshotId: String(snapRow.id) },
          created_by: ctx.user.id,
        });
      }

      // ---- Log the operation (rule engine, no LLM in this phase) -------------
      await sb.from("ai_operations").insert({
        user_id: userId,
        operation: "reasoning.pipeline",
        model: "deterministic",
        model_version: REASONING_PIPELINE_VERSION,
        prompt_template: null,
        prompt_version: null,
        input_record_ids: {
          biometricDays: biometricRows.length,
          labMarkers: labPoints.length,
          symptoms: symptomRows.length,
        },
        output: { snapshotId: String(snapRow.id), changes: detectedChanges.length },
        validation_status: "passed",
        latency_ms: Date.now() - startedAt,
        initiated_by: ctx.user.id,
        review_status: "not_required",
      });

      await writeAuditEvent(sb, {
        actorId: ctx.user.id,
        action: "reasoning.analysis.run",
        resourceType: "reasoning_snapshot",
        resourceId: String(snapRow.id),
        patientId: userId,
        details: { trigger: input.trigger, changes: detectedChanges.length },
      });

      return mapRowToSnapshot(snapRow as Record<string, unknown>);
    }),
});

const snapshotsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(
      z.object({
        patientId: z.string().uuid().optional(),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const userId = await resolveSubjectUserId(sb, ctx, input.patientId, "reasoning.snapshots.read");
      const rows = await safeRows(
        sb.from("reasoning_snapshots").select("*").eq("user_id", userId).order("snapshot_number", { ascending: false }).limit(input.limit),
        "reasoning_snapshots"
      );
      return rows.map(mapRowToSnapshot);
    }),
});

const reviewsRouter = createTRPCRouter({
  listQueue: practitionerProcedure
    .input(
      z.object({
        status: z.enum(["pending", "accepted", "modified", "rejected", "dismissed"]).default("pending"),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      // RLS returns only reviews for patients this practitioner is authorized on.
      const rows = await safeRows(
        sb
          .from("practitioner_reviews")
          .select("*")
          .eq("status", input.status)
          .neq("patient_id", ctx.user.id)
          .order("created_at", { ascending: false })
          .limit(input.limit),
        "practitioner_reviews"
      );
      return rows.map(mapRowToReview);
    }),

  decide: practitionerProcedure
    .input(
      z.object({
        reviewId: z.string().uuid(),
        decision: z.enum(["accepted", "modified", "rejected", "dismissed"]),
        note: z.string().max(2000).optional(),
        modifiedPayload: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from("practitioner_reviews")
        .update({
          status: input.decision,
          decision_note: input.note ?? null,
          modified_payload: input.modifiedPayload ?? null,
          decided_by: ctx.user.id,
          decided_at: new Date().toISOString(),
        })
        .eq("id", input.reviewId)
        .eq("status", "pending")
        .select("*")
        .single();

      if (error || !data) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Review not found, already decided, or not authorized" });
      }

      const review = mapRowToReview(data as Record<string, unknown>);

      // Propagate the decision to the underlying subject where it applies.
      if (review.subjectType === "hypothesis") {
        await sb
          .from("clinical_hypotheses")
          .update({
            review_status: input.decision === "dismissed" ? "rejected" : input.decision,
            reviewed_by: ctx.user.id,
            reviewed_at: new Date().toISOString(),
            ...(input.decision === "rejected" ? { status: "rejected" } : {}),
          })
          .eq("id", review.subjectId);
      } else if (review.subjectType === "fact" || review.subjectType === "snapshot_change") {
        await sb
          .from("clinical_facts")
          .update({
            review_status: input.decision === "dismissed" ? "rejected" : input.decision,
            reviewed_by: ctx.user.id,
            reviewed_at: new Date().toISOString(),
          })
          .eq("user_id", review.patientId)
          .eq("fact_type", "change")
          .eq("code", review.subjectId);
      }

      await writeAuditEvent(sb, {
        actorId: ctx.user.id,
        actorRole: "practitioner",
        action: "reasoning.review.decide",
        resourceType: "practitioner_review",
        resourceId: review.id,
        patientId: review.patientId,
        details: { decision: input.decision, subjectType: review.subjectType },
      });

      return review;
    }),
});

const relationshipsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const sb = createServerSupabaseClient(ctx.sessionToken);
    const rows = await safeRows(
      sb
        .from("practitioner_patient_relationships")
        .select("*")
        .or(`patient_id.eq.${ctx.user.id},practitioner_id.eq.${ctx.user.id}`)
        .order("created_at", { ascending: false }),
      "relationships"
    );
    return rows.map(mapRowToRelationship);
  }),

  /** Patient grants a practitioner access using the practitioner's share code (user id). */
  grant: protectedProcedure
    .input(
      z.object({
        practitionerId: z.string().uuid(),
        note: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.practitionerId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot grant access to yourself" });
      }
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from("practitioner_patient_relationships")
        .upsert(
          {
            practitioner_id: input.practitionerId,
            patient_id: ctx.user.id,
            status: "active",
            granted_by: ctx.user.id,
            note: input.note ?? null,
            ended_at: null,
          },
          { onConflict: "practitioner_id,patient_id" }
        )
        .select("*")
        .single();

      if (error || !data) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to grant access" });
      }

      await writeAuditEvent(sb, {
        actorId: ctx.user.id,
        action: "consent.relationship.grant",
        resourceType: "practitioner_patient_relationship",
        resourceId: String(data.id),
        patientId: ctx.user.id,
      });

      return mapRowToRelationship(data as Record<string, unknown>);
    }),

  revoke: protectedProcedure
    .input(z.object({ relationshipId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from("practitioner_patient_relationships")
        .update({ status: "revoked", ended_at: new Date().toISOString() })
        .eq("id", input.relationshipId)
        .select("*")
        .single();

      if (error || !data) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Relationship not found or not authorized" });
      }

      await writeAuditEvent(sb, {
        actorId: ctx.user.id,
        action: "consent.relationship.revoke",
        resourceType: "practitioner_patient_relationship",
        resourceId: input.relationshipId,
        patientId: String((data as Record<string, unknown>).patient_id),
      });

      return mapRowToRelationship(data as Record<string, unknown>);
    }),
});

export const reasoningRouter = createTRPCRouter({
  timeline: timelineRouter,
  hypotheses: hypothesesRouter,
  analysis: analysisRouter,
  snapshots: snapshotsRouter,
  reviews: reviewsRouter,
  relationships: relationshipsRouter,
});
