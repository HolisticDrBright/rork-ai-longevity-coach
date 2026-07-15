# Current Architecture — Phase 0 Audit

> **Status:** As-built inventory of `HolisticDrBright/rork-ai-longevity-coach`
> at commit `7f1be03`, produced during the Phase 0 repository audit for the
> Clinical Intelligence platform evolution. This is a *description of what
> exists*, not a target design. No code or database changes were made during
> the audit. Companion documents: [`database-inventory.md`](./database-inventory.md),
> [`security-gap-analysis.md`](./security-gap-analysis.md),
> [`desktop-platform-roadmap.md`](./desktop-platform-roadmap.md).

## 1. Repository shape

Single-app monorepo. Everything lives under `expo/`; the repo root holds only
marketing/legal HTML, a backend Dockerfile, and `rork.json`.

```
expo/
  app/                    Expo Router routes (mobile + RN-web)
    (tabs)/               patient-facing tabs (index, analysis, hormones, labs,
                          insights, protocol, tracking, profile)
      (nutrition)/        nutrition sub-stack
      (wearables)/        wearables sub-stack
      (clinic)/           practitioner surface (dashboard, patients, patient/[id],
                          alerts, supplements-admin)
    onboarding/           questionnaire, lifestyle
    practitioner/         apply / index (role request)
    auth.tsx, signin.tsx, modal.tsx, _layout.tsx
  backend/                Hono + tRPC server (deployed separately)
    hono.ts, server.ts, sentry-middleware.ts, supabase-server.ts
    trpc/                 app-router, create-context, routes/{clinic,nutrition,supplements}
  providers/              10 React context providers (app state / data access)
  lib/                    supabase, trpc, config, secureStorage, auditLog,
                          breachDetection, webhooks, sentry
  services/health/        Junction/Vital client + health service
  supabase/
    migrations/           1 file — EMPTY (see §6)
    functions/            3 Deno edge functions (junction-webhook, app-webhooks,
                          rollup-biometrics)
  types/                  database.ts (generated), clinic.ts, wearables.ts, …
  __tests__/clinic/       7 vitest files (fully mocked Supabase)
  docs/CLINIC_BACKEND_ARCHITECTURE.md   design doc (aspirational; see §6)
```

## 2. Confirmed stack

| Layer | Technology | Notes |
| --- | --- | --- |
| Mobile / web client | Expo SDK 54, Expo Router 6, React Native 0.81, React 19, react-native-web | `newArchEnabled: true`, typed routes |
| Language | TypeScript 5.9 | |
| API | Hono 4 + tRPC 11 (`@hono/trpc-server`), superjson transformer | single endpoint `/api/trpc` |
| Client data | TanStack Query 5 + `@trpc/react-query`; Zustand 5; `@nkzw/create-context-hook` | |
| Validation | Zod 4 | used on tRPC inputs; **not** on outputs |
| Auth / DB | Supabase (`@supabase/supabase-js` 2.99) | Postgres + Auth + Storage |
| AI | `@rork-ai/toolkit-sdk`, Vercel `ai` SDK, direct OpenAI REST | see §5 |
| Wearables | Vital / "Junction" (`@tryvital/*` 6) | webhook → edge function |
| Nutrition | Passio (`api.passiolife.com`) | server-side, in nutrition router |
| Monitoring | Sentry (`@sentry/react-native`, `@sentry/node`) | |
| Runtime/deploy | Bun; Fly.io (two apps, `sin` region); Docker | see §7 |
| Tests | Vitest 4 | clinic routers only, Supabase mocked |

The core stack the platform prompt asked to preserve (Expo, Expo Router, RN,
TS, Supabase, Hono, tRPC, TanStack Query, Zustand, Zod, Vercel AI SDK, Vital,
Sentry) is **all present and confirmed**.

## 3. Two disjoint data domains

The codebase contains **two essentially separate systems** that share an auth
provider but almost no tables:

### 3a. Patient/consumer app ("mobile" domain)
- Drives the `(tabs)` patient experience.
- Backed by ~29 Postgres tables (see `database-inventory.md`): `profiles`,
  `raw_health_events`, `daily_biometric_records`, `meal_logs`,
  `supplement_logs`, `lab_markers`, `hormone_entries`, `protocols`,
  `daily_scores`, `detected_patterns`, `correlations`, etc.
- Wearable data flows: Vital → `junction-webhook` edge function →
  `raw_health_events` → `rollup-biometrics` edge function →
  `daily_biometric_records` → analytical reads.
- Much app state is held in providers and persisted **on-device** (see §4),
  not always server-authoritative.

