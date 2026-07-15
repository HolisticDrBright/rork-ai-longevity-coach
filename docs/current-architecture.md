# AI Longevity Pro — Current Architecture (Audit)

_Audited: 2026-07-15. Branch: `claude/longevity-pro-platform-upgrade-gk6t8f`._

## 1. Stack

| Layer | Technology | Notes |
|---|---|---|
| Client | Expo SDK 54 / React Native 0.81 / React 19, Expo Router 6 (file-based) | Single codebase for iOS/Android/Web (`react-native-web`) |
| Client state | `@nkzw/create-context-hook` providers + TanStack Query 5 | `zustand` is installed but unused |
| Backend | Hono 4 + tRPC 11 (`expo/backend`), Bun runtime | Deployed to Fly.io (`backend/fly.toml`, Dockerfile) |
| Database | Supabase Postgres (remote project `utuszztwwadvoxxuyshn`) | **Schema is not in the repo** — `supabase/migrations/20260506081122_remote_schema.sql` is empty |
| Auth | Supabase Auth (email/password, magic link) + local 6-digit PIN / biometric gate | Session JWT forwarded to tRPC as bearer token |
| Storage | Supabase Storage (lab files), AsyncStorage + expo-secure-store locally | Local values XOR-obfuscated (`lib/secureStorage.ts`) |
| Edge functions | Supabase Deno functions: `app-webhooks`, `junction-webhook`, `rollup-biometrics` | Wearable ingestion + event webhooks |
| AI | OpenAI direct (`gpt-4.1` PDFs, `gpt-4o-mini-transcribe` voice) + Rork toolkit gateway (`openai/gpt-5-mini` images, chat, meal parsing, wearable insights) | Called **from the client** with `EXPO_PUBLIC_*` keys |
| Wearables | Junction/Vital SDK v6 (stubbed until custom dev build), webhook → raw events → daily rollups | Source-precedence merge (Oura > Whoop > Garmin > …) |
| Nutrition | Passio API via backend tRPC (`nutrition.*`) | Photo/vision, barcode, search, diet-compliance scoring |
| Observability | Sentry (client + backend middleware), `react-native-network-logger` | |
| Tests | Vitest — 169 tests over clinic tRPC routes and pure utils | Baseline: 155 pass / 14 fail (stale Supabase mocks); ~29 pre-existing `tsc` errors (mostly Deno edge functions) |

## 2. Application structure

```
expo/
  app/                    # Expo Router routes
    (tabs)/               # Patient app: Today, Insights, Analysis, Protocol,
                          #   (nutrition), (wearables), Track, Labs, Profile
    (tabs)/(clinic)/      # Clinician portal: dashboard, patients, patient/[id],
                          #   alerts, supplements-admin
    onboarding/           # Demographics → lifestyle → symptom questionnaire
    practitioner/         # Practitioner landing + self-serve credentialing
    auth.tsx, signin.tsx  # PIN gate, Supabase sign-in + role choice
  backend/                # Hono + tRPC (nutrition, clinic, supplements routers)
  providers/              # 10 context providers (auth, user, labs, protocol, …)
  services/health/        # Wearables service + Junction/Vital client
  utils/wearables/        # Deterministic engines: baseline, scoring, patterns,
                          #   correlations, trends, recommendations, AI composer
  utils/nutrition/        # Meal text parsing (LLM), audio transcription
  supabase/               # Edge functions; migrations dir (EMPTY schema)
  types/                  # Domain models (index, clinic, database, wearables, supplements)
  mocks/                  # Curated supplement catalog, questionnaire, peptides, food rules
  __tests__/              # Vitest suites for clinic routes
```

## 3. Data model (reconstructed — schema lives only in the remote DB)

**Patient-app tables** (per `types/database.ts`, all keyed by `user_id`): `profiles`, `user_roles` (`user|practitioner|admin`), `health_goals`, `wearable_connections`, `raw_health_events`, `daily_biometric_records` (~60 metric columns), `meal_logs`, `daily_nutrition_rollups`, `supplement_logs`, `daily_supplement_rollups`, `symptom_logs`, `daily_subjective_rollups`, `lab_markers`, `lab_panels` (biomarkers as JSON), `daily_baselines`, `daily_scores`, `detected_patterns`, `correlations`, `daily_recommendations`, `practitioner_flags`, `notification_queue`, `app_settings`, `questionnaire_responses`, `clinical_intakes`, `lifestyle_profiles`, `contraindications`, `protocols`, `daily_adherence`, `hormone_entries`, `webhook_events`.

