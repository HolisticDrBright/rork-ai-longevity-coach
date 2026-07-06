# Findings → Fixes Traceability

**Branch:** `claude/competitive-analysis-app-review-rtwzdg`
**Companion docs:** `DEVELOPER_HANDOFF.md` (commit-by-commit guide), `WEARABLE_DATA_GUIDE.md` (data pipeline).

This document maps every finding from the July 2026 audit to its fix on this
branch, so each item can be reviewed against the exact commit that resolved
it. Review order suggestion: read the audit finding, open the commit, check
the diff for the listed files, run the listed test where one exists.

Verification state of the branch head: `npx tsc --noEmit` clean ·
`npx vitest run` **209/209** · `npx expo lint` **0 errors**.

Commits referenced below:

| Hash | Workstream |
|---|---|
| `423ac48` | Foundation: server-side AI/Vital proxy, web-safe alerts, date helpers |
| `57d5cd6` | Labs/AI vertical |
| `6c6bcbf` | Clinical/wearables engines + regression tests |
| `c3cd29c` | Backend security |
| `304f830` | Storage/state layer |
| `e67da6c` | Lab panel sync id |
| `a7536ca` | Screens/UX |
| `51fe933` | Tab bar consolidation |
| `06cd3b9` `350ec21` `958f798` `56b9256` | Wearable capability registry, guide, normalization, adaptive UI |

---

## Critical — "the feature is silently broken"

| # | Finding | Fix | Files | Commit |
|---|---|---|---|---|
| 1 | Image lab analysis wired to a malformed URL (`TOOLKIT_URL` was assigned the OpenAI API key) — every screenshot analysis failed | All lab AI rerouted through authenticated backend procedures (`trpc.ai.promptWithImages` etc.); the gateway and bundled key are gone | `providers/LabsProvider.tsx`, `backend/trpc/routes/ai.ts` | `57d5cd6` + `423ac48` |
| 2 | PDF analysis always returned the fallback text (temporal-dead-zone `ReferenceError` on `labAnalysisPrompt`, swallowed by catch) | Prompt hoisted to a module-level constant; PDF branch now produces a real analysis | `providers/LabsProvider.tsx` | `57d5cd6` |
| 3 | Bedtime/sleep-timing feature family dead: engines parsed ISO datetimes as `HH:MM` (`parseInt("2026-07-01T23") = 2026`) — bedtime-consistency pinned at 0, circadian/bedtime-drift patterns could never fire | `parseClockHour`/`clockDistanceHours` helpers handle ISO + `HH:MM` + midnight wraparound; all four engines converted | `utils/date.ts`, `utils/wearables/scoringEngine.ts`, `baselineEngine.ts`, `patternDetection.ts`, `notificationEngine.ts` | `423ac48` + `6c6bcbf` |
| 4 | Hypoglycemia scored as healthy (glucose 55 → 70/positive, better than 115) | Tiered `scoreGlucose`: <54→10, 54–69→30, 70–100→95, 101–110→70, 111–125→50, >125→30. Test: glucose 55 must score <50/negative | `utils/wearables/scoringEngine.ts`, `__tests__/wearables/scoringEngine.test.ts` | `6c6bcbf` |
| 5 | Every trend % showed the mirror image of reality (oldest/newest swapped) | Fixed `computeChangePercent`, exported from trendEngine, provider imports it; direction test added | `utils/wearables/trendEngine.ts`, `providers/WearablesProvider.tsx`, `__tests__/wearables/trendEngine.test.ts` | `6c6bcbf` |
| 6 | Today's value polluted its own baseline with the highest weight (illness alerts stopped firing when elevation became sustained) | Baselines exclude the current day by default; recency weighting corrected; test asserts exclusion | `utils/wearables/baselineEngine.ts`, `__tests__/wearables/baselineEngine.test.ts` | `6c6bcbf` |
| 7 | All deep links discarded (`+native-intent` returned `'/'` unconditionally) | Pass-through with try/catch fallback; plus legacy→new path rewrites after the tab restructure | `app/+native-intent.tsx` | `a7536ca` + `51fe933` |

## Critical — security / trust