### 3b. Practitioner clinic ("clinic" domain)
- Drives `app/(tabs)/(clinic)/*` and the `clinic` tRPC router.
- Backed by a **separate** `clinic_*` table namespace: `clinic_patients`,
  `clinic_health_histories`, `clinic_lab_documents`, `clinic_lab_results`,
  `clinic_lab_tests`, `clinic_biometric_types`, `clinic_biometric_readings`,
  `clinic_patient_thresholds`, `clinic_alert_rules`, `clinic_alert_events`.
- These tables are **not** in the generated `types/database.ts` and have **no
  committed migration** (see §6).

**Implication for the platform work:** the target multi-tenant model
(organizations → clinics → practitioners → patients) does not yet exist in
either domain. There is a `clinician_id` column on clinic rows and a
`user_roles` / `practitioner_flags` notion on the mobile side, but no
`organizations`, `organization_memberships`, or
`practitioner_patient_relationships` tables. The two domains will need to be
unified onto the shared organization-first model rather than extended
independently.

## 4. Client state & providers

Ten providers under `expo/providers/`:

| Provider | Server-backed? | On-device persistence |
| --- | --- | --- |
| `SupabaseAuthProvider` | yes (Supabase auth) | session in AsyncStorage (§ security) |
| `AuthProvider` | local only | PIN hash + biometric flag in `expo-secure-store` |
| `HIPAAProvider` | local only | consent record in AsyncStorage |
| `UserProvider` | server-backed | `secureStorage` (XOR — see security doc) |
| `LabsProvider` (1254 LoC) | server-backed + direct OpenAI | `secureStorage` |
| `HormoneProvider` | server-backed | `secureStorage` |
| `NutritionProvider` | server-backed | `secureStorage` |
| `ProtocolProvider` | server-backed | `secureStorage` + AsyncStorage |
| `SupplementsProvider` | local only | `secureStorage` |
| `WearablesProvider` | local only | in-memory / service reads |

