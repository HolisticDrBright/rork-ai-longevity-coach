# ADR 0001 — Clinical Reasoning Foundation (Phase 1 slice)

Date: 2026-07-15 · Status: Accepted

## Context

AI Longevity Pro has strong deterministic engines (wearable baselines/scores/patterns, clinic alerts, supplement rules) and client-side LLM analysis, but no durable reasoning layer: AI output is unversioned free text shown directly to patients, records lack provenance, there is no unified timeline, no hypothesis lifecycle, no practitioner review, and no server-side RBAC or audit trail. The remote Supabase schema is not versioned in the repo.

## Decision

1. **Relational, not graph.** The longitudinal health graph starts as Postgres tables with typed edges (`clinical_relationships`). A graph database is not justified at current scale.
2. **New tables are additive and RLS-first.** One migration (`expo/supabase/migrations/20260715090000_clinical_reasoning_foundation.sql`) creates nine tables; it never alters existing tables, and every table enables RLS with explicit policies in the same file. The repo becomes the source of truth for all *new* schema.
3. **Reasoning runs server-side.** A new tRPC `reasoning` router owns the pipeline. Deterministic stages (validation, change detection vs baselines, snapshotting, review queueing) are plain TypeScript services in `backend/services/reasoning/`. LLM stages are added in Phase 2 behind the same interfaces; every AI operation must be logged to `ai_operations` before output is used.
4. **Fact–inference separation is a data-model invariant.** Every `clinical_facts` / `clinical_hypotheses` / `evidence_items` / `clinical_relationships` row carries `source_type` ∈ {measured, patient_reported, practitioner_entered, published_evidence, ai_inference, rule_engine} and a `review_status`. AI/rule rows are born `pending_review` and can never be flipped to `practitioner_entered`; acceptance is recorded on `practitioner_reviews` + `reviewed_by`, preserving origin.
5. **Server-side RBAC now.** `practitionerProcedure` (and `adminProcedure`) check `user_roles` in the database per request. Practitioner access to another user's reasoning data additionally requires an `active` row in `practitioner_patient_relationships` (patient-consented). The legacy clinic router is untouched in this slice (Phase 5 migrates it).
6. **Timeline is a query-time union, not a copy.** `getTimeline` unions existing tables (lab panels/markers, symptoms, protocols, supplement logs, meals, daily biometrics, hormone entries) plus new facts, each event exposing `observedAt` (clinical time) separately from `recordedAt` (ingestion time). No data migration.
7. **Snapshots are immutable.** Each pipeline run writes a `reasoning_snapshots` row (inputs summary, hypotheses state, detected changes, diff vs previous). UI "what changed" reads snapshots, never recomputes history.
8. **Feature-flagged UI.** `expo/lib/featureFlags.ts` gates the new screens (`clinicalReasoning`). Patient timeline and clinic reasoning screens are additive routes; no existing screen is removed or restyled.

## Consequences

- The remote DB must have the migration applied (`supabase db push` or SQL editor) before the new screens return data; the UI degrades gracefully (empty states) until then.
- Scores shown are labeled "support level"; nothing in this slice produces diagnoses or patient-visible recommendations without review.
- Legacy client-side AI lab analysis keeps working unchanged; its output will be re-pointed through the review pipeline in Phase 2.
- Follow-ups: export legacy remote schema into migrations; practitioner-role approval workflow; move client AI calls server-side (Phase 2); extend audit coverage to clinic routes (Phase 5).