| # | Finding | Fix | Files | Commit |
|---|---|---|---|---|
| 8 | Secret keys shipped in the client bundle (`EXPO_PUBLIC_OPENAI_API_KEY`, `EXPO_PUBLIC_VITAL_API_KEY`, webhook secret) | All third-party calls moved behind `protectedProcedure` tRPC routes; Vital Link uses short-lived server-generated tokens. **Action still required: rotate all three keys** (see `backend/ENV.md`) | `backend/trpc/routes/ai.ts`, `providers/LabsProvider.tsx`, `services/health/junctionClient.ts`, `utils/nutrition/transcribeAudio.ts` | `423ac48` + `57d5cd6` |
| 9 | PHI (lab PDFs) uploaded to api.openai.com directly from the device | Same server-side rerouting — PHI now flows only through the authenticated backend | as above | `57d5cd6` |
| 10 | Webhooks failed open (skipped verification when the secret was unset), wrong signature scheme (hex HMAC vs svix), replayable, attacker-controlled `user_id`/`email` | Fail-closed on missing secrets; real svix verification (constant-time, 300s tolerance); `rollup-biometrics` now requires `x-rollup-secret`; UUID validation on `user_id`. **Action required: set the three edge-function secrets** | `supabase/functions/junction-webhook/index.ts`, `app-webhooks/index.ts`, `rollup-biometrics/index.ts` | `c3cd29c` |
| 11 | "Verified clinician" was self-approval (`status:'approved'` written instantly; picking Practitioner at sign-in unlocked the clinic portal) | Applications now save as `pending` with an honest under-review UI; sign-in role choice routes to the application, grants nothing. **Deferred: an admin approval flow does not exist yet** | `app/practitioner/apply.tsx`, `app/practitioner/index.tsx`, `app/signin.tsx` | `a7536ca` |
| 12 | RLS unverifiable — 0-byte schema migration, no `CREATE POLICY` anywhere, while every clinic query depends on RLS for tenant isolation | Idempotent RLS migration covering all clinic_*, profile, and user-data tables; plus defense-in-depth `clinician_id` scoping added in the routes themselves. **Action required: apply the migration to the live project and verify** | `supabase/migrations/20260702000000_rls_policies.sql`, `backend/trpc/routes/clinic/*.ts` | `c3cd29c` |
| 13 | `PASSIO_API_KEY` logged on every nutrition call; AI endpoints unauthenticated, no rate limits, unbounded payloads | Key logging deleted (**rotate the key**); all nutrition procedures `protectedProcedure`; sliding-window rate limiter on `/api/trpc`; zod size caps; prod CORS allow-list | `backend/trpc/routes/nutrition.ts`, `backend/hono.ts` | `c3cd29c` |

## High — data integrity & correctness

