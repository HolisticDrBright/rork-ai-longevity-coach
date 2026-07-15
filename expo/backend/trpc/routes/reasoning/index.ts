import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTRPCRouter,
  protectedProcedure,
  practitionerProcedure,
} from "../../create-context";
import { createServerSupabaseClient } from "../../../supabase-server";
import { writeAuditEvent } from "../../../services/reasoning/audit";
import { resolveSubjectUserId, safeRows } from "../../../services/reasoning/access";
import { runReasoningPipeline } from "../../../services/reasoning/pipelineRunner";
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
  mapRowToEvidence,
  mapRowToHypothesis,
  mapRowToRelationship,
  mapRowToReview,
  mapRowToSnapshot,
} from "../../../services/reasoning/rowMappers";
import type { ClinicalHypothesis, TimelineEvent } from "@/types/reasoning";

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
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const userId = await resolveSubjectUserId(sb, ctx, input.patientId, "reasoning.analysis.run");
      try {
        const result = await runReasoningPipeline(sb, { id: ctx.user.id }, userId, input.trigger);
        return result.snapshot;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Analysis failed";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
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
