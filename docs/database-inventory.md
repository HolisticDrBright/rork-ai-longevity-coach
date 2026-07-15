# Database Inventory — Phase 0

> **⚠️ UPDATE (live schema captured):** The live database was later introspected
> directly (Supabase MCP). Conclusions below written from the repo alone are
> **superseded by [`rls-snapshot.md`](./rls-snapshot.md)**: RLS is enabled and
> correctly scoped on all app tables, and several entities marked "absent" here
> (roles, practitioner⇆patient assignments, consents, a server-side `audit_logs`
> table, account-deletion requests) **do exist** in the live DB. Also newly
> discovered: this is a **shared ~230-table multi-product database** (PHI
> co-resident with crypto/marketing/tarot systems). Read both files together.

> **Status:** As-discovered inventory at commit `7f1be03`. **Important
> caveat:** the committed migration
> (`supabase/migrations/20260506081122_remote_schema.sql`) is **empty**, so
> this inventory is reconstructed from `types/database.ts` (mobile tables),
> router/edge-function code (clinic + webhook tables), and
> `docs/CLINIC_BACKEND_ARCHITECTURE.md` (design intent). Column lists,
> constraints, indexes, and **all RLS policies are NOT verifiable from the
> repository.** Treat table shapes below as indicative, not authoritative,
> until the live schema is dumped (`supabase db pull`).

## Remote project

- Ref: `utuszztwwadvoxxuyshn` ("Dr. Bright's Project"), org
  `pveexrgwlwjlxsigpgly` — from `supabase/.temp/`. Single project; no
  environment separation committed.

## A. Mobile / consumer domain (29 tables in `types/database.ts`)

These have generated types (so they exist in the live DB) but **no committed
DDL or RLS**.

| Table | Apparent purpose |
| --- | --- |
| `profiles` | user profile (linked to auth.users); has `email` |
| `user_roles` | role assignment (patient / practitioner / admin?) |
| `health_goals` | user longevity goals |
| `wearable_connections` | per-user provider connection + sync status |
| `raw_health_events` | immutable-ish raw wearable payloads (webhook sink) |
| `daily_biometric_records` | normalized daily rollup (rollup fn target) |
| `meal_logs` | nutrition entries |
| `daily_nutrition_rollups` | nutrition daily aggregates |
| `supplement_logs` | supplement intake events |
| `daily_supplement_rollups` | supplement daily aggregates |
| `symptom_logs` | subjective symptom entries |
| `daily_subjective_rollups` | subjective daily aggregates |
| `lab_markers` | parsed lab marker values (mobile side) |
| `daily_baselines` | per-user rolling baselines |
| `daily_scores` | computed daily scores |
| `detected_patterns` | pattern-detection outputs |
| `correlations` | correlation-engine outputs |
| `daily_recommendations` | generated recommendations |
| `practitioner_flags` | items flagged for practitioner attention |
| `notification_queue` | outbound notifications |
| `app_settings` | per-user settings |
| `questionnaire_responses` | onboarding questionnaire |
| `clinical_intakes` | intake data |
| `lifestyle_profiles` | lifestyle questionnaire |
| `contraindications` | contraindication records |
| `protocols` | assigned protocols |
| `daily_adherence` | protocol adherence |
| `hormone_entries` | hormone tracking |
| `lab_panels` | lab panel groupings (mobile side) |

Additional table referenced by edge functions but **not** in the generated
types: **`webhook_events`** (written by `app-webhooks`). Its absence from the
types file suggests the generated types are stale relative to the live schema —
another reason to re-pull.

## B. Practitioner / clinic domain (10 tables, code-referenced only)

Used by the `clinic` tRPC router. **Not in `types/database.ts`, no committed
DDL.** Names are the actual `clinic_`-prefixed identifiers the code queries
(the arch doc describes the same tables **without** the prefix — do not trust
the doc's names).

| Table | Referenced in | Notable columns (from mappers) |
| --- | --- | --- |
| `clinic_patients` | patients, dashboard, labs, alerts | `clinician_id`, `assigned_clinician_id`, demographics, `status`, `tags`, `created_by` |
| `clinic_health_histories` | patients | conditions, meds, allergies (JSON), `patient_id` unique |
| `clinic_lab_documents` | labs, patients | `storage_path`, `processing_status`, `uploaded_by` |
| `clinic_lab_results` | labs, patients | `value`, `unit`, `ref_range_*`, `status`, `lab_test_id` |
| `clinic_lab_tests` | labs | catalog: code, unit, ref/functional/critical ranges |
| `clinic_biometric_types` | biometrics | catalog: code, unit, normal/warning/critical |
| `clinic_biometric_readings` | biometrics, patients | `value`, `reading_time`, `status`, `source` |
| `clinic_patient_thresholds` | biometrics | per-patient glucose/BP thresholds |
| `clinic_alert_rules` | alerts | scope, trigger, condition (JSON), severity, channels |
| `clinic_alert_events` | alerts, dashboard, patients | rule_id, status, ack/resolve fields |

## C. Design-doc tables not yet in code (`CLINIC_BACKEND_ARCHITECTURE.md`)

The doc additionally specifies `encounters`, `care_plans`, `care_plan_tasks`,
`notifications`, and `audit_log` (with monthly partitions). No code references
these; treat as **planned, not built**.

## D. Storage

- `clinic_lab_documents.storage_path` implies a Supabase Storage bucket for
  lab files. Bucket name, privacy, and policies are **not in the repo**.
- Signed-URL issuance is a stub (`example.com`) — see security doc #13.

## E. Gaps vs. the target domain model

The platform prompt's required entities are almost entirely **absent**. Nothing
exists for: organizations/memberships/roles/permissions/clinics,
practitioner⇆patient relationships, invitations; consents/data-sharing/audit/
access/breach/export/deletion; the full clinical model
(conditions, symptoms, medications, encounters, clinical_notes); the labs
model (`biomarker_definitions`, `reference_ranges`, `extraction_jobs`, …);
supplements knowledge graph; programs; assessments; reasoning
(`clinical_facts`, `hypotheses`, `reasoning_snapshots`); experiments; health
twin. The current `clinic_*` and mobile tables are a **starting subset** to be
migrated into the organization-first model, not the model itself.

### Required-column audit

The prompt requires every patient/org table to carry `id, organization_id,
patient_id?, source, source_record_id?, created_at, updated_at, created_by,
updated_by, deleted_at/superseded_at`, and observations to add
`observed_at, ingested_at, data_quality, confidence, provenance,
review_status, reviewed_by, reviewed_at`.

Today: clinic tables have `id/created_at/updated_at/created_by` and some
`_by` fields, **no `organization_id`, no `source/source_record_id`, no
soft-delete columns, no provenance/review columns**. `raw_health_events` does
carry provider/source/`provider_record_id`/`recorded_at` (good provenance
precedent to generalize).

## F. Immediate, non-destructive next step

1. `supabase db pull` against `utuszztwwadvoxxuyshn` → commit the real baseline
   migration.
2. `supabase gen types typescript` → refresh `types/database.ts` (will reveal
   `clinic_*`, `webhook_events`, and true RLS-relevant columns).
3. Snapshot **which tables have RLS enabled and their policies** (query
   `pg_policies`) into this doc. Until then, RLS status = **unknown**.
