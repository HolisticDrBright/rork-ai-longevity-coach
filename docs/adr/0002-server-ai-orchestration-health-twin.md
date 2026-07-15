# ADR 0002 — Server-side AI orchestration, hypothesis engine, Health Twin L1/L2 (Phase 2 slice)

Date: 2026-07-15 · Status: Accepted · Builds on ADR 0001

## Context

Phase 1 delivered the reasoning schema, deterministic pipeline v1, review queue and RBAC. Two structural problems remain from the audit: (a) all LLM calls run on the device with `EXPO_PUBLIC_*` keys, sending lab PDFs (PHI) directly to OpenAI from the client; (b) hypotheses exist only as practitioner-entered records — nothing generates or challenges them from data. The Health Twin has no surface.

## Decisions

1. **One server-side AI gateway (`backend/services/ai/aiClient.ts`).** Configured exclusively by server env (`AI_PROVIDER_API_KEY`, `AI_PROVIDER_BASE_URL`, `AI_MODEL`) against any OpenAI-compatible `/chat/completions` endpoint — this covers OpenAI directly and org-approved gateways without new dependencies. When unconfigured, every AI-optional feature degrades to its deterministic path and reports `aiUsed: false`; nothing is faked.
2. **Structured output or nothing.** Server AI calls use JSON mode + zod validation with one corrective retry. Every attempt is logged to `ai_operations` (template name + version, validation result, latency, retry count, error). Clinical outputs are born `pending_review`.
3. **PHI minimization in prompts.** Prompts receive structured clinical summaries (biomarker names/values/ranges, symptom names/severities, detected changes) — never names, emails, DOBs, or free-form documents, except the lab-extraction operation, which necessarily sends the lab file itself and is therefore the flagship reason AI must be server-routed and org-configured.
4. **Hypothesis generation is deterministic-first.** A rule registry (`hypothesisRules.ts`) generates candidate hypotheses (`source_type='rule_engine'`) with supporting evidence links and missing-evidence lists. When server AI is configured, an LLM pass may add candidates (`source_type='ai_inference'`). Both are deduped by `code`, enter the review queue, and can never be born accepted.
5. **Contradiction detection is deterministic.** Each rule declares `contradictedWhen`; the pipeline records contradicting `evidence_items` when current data no longer supports an active hypothesis, and the existing score recompute weakens it. No LLM in the loop for contradiction bookkeeping.
6. **Pipeline extracted to `pipelineRunner.ts`.** `reasoning.analysis.run` and `labs.extract` share the same runner, so ingesting a lab automatically re-reasons (spec stage: "pipeline runs when meaningful new data arrives").
7. **Health Twin Layers 1–2 are computed, not stored models.** Layer 1 (current state) and Layer 2 (12-system model) are pure functions over existing tables plus the hypothesis ledger; each pipeline run persists `systems_state` into the snapshot so trends and before/after comparison come from immutable history. Layer 3 (response model) explicitly reports "not yet available" until Phase 4 — the UI must not imply simulation.
8. **Server-side lab extraction with migration path.** `labs.extract` accepts PDF/images, runs the two-pass verbatim-then-enrich extraction server-side, writes `uploaded_documents` (raw text, dedupe hash, provenance) + `lab_panels` (existing UI compatibility) + `lab_markers` (structured), and never silently overwrites: duplicate uploads are detected by content hash and returned as duplicates. The client uses the server path whenever `labs.capabilities` reports it configured; the legacy client-side path remains only for unconfigured orgs and is never used as a fallback after a server attempt fails (no silent PHI re-routing).

## Consequences

- Orgs enable server AI by setting Fly secrets; until then the app behaves exactly as before, plus deterministic hypotheses/twin.
- `clinical_hypotheses.code` and `reasoning_snapshots.systems_state` are added (additive migration) for dedupe and trend history.
- Follow-ups: move chat/insights + meal parsing behind the server gateway; store original lab files in Supabase Storage with signed URLs (needs bucket policy work); retire `EXPO_PUBLIC_OPENAI_API_KEY` after org migration; Phase 3 safety engine consumes the same runner.