**Health information currently held primarily client-side** (a Phase-0
question from the prompt): supplement catalog & click stats (the
`supplements` tRPC router is a stub that returns "retrieved from client-side
storage" — see §5), wearable connection UI state, HIPAA consent record, and
any provider data cached through `secureStorage` before/without a server
round-trip. Lab **analysis** results are generated on-device and stored via
`secureStorage`.

## 5. API surface & AI calls

### tRPC routers (`backend/trpc/app-router.ts`)
Three routers today: `nutrition`, `clinic`, `supplements`.

- **`clinic`** (routers: `patients`, `labs`, `biometrics`, `alerts`,
  `dashboard`): all procedures are `protectedProcedure`. Each builds a
  per-request Supabase client from the caller's bearer token
  (`createServerSupabaseClient(ctx.sessionToken)`) — so reads/writes run as
  the user and depend on **database RLS** for isolation (see security doc for
  why that is currently unverifiable). Authorization is **inconsistent**:
  `patients.getById`, `.update`, `.delete`, `.getTimeline`,
  `.getHealthHistory` filter only by row `id`, while `patients.getTags`,
  `.exportRecord`, and parts of `labs`/`alerts` additionally filter by
  `clinician_id = ctx.user.id`. There is no shared authorization helper.
- **`nutrition`**: all procedures are **`publicProcedure`** (unauthenticated).
  Calls the Passio API server-side using `PASSIO_API_KEY` (server env).
- **`supplements`**: `protectedProcedure`, but every handler is a **stub** —
  returns `{ success, message: 'retrieved from client-side storage' }` and
  does no DB work. The real supplement catalog lives in the client
  (`mocks/curatedProducts.ts`, `SupplementsProvider`).

Two handlers return **placeholder URLs** instead of real signed URLs:
`labs.getDownloadUrl` → `https://example.com/signed/...?token=xxx`, and
`patients.exportRecord` → `https://example.com/exports/pending`. File
signed-URL issuance and record export are therefore **not implemented**.

### AI call sites
- **`LabsProvider.tsx` uploads lab PDFs directly from the client to OpenAI**
  (`https://api.openai.com/v1/files`, `/v1/chat/completions`,
  `/v1/responses`) using `EXPO_PUBLIC_OPENAI_API_KEY`, and also talks to a
  Rork "toolkit" gateway (`createGateway`) with
  `EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY`. Model IDs referenced: `gpt-4.1`,
  `openai/gpt-5-mini`. PHI (raw lab documents) leaves the device straight to
  a third party; see security doc for the key-exposure and BAA implications.
- **`components/ClinicalAIAssistant.tsx`** uses `useRorkAgent` from the
  toolkit SDK with a large system prompt; it already includes cautious-language
  guardrails ("use *may/could/suggests*, recommend consulting a provider").
- **`utils/wearables/aiInsightComposer.ts`** uses `generateObject` (toolkit)
  for wearable insights.
- **`utils/nutrition/*`** — meal text parse / audio transcribe helpers.

There is **no** structured-output validation, prompt/version recording, or
knowledge-versioning around these AI calls yet (all required by the target
AI-orchestration spec).

## 6. Database schema is not in version control

The single migration file
`expo/supabase/migrations/20260506081122_remote_schema.sql` is **0 bytes**.
Consequences:

- The live schema exists **only in the remote Supabase project**
  (`.temp/project-ref` → `utuszztwwadvoxxuyshn`, "Dr. Bright's Project") and
  partially in the generated `types/database.ts` (mobile tables only).
- The `clinic_*` tables have **no schema artifact at all** in the repo — not
  in migrations, not in `types/database.ts`. Their shape is only inferable
  from the router code and `types/clinic.ts`.
- `docs/CLINIC_BACKEND_ARCHITECTURE.md` contains hand-written DDL, but it
  describes tables named `patients`, `lab_results`, `audit_log`, etc.
  (**without** the `clinic_` prefix the code actually uses) and its
  "Security & Compliance Checklist" is entirely unchecked. It is a design
  document, not the deployed schema.

This is the single most important structural finding: **there is no
reproducible, reviewable source of truth for the database.** RLS policies,
constraints, and indexes cannot be audited from the repo, and no migration
can be safely written until the current remote schema is captured. This
blocks the platform prompt's "versioned SQL migrations, RLS on every table"
requirement at step one.

## 7. Deployment topology

- **Two Fly.io apps** (both `primary_region = 'sin'`, 1 GB shared-cpu,
  `auto_stop_machines`, `min_machines_running = 0`):
  - `backend-wispy-rain-3825` (from `expo/backend/fly.toml`)
  - `expo-sunlit-resonance-4543` (from `expo/fly.toml`)
- **Three Dockerfiles**: repo-root `Dockerfile` and `expo/backend/Dockerfile`
  both build the Bun backend and run `bun run backend/server.ts`; `expo/Dockerfile`
  is a Fly "launch" image for the Expo side.
- **Server** (`backend/server.ts`) uses `@hono/node-server` on `PORT` (3000),
  exposes `GET /` and `GET /health`.
- **Edge functions** deploy to Supabase separately (`supabase functions deploy`).
- `min_machines_running = 0` means cold starts; acceptable for the mobile
  backend but worth noting for a desktop practitioner app expecting low latency.

## 8. Environment variables

Documented in `expo/backend/ENV.md` (server) and discovered in code (client).
Full inventory with the exposure problem is in the security doc; summary:

- **Server-only (safe):** `PASSIO_API_KEY`, `PASSIO_BASE_URL`,
  `JUNCTION_WEBHOOK_SIGNING_SECRET`, `WEBHOOK_URL`, `PORT`, `NODE_ENV`,
  `APP_VERSION`.
- **`EXPO_PUBLIC_*` (bundled into the shipped client):**
  `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (expected
  public), **plus `EXPO_PUBLIC_OPENAI_API_KEY`,
  `EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY`, `EXPO_PUBLIC_VITAL_API_KEY`,
  `EXPO_PUBLIC_WEBHOOK_SECRET`** — these last four are secrets that should
  never ship to a client. See `security-gap-analysis.md` §1.

## 9. Tests

`expo/__tests__/clinic/` — 7 Vitest files covering the clinic routers
(`patients`, `labs`, `biometrics`, `alerts`, `dashboard`, `utils`). They call
the routers through `createCaller` with a **fully mocked** Supabase client
(`test-helpers.ts` / `setup.ts` return chainable stubs). This validates
request/response mapping and handler branching, but:

- **RLS is never exercised** (it lives in Postgres, which is mocked away).
- There are **no cross-tenant / unauthorized-access tests**.
- The `nutrition` and `supplements` routers, the edge functions, and all
  client providers have **no tests**.

## 10. What already exists toward the target (don't rebuild)

- Working Expo patient app with nutrition, labs, hormones, wearables, protocol.
- Working clinic tRPC surface with per-request user-scoped Supabase clients.
- Wearable ingestion pipeline (webhook → raw → rollup) with HMAC verification
  on the Junction webhook.
- Client-side HIPAA scaffolding: consent provider, PIN/biometric lock, an
  on-device audit-log and breach-detection module, a `secureStorage` wrapper
  (cipher is weak — see security doc), and PHI-purge on logout.
- Sentry wiring with a `sentry-middleware` and a `beforeSend`-style scrubber
  (effectiveness reviewed in the security doc).

These are the assets to build **on top of**, per the prompt's "do not rewrite
from scratch" constraint.
