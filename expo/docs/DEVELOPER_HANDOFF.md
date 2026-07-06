# Developer Handoff — July 2026 Overhaul

**Branch:** `claude/competitive-analysis-app-review-rtwzdg`
**Base:** `main` · 12 commits · all work verified: `tsc --noEmit` clean,
**209/209 vitest tests passing**, `expo lint` 0 errors.

This branch is a full audit-and-fix pass of the app (~60 confirmed bugs),
a security overhaul, a navigation redesign, and the new adaptive wearable
UI for the Junction (Vital) integration. Review it as one PR or commit by
commit — each commit is a self-contained workstream with a descriptive
message.

---

## The commits, in order

| Commit | What it does |
|---|---|
| `423ac48` | **Foundation.** New server-side tRPC routers `ai` + `integrations` (`backend/trpc/routes/ai.ts`) so OpenAI and Vital API keys never ship in the app bundle. Shared helpers: `lib/ui/appAlert.ts` (Alert.alert is a silent no-op on react-native-web — this makes dialogs work everywhere) and `utils/date.ts` (UTC-safe date parsing, clock-time math). |
| `57d5cd6` | **Labs/AI vertical.** Fixes the two bugs that broke *every* lab analysis: a gateway URL built from the API key (image path) and a use-before-declaration swallowed by a catch (PDF path always returned "Analysis temporarily unavailable"). All lab AI now flows through `trpc.ai.*`. Implements `crossLabSynthesis`/`allBiomarkers`/`runCrossLabSynthesis` (the Labs screen referenced these; saving a 2nd panel used to throw). |
| `6c6bcbf` | **Clinical engines** (`utils/wearables/`). Hypoglycemia no longer scores as healthy; bedtime/circadian features parse ISO datetimes (they were dead — `parseInt` returned 2026); trend %s un-inverted; baselines exclude today; weekend detection timezone-correct; fabricated correlations removed; missing data excluded rather than imputed healthy. +31 regression tests in `__tests__/wearables/`. |
| `c3cd29c` | **Backend security.** Fail-closed svix webhook verification; auth + rate limiting + size caps on nutrition AI routes; Passio key no longer logged; PostgREST `.or()` injection closed; clinician ownership scoping; audit fields from `ctx.user.id`; **RLS migration** (`supabase/migrations/20260702000000_rls_policies.sql`); clinic test mocks fixed (14 failing → 170 green). |
| `304f830` | **Storage/state.** UTF-8-safe encrypted storage (saves crashed on "μIU/mL" and photos); auth tokens moved to SecureStore; lost-update races fixed in 5 providers; upserts get conflict targets (no more duplicate rows); PIN lockout persists + salted hashing; HIPAA purge keeps its audit trail; offline edits no longer clobbered on token refresh. |
| `e67da6c` | Lab panel sync passes stable id. |
| `a7536ca` | **Screens.** Deep links no longer discarded (`+native-intent`); web-safe dialogs everywhere; practitioner self-approval closed (applications are now honestly `pending`; picking "Practitioner" at sign-in no longer unlocks the clinic portal); Add Patient flow built; dead controls wired or removed; AI chat no longer renders the injected health-context blob in user bubbles; onboarding DOB validation; status-bar visibility; accessibility labels on the PIN pad and modals. |
| `51fe933` | **Navigation: 9 tabs → 5.** Today · Health `(health)` = Insights/Analysis/Labs/Wearables · Log `(log)` = Track/Nutrition · Protocol · Profile (+ Clinic, clinician-only). `components/SectionSwitcher.tsx` provides the pill nav; legacy deep-link paths are rewritten in `+native-intent.tsx`. |
| `06cd3b9` | **Wearable capability registry** — `constants/wearableCapabilities.ts`. THE file to know: maps every metric → record fields, display metadata, metric group, Junction resources, and per-provider capabilities. Screens render by metric availability (`live`/`expected`/`locked`), never by device type. |
| `350ec21` | `docs/WEARABLE_DATA_GUIDE.md` — data-flow guide (read this first). |
| `958f798` | Normalization mappings for the new provider types (Dexcom, Libre, Omron, Withings, Polar, Eight Sleep). |
| `56b9256` | **Adaptive wearable UI.** Connections = categorized device catalog with capability chips + per-provider deep-link into Junction Link; Dashboard renders live metric groups, "waiting for first sync" placeholders, and compact unlock rows; Trends picker filters to available metrics. Webhook/rollup now route glucose, BP, SpO₂, resp rate, HR/HRV, weight/fat, temperature, water, caffeine, VO₂ max, workouts, steps, stress, cycle phase. +8 tests. |

## Orientation: the five files to read first

1. `docs/WEARABLE_DATA_GUIDE.md` — wearable pipeline end to end.
2. `constants/wearableCapabilities.ts` — controls everything the wearable UI shows.
3. `backend/trpc/routes/ai.ts` — how the app talks to OpenAI/Vital now (never call them from the client).
4. `backend/ENV.md` — every env var, server and edge-function.
5. `supabase/migrations/20260702000000_rls_policies.sql` — tenant isolation.

## Deployment checklist (blockers before release)

1. **Rotate keys**: the old `EXPO_PUBLIC_OPENAI_API_KEY`, `EXPO_PUBLIC_VITAL_API_KEY`, and the Passio key shipped inside distributed bundles/logs — treat all three as compromised. Set the new *server-side* `OPENAI_API_KEY`, `VITAL_API_KEY`, `VITAL_ENV` per `backend/ENV.md` and remove the `EXPO_PUBLIC_` variants from build profiles.
2. **Edge-function secrets** (now fail-closed — functions refuse requests without them): `JUNCTION_WEBHOOK_SIGNING_SECRET`, `APP_WEBHOOK_SECRET`, `ROLLUP_SECRET`. Point Junction's webhook at the `junction-webhook` function.
3. **Apply the RLS migration** in the Supabase SQL editor (idempotent; every block guarded with `to_regclass`, safe to re-run). Then verify: `select tablename, rowsecurity from pg_tables where schemaname='public';`
4. **Native dev build** for wearables: Junction/Vital SDK does not run in Expo Go or web preview — `expo run:ios` or an EAS dev-client build.
5. **End-to-end sync test**: connect a real Oura/Whoop, confirm data lands in `raw_health_events` → `daily_biometric_records` → dashboard. Field names and units in live Junction payloads are the highest-risk unknowns; the rollup mapping is in `supabase/functions/rollup-biometrics/index.ts`.

## Known deferred items

- **Full dark mode** — `constants/colors.ts` is light-only; a proper dark palette needs a systematic restyle pass across ~40 screens.
- **In-app lab ordering** (Rupa/Fullscript/Vibrant) — needs partner API accounts before any code.
- **Practitioner application review** — applications now save as `pending` with an honest under-review UI, but there is no admin approval flow yet; approving currently requires setting the role manually.
- Local record ids (`log_…`, `panel_…`) are non-UUID strings; if the corresponding Supabase id columns are `uuid`-typed, row sync fails silently (wrapped in try/catch). Verify column types against the live schema.

## Testing

```bash
cd expo
bun install
npx tsc --noEmit        # clean
npx vitest run          # 209 tests, 11 files
npx expo lint           # 0 errors
```

Engine regression tests live in `__tests__/wearables/` — they encode the
clinical-logic bugs found in the audit (glucose severity, ISO bedtimes,
baseline exclusion, trend direction, affiliate matching, capability
availability). Add to them whenever touching `utils/wearables/`.