| Finding | Fix | Files | Commit |
|---|---|---|---|
| XOR storage corrupted real data (`btoa` threw on "μIU/mL", RangeError on photos, web key lost per session) | Chunked UTF-8-safe encoding; web key persisted; legacy formats still readable and migrated on read | `lib/secureStorage.ts` | `304f830` |
| Lost-update races (checking supplement A then B dropped A) | Ref-mirror pattern in all five affected providers | `providers/Protocol/Hormone/Nutrition/User/SupplementsProvider.tsx` | `304f830` |
| Upserts without conflict targets inserted duplicate rows; syncs pushed "the newest element"; deletes never propagated | Conflict targets per table (`id` / `user_id` / `user_id,provider`); changed-record sync; delete propagation | `lib/supabaseService.ts`, providers | `304f830` + `e67da6c` |
| "Delete all my data" deleted its own audit trail and left remote PHI | Purge retains the audit log and best-effort deletes the user's remote rows | `providers/HIPAAProvider.tsx`, `lib/secureStorage.ts` | `304f830` |
| `Alert.alert` is a no-op on web (~10 dead flows) | `showAlert`/`confirmAsync` cross-platform layer used everywhere | `lib/ui/appAlert.ts` + all screens | `423ac48` + `a7536ca` + `57d5cd6` |
| UTC date parsing shifted weekdays/dates west of UTC; weekend detection hit Sun+Mon | Local-time date helpers used across screens and engines | `utils/date.ts`, `app/(tabs)/index.tsx`, labs screen, `trendEngine.ts` | `423ac48` + `a7536ca` + `6c6bcbf` |
| Fabricated insights (hardcoded workout correlation; daily "You've logged 1500ml" for users who never log hydration) | Correlation computed from actual next-day data with a real threshold; hydration only fires on logged data | `utils/wearables/patternDetection.ts`, `notificationEngine.ts` | `6c6bcbf` |
| Affiliate misattribution ("Phosphatidylcholine" → Fullscript via `choline` substring) | Word-boundary matching, longest-keyword-wins; tested | `constants/affiliateLinks.ts`, `__tests__/wearables/affiliateLinks.test.ts` | `6c6bcbf` |
| Dead controls (profile rows, Add Patient FAB, breach banner) | Wired (Add Patient modal built on `clinic.patients.create`) or removed | `app/(tabs)/profile.tsx`, `app/(tabs)/(clinic)/patient/new.tsx`, `app/_layout.tsx` | `a7536ca` |
| PIN lockout reset on force-quit; unsalted PIN hash | Persisted lockout, expiry reset, per-device salted hash with legacy upgrade | `providers/AuthProvider.tsx` | `304f830` |
| 14 failing tests (mock missing `.maybeSingle`), zero engine coverage | Mock fixed; 39 new engine/capability tests. Suite: 209/209 | `__tests__/` | `c3cd29c` + `6c6bcbf` + `56b9256` |
| ~20 tsc errors, 16 lint errors | All resolved; branch is clean | various | all |

## UI recommendations — status

| Recommendation | Status | Where |
|---|---|---|
| Tab bar 9 → 5 | ✅ Done — Today · Health · Log · Protocol · Profile (+Clinic) with pill sub-nav | `51fe933`, `app/(tabs)/`, `components/SectionSwitcher.tsx` |
| Cross-platform dialog layer | ✅ Done | `423ac48`, `lib/ui/appAlert.ts` |
| Dead hormones screen / duplicate surfaces | ✅ Hormones duplicate deleted. ⚠️ Peptide-education duplication and the Protocol mega-scroll split are **not done** | `a7536ca` |
| Status bar visibility | ✅ Done (dark default, light on gradient screens). ⚠️ Full **dark mode not done** — colors.ts is still light-only | `a7536ca` |
| Header standardization | ⚠️ Partial — the `marginTop:150` hack is fixed; the two header systems still coexist | `a7536ca` |
| Accessibility | ⚠️ Partial — PIN pad, modal closes, FABs labeled; a full sweep remains | `a7536ca` |
| AI chat (context leak, streaming states) | ✅ Done | `a7536ca`, `app/(tabs)/(health)/insights.tsx` |
| Trend color semantics | ✅ Done (status-aware in labs; goodness-colored arrows in wearables; `lowerIsBetter` in the registry) | `57d5cd6`, `a7536ca`, `06cd3b9` |
| Onboarding polish | ⚠️ Partial — DOB validated, email prefilled; native date picker and non-auto-advancing questionnaire **not done** | `a7536ca` |
| Clinic portal (FAB, verification gate) | ⚠️ Partial — FAB + honest pending state done; per-query error/retry states and an admin approval flow **not done** | `a7536ca` |

## Beyond the audit: adaptive wearable UI (new feature)

Junction (Vital) is connected; the UI now adapts to whatever each device
sends via a capability registry (`live`/`expected`/`locked` per metric).
Commits `06cd3b9` → `56b9256`; read `WEARABLE_DATA_GUIDE.md` and
`constants/wearableCapabilities.ts`.

## Still open (needs product/ops decisions or external accounts)

1. Rotate the three exposed API keys; set server + edge-function secrets (`backend/ENV.md`).
2. Apply + verify the RLS migration on the live Supabase project.
3. Native dev build (Vital SDK doesn't run in Expo Go) + one end-to-end device sync test.
4. Admin flow for approving practitioner applications.
5. Full dark mode; Protocol screen split; full accessibility sweep.
6. In-app lab ordering (Rupa/Fullscript/Vibrant) — needs partner APIs.
7. Verify local record id columns vs `uuid` types in the live schema (non-UUID local ids fail row-sync silently).