**Clinic tables** (per tRPC queries, all carry `clinician_id`): `clinic_patients`, `clinic_health_histories`, `clinic_lab_documents`, `clinic_lab_results`, `clinic_lab_tests`, `clinic_biometric_types`, `clinic_biometric_readings`, `clinic_patient_thresholds`, `clinic_alert_rules`, `clinic_alert_events`.

Two parallel worlds exist: the **patient app** (local-first secure storage mirrored to `user_id`-scoped tables) and the **clinic portal** (practitioner-owned `clinic_*` records). There is **no link** between a clinic patient record and an app user account, and no consent/sharing model between them.

## 4. Auth, roles, and access control

- Layer 1: Supabase session (email/password, magic link). Layer 2: local PIN + biometrics with lockout and 5-min inactivity relock. Layer 3: HIPAA consent gate + breach banner.
- Role is chosen on the sign-in screen, stored client-side, synced to `profiles`; `practitioner/apply.tsx` self-serve credentialing **auto-approves** clinician role.
- tRPC `protectedProcedure` checks only that a session exists. **No server-side role check** anywhere; clinic routes scope rows by `clinician_id = ctx.user.id` and otherwise rely on RLS policies that are not versioned in the repo.
- `nutrition.*` routes are `publicProcedure` (unauthenticated Passio proxy).

## 5. AI surface (today)

| Call site | Model / endpoint | Shape |
|---|---|---|
| `providers/LabsProvider.tsx` PDF path | OpenAI Files + `gpt-4.1` chat completions (temp 0, JSON mode) | 2-pass extraction (verbatim transcription → enrichment), then one giant 8-section "master prompt" free-text analysis |
| `LabsProvider` image path | Rork gateway `openai/gpt-5-mini` | `generateObject` with zod `labExtractionSchema`, batches of 4 images |
| `insights.tsx`, `ClinicalAIAssistant` | `useRorkAgent` chat | Context string (disorders, flagged biomarkers, scores) prepended per message |
| `utils/nutrition/parseMealText.ts` | Rork toolkit `generateObject` | Meal text → structured food items |
| `utils/nutrition/transcribeAudio.ts` | OpenAI `gpt-4o-mini-transcribe` | Voice → text |
| `utils/wearables/aiInsightComposer.ts` | Rork toolkit `generateObject` | Daily wellness guidance, local fallback |

All LLM calls run **on the client**, with keys in `EXPO_PUBLIC_*` env vars (present in the shipped bundle). Lab PDFs (PHI) are uploaded from the device directly to OpenAI. No AI call logging, no prompt/template versioning, no output validation ledger, no practitioner review of AI output.

## 6. Deterministic intelligence (today)

`utils/wearables/*` is a genuine deterministic pipeline: baselines (7/14/30-day), 7 composite scores, z-score pattern detection, lagged Pearson correlations, rule-based recommendations, escalation flags (`practitioner_flags`). The clinic backend has a real threshold/pattern alert engine with dedupe windows. `SupplementsProvider` has a rule-based recommendation engine with contraindication/interaction checks against a curated catalog. These are the strongest foundations to build the reasoning layer on.

## 7. Security & privacy posture

Present: PIN/biometric app lock, consent gate, client-side audit log with SHA-256 checksums, breach-detection heuristics, PHI purge, secure headers on the backend, HMAC-verified wearable webhooks, Sentry scrubbing (in `sentry-middleware.ts`).

Gaps (detailed in the gap analysis): client-held AI keys, PHI to third-party AI from the device, no server-side RBAC, RLS not versioned in repo, audit log is device-local and clearable, XOR obfuscation ≠ encryption, self-approved practitioner role, no tenant/org model, no consent-scoped practitioner↔patient sharing.

## 8. What must be preserved

1. All patient-app features: Today/protocol adherence, insights & risk scores, TCM/functional analysis, labs upload + AI interpretation, nutrition (Passio + diets), wearables pipeline, hormones, peptides, supplements + affiliate flow, onboarding, PIN/consent gates.
2. Clinic portal: dashboard, patients, patient detail (labs/biometrics/alerts/timeline), alert rules/inbox, supplements admin.
3. The wearable ingestion chain (webhook → raw events → rollups) and source-precedence logic.
4. Existing visual style (Colors constants, card patterns) and Expo Router structure.
5. The vitest suite and its mock harness for clinic routes.
