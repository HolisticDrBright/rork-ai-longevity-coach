# Clinical Intelligence Gap Analysis

_Compares the current implementation against the target: a longitudinal precision-health operating system with dynamic clinical reasoning, an Adaptive Health Twin, N-of-1 experimentation, supplement intelligence, Quantum Mind behavior change, and practitioner oversight._

## A. Reasoning & knowledge architecture

| Target capability | Current state | Gap |
|---|---|---|
| Fact–inference separation | AI free-text analysis stored as `LabAnalysis.summary`; `detected_patterns`/`correlations` carry confidence but no source typing | **Critical.** No record distinguishes measured fact / patient-reported / practitioner conclusion / published evidence / AI inference. AI output is presented as analysis with no review state. |
| Competing clinical hypotheses | `FunctionalPatternAssessment.rootCauseHypotheses` is a `string[]` computed from questionnaire scores; discarded on recompute | No hypothesis lifecycle (proposed → supported/weakened/rejected), no evidence ledger, no score history, no "what changed and why". |
| Evidence ledger (supporting + contradicting) | `evidence_json` blobs on patterns/correlations | No first-class EvidenceItem linking observations ↔ hypotheses with direction, no contradiction detection. |
| Longitudinal health graph (typed relationships) | Implicit only (correlations table) | No `ClinicalRelationship` with type/direction/provenance/review status. |
| Reasoning snapshots & versioning | None — analyses overwrite in place | No versioned `ReasoningSnapshot`, no before/after comparison, no reproducibility. |
| Temporal reasoning utilities | Trend engine (7/30-day windows), lagged correlations | No intervention→outcome windows, washout/rechallenge detection, confounder overlap, observation-date vs ingestion-date separation (lab `date` is upload-time `Date.now()` in places). |
| Data provenance envelope | `source` string on some rows; `raw_health_events` keeps payloads (good) | No source document ID, page/location, original vs normalized value, extraction confidence, reviewed-by, superseded-by on clinical records. Client generates IDs like `bio_${Date.now()}`. |
| Curated knowledge & RAG | Curated supplement catalog + peptide evidence in `mocks/` (static TS) | No versioned knowledge store, no publication/review dates on most content, no retrieval separation between patient records / curated evidence / product labels. |

## B. AI orchestration

| Target | Current | Gap |
|---|---|---|
| Specialized agents with schema-validated outputs | One giant 8-section lab prompt; chat with context string; 3 `generateObject` utilities | No task decomposition (extraction / normalization / hypothesis / contradiction / safety / explanation), no schema validation ledger. |
| AI operation logging (model, template version, inputs, outputs, validation, reviewer) | `console.log` only | **Critical for auditability.** Nothing persisted. |
| Server-side AI proxy | All LLM calls from the device with `EXPO_PUBLIC_*` keys | **Critical security gap** — keys are extractable from the app bundle; PHI (lab PDFs) flows device → OpenAI without an org-approved gateway; no rate limiting or logging. |
| Practitioner review of AI output before patient exposure | None — AI analysis renders immediately to the patient | No approval policy engine, no review queue. |

## C. Domain model gaps (entities that do not exist yet)

- Identity/tenancy: `Organization`, `Clinic`, `Permission`, `PractitionerPatientRelationship`, `Consent` (scoped, versioned), `DataSharingAuthorization`, server-side `AuditEvent`.
- Health record: `Condition`, `Medication` (as records w/ exposure periods — currently strings on `contraindications`), `SupplementExposure` (start/stop periods vs point-in-time logs), `FamilyHistory`, `ClinicalNote`, `UploadedDocument` (patient-side), `DataSource` registry.
- Measurement: `BiomarkerDefinition` + `ReferenceRange` registry (patient app), unit normalization, `SpecialtyLabResult`, `PatientReportedOutcome` as typed observations.
- Reasoning: `ClinicalFact`, `ClinicalHypothesis`, `EvidenceItem`, `Contradiction`, `DataQualityIssue`, `MissingDataRecommendation`, `ClinicalRelationship`, `ReasoningSnapshot`, `RiskFlag` (server), `SafetyRule`, `Recommendation` (with approval state), `PractitionerDecision`.
- Experimentation: everything (`Experiment`, phases, interventions, outcomes, confounders, adverse events, analyses, conclusions).
- Knowledge: `ResearchSource`, `EvidenceSummary`, `IngredientEvidence`, `IngredientInteraction`, `Contraindication` (rule-form), `NutrientUpperLimit`, `ClinicalGuideline`, `KnowledgeVersion`.
- Supplement intelligence: `SupplementProduct`/`SupplementIngredient` exist as types + static catalog, but no product DB w/ UPC/label versions, no ingredient normalization/forms, no cumulative-dose math, no stack audit, no label scanning, no per-user response tracking.
- Quantum Mind: nothing (no session catalog, no barrier model, no tracking).

## D. Security, privacy, auditability

| Issue | Severity | Detail |
|---|---|---|
| LLM keys shipped in client bundle (`EXPO_PUBLIC_OPENAI_API_KEY`, Rork toolkit secret) | **Critical** | Extractable from any installed app; also billing abuse vector. Move AI calls server-side. |
| PHI sent to third-party AI from device | **Critical** | Lab PDFs uploaded to OpenAI Files from the client; no org approval/BAA path, no logging, no redaction option. |
| No server-side RBAC | **High** | Any authenticated user can call `clinic.*` procedures; row scoping + (unversioned) RLS is the only protection. Practitioner role is self-assigned client-side. |
| Schema & RLS not in repo | **High** | Empty migration file; cannot review or reproduce policies; drift risk. New work must ship versioned, RLS-enabled migrations. |
| Audit log is device-local, capped at 5k entries, clearable by the client | **High** | Not usable for compliance. Need append-only server-side audit of PHI access. |
| `secureStorage` uses XOR obfuscation labeled "encrypted" | **Medium** | Key in SecureStore helps, but XOR is not encryption; messaging overstates protection. |
| `nutrition.*` public (unauthenticated) | **Medium** | Open proxy to paid Passio API; add auth + rate limits. |
| Patient search uses string interpolation in `.or()` filter | **Medium** | `first_name.ilike.%${input.search}%` — sanitize/escape filter input. |
| No tenant/org isolation, no consent-scoped sharing | **High** | Required before multi-practitioner use. |
| Client-generated record IDs / timestamps as IDs | **Low** | `panel_${Date.now()}` risks collisions; use UUIDs. |

## E. UX gaps vs target navigation

- No desktop-first practitioner layout (three-column reasoning screen, review queue, audit log screen).
- No patient Health Twin / Progress / Experiments surfaces.
- No timeline view unifying labs, symptoms, protocols, wearables, meals (clinic patient detail has a basic event list; patient app has none).
- No visible provenance/inference labeling anywhere in the UI.

## F. What is strong and should be built on (not replaced)

- Deterministic wearable engines (baseline/scores/patterns/correlations) — reuse as pipeline stages 4–5 (change/trend detection).
- Two-pass verbatim lab extraction design — good provenance instinct; formalize into server-side ingestion with confidence + source location.
- Clinic alert engine (dedupe, severities, quiet hours) — extend into the deterministic safety-rules engine.
- Curated supplement catalog with contraindications/interactions — seed data for the Supplement Intelligence Network.
- `raw_health_events` → rollup pattern — the template for all ingestion provenance.
- Peptide evidence types (`strengthGrade`, `studyType`, `lastReviewed`) — the template for `IngredientEvidence`.
