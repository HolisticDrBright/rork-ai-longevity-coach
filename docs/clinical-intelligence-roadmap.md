# Clinical Intelligence Roadmap

_Phased plan to evolve AI Longevity Pro into a longitudinal precision-health platform. Each phase is shippable, feature-flagged, and additive — no rewrite. Flags live in `expo/lib/featureFlags.ts`._

## Guiding rules

1. Extend the existing stack (Expo Router + Hono/tRPC + Supabase). No new databases or frameworks unless scale demands it.
2. Every new table ships as a versioned migration in `expo/supabase/migrations/` with RLS enabled and policies in the same file.
3. AI inference is never stored as confirmed fact. Every AI output carries `source_type='ai_inference'` and a review status.
4. New intelligence runs server-side (tRPC), with deterministic stages separated from LLM stages, and every AI operation logged to `ai_operations`.
5. Preserve all current features and styles; refactor call sites incrementally behind flags.

## Phase 1 — Reasoning foundation (THIS SLICE)

**Goal:** provenance, longitudinal timeline, fact–inference separation, reasoning snapshots, practitioner review queue.

- Migration `clinical_reasoning_foundation`: `clinical_facts`, `clinical_hypotheses`, `evidence_items`, `clinical_relationships`, `reasoning_snapshots`, `ai_operations`, `practitioner_reviews`, `practitioner_patient_relationships`, `audit_events` — all RLS-enabled, additive only.
- Server: `reasoning` tRPC router — unified timeline (unions labs, symptoms, protocols, supplements, wearable days, meals, hormone entries with observation-vs-ingestion dates), hypothesis CRUD (practitioner + system sources), deterministic analysis pipeline v0 (validate → detect changes vs baselines → record facts → snapshot → queue reviews), review queue with accept/modify/reject + rationale.
- Server-side RBAC middleware (`practitionerProcedure`) backed by `user_roles`; applied to the new router (clinic router adoption follows in Phase 5 hardening).
- UI: source badges (measured / patient-reported / practitioner / published / AI inference / uncertain), patient Timeline screen, clinic Clinical Reasoning screen (desktop-first 3-column on wide viewports) with review queue.
- Tests: temporal utils, timeline merge, pipeline stages, RBAC denial, review decisions.

**Exit criteria:** a practitioner can see a patient's unified timeline, ranked hypotheses with evidence for/against, what changed since last snapshot, and can accept/reject items; every AI/system inference is visibly labeled and logged.

## Phase 2 — Hypothesis engine & Health Twin L1/L2 (DELIVERED — see ADR 0002)

- ✅ Server-side AI gateway (`backend/services/ai/aiClient.ts`): env-configured OpenAI-compatible endpoint, JSON mode + zod validation with corrective retry, every attempt logged to `ai_operations`; deterministic degradation when unconfigured.
- ✅ Hypothesis generation: deterministic rule registry (10 clinical patterns with supporting-evidence links, missing-evidence lists, `contradictedWhen` checks) + optional LLM candidates — both deduped by `code`, born `pending_review`, queued for practitioner review.
- ✅ Contradiction detection stage records contradicting `evidence_items` when current data argues against active hypotheses; score recompute weakens them.
- ✅ Pipeline extracted to `pipelineRunner.ts` (v2.0.0) shared by `reasoning.analysis.run` and `labs.extract`.
- ✅ Adaptive Health Twin Layer 1 (current state) + Layer 2 (12-system model with support level, contributors, contradictions, trend vs previous snapshot, data quality, missing data, review status); `systems_state` persisted per snapshot; patient + clinic screens. Layer 3 honestly reported unavailable until Phase 4.
- ✅ Server-side lab ingestion: `labs.extract` (two-pass verbatim→enrich, content-hash dedupe, `uploaded_documents` provenance, `lab_markers` with report-date observation time), client uses it whenever `labs.capabilities` reports configured — no client-key PHI path when server AI is on, and no silent fallback.
- Remaining for later phases: original-file storage in Supabase Storage (bucket policies), page/location provenance per extracted value, corrected-report supersede flow UI.

## Phase 3 — Supplement Intelligence Network & deterministic safety

- `supplement_products`, `supplement_ingredients`, `ingredient_forms`, `supplement_exposures` (start/stop), `ingredient_evidence`, `ingredient_interactions`, `nutrient_upper_limits`; migrate curated catalog from `mocks/` into DB with versions.
- Label scanner (server-side vision extraction with review), ingredient normalization, cumulative-dose calculator, full stack audit (duplicates, upper limits, interactions, condition cautions, pregnancy/renal/hepatic/procedure flags, no-active-goal products, simplification opportunities).
- Deterministic safety-rules engine (extends clinic alert engine): severity taxonomy informational → emergency instruction, block/require-review actions, versioned rules with effective dates. Runs outside the LLM on every recommendation.
- "Does this work for me?" view fed by exposures × outcome trends.

## Phase 4 — N-of-1 Laboratory & Health Twin L3

- `experiments`, `experiment_phases`, `interventions`, `outcome_definitions`, `experiment_observations`, `confounders`, `adverse_events`, `experiment_analyses` tables + guided Experiment Builder (one primary variable default; approval policies by intervention class).
- Analysis engine: baseline vs intervention windows, absolute/relative change, completeness, confounder flags, biological latency, five-level conclusions with plain-language explanation; results feed Health Twin Layer 3 (response model).

## Phase 5 — Quantum Mind, practitioner workflow, hardening

- Quantum Mind: session catalog, behavioral-barrier tagging on goals, pathway suggestions (no mental-health diagnoses), completion/response/adherence-effect tracking, contraindication & escalation triggers.
- Reports (practitioner clinical-intelligence, patient progress, lab trends, stack audit, experiment, Twin summary, protocol/monitoring) with fact/interpretation/AI/approved separation.
- Security hardening: move remaining client AI calls server-side, org/clinic tenancy, consent-scoped sharing, server audit coverage of all PHI access, retention/export/deletion workflows, rate limits, MFA for practitioners, RLS review; complete `docs/hipaa-readiness-checklist.md` items.
- External integrations (Fullscript live catalog, additional labs), performance passes.

## Sequencing notes

- Phases 2–5 each start with an ADR in `docs/adr/` and end with lint + typecheck + tests + build green.
- The clinic `clinic_*` tables remain untouched until Phase 5 tenancy work; new reasoning tables reference `auth.users` ids directly (patient-app world) and bridge to clinic records via `practitioner_patient_relationships`.
- Data migration from `mocks/` catalogs and local-first storage happens opportunistically (dual-read, then cutover) — never a big-bang migration.
