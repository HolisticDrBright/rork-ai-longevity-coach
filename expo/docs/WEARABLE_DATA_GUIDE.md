# Wearable Data Guide (for developers)

How wearable data flows through AI Longevity Pro: what we receive, where it
lives, where it's displayed, and what gets triggered from it.

---

## 1. What data we receive

Junction (Vital) is the single integration point. Devices differ wildly in
what they send, so **never branch UI on device type** — branch on metric
availability via `constants/wearableCapabilities.ts` (see §3).

### Metrics promoted to first-class daily columns

These land in `daily_biometric_records` (one row per user per day) and drive
all analytics:

| Group | Metrics (record fields) | Typical sources |
|---|---|---|
| Recovery | HRV (`hrv`), resting HR (`resting_hr`), device readiness (`readiness_score`), strain/training load, device stress | Oura, WHOOP, Garmin, Apple Watch |
| Sleep | duration, deep/REM/light minutes, efficiency, latency, WASO, awakenings, sleep score, `bedtime`/`wake_time` (ISO datetimes) | Oura, WHOOP, Fitbit, Apple Health, Eight Sleep |
| Activity | steps, distance, calories, active minutes, workouts (`workout_minutes`/`workout_type`), VO₂ max | Apple Health, Garmin, Fitbit, WHOOP |
| Metabolic | CGM glucose (`glucose_avg`, mg/dL — mmol/L converted at ingest), hydration (`hydration_ml`), caffeine (`caffeine_mg`) | Dexcom, FreeStyle Libre, Apple Health |
| Cardiovascular | blood pressure (`blood_pressure_systolic/diastolic`), average HR | Omron, Withings, Apple Health |
| Respiratory | respiratory rate, SpO₂ | Oura, WHOOP, Garmin, Apple Watch |
| Body | weight, body fat %, skin temp / temp deviation | Withings, Oura, smart scales |
| Cycle | cycle phase + day estimate | Oura, Apple Health |

### Everything else

Junction exposes ~70 resource types (ECG voltage, AFib burden, spirometry,
falls, UV exposure, stand hours, wheelchair pushes, insulin injections…).
Resources we don't yet promote are **still stored raw** in
`raw_health_events` — nothing is dropped. To promote one later: add a
`MetricDefinition` to `wearableCapabilities.ts`, map it in
`rollup-biometrics`, and the UI picks it up automatically.

---

## 2. The pipeline (file by file)

```
Junction webhook (svix-signed POST)
  └─ supabase/functions/junction-webhook/index.ts
       verifies signature (fail-closed) → upserts raw_health_events
       → invokes rollup with x-rollup-secret
  └─ supabase/functions/rollup-biometrics/index.ts
       normalizes units (sec→min, mmol→mg/dL) → upserts daily_biometric_records
  └─ services/health/healthService.ts        (user-scoped reads)
  └─ hooks/useHealthData.ts                  (react-query keys, shared)
  └─ providers/WearablesProvider.tsx         (state + derived analytics)
       ├─ utils/wearables/baselineEngine.ts      7/14/30-day baselines (today excluded)
       ├─ utils/wearables/scoringEngine.ts       5 composite daily scores
       ├─ utils/wearables/patternDetection.ts    multi-day patterns + correlations
       ├─ utils/wearables/trendEngine.ts         regressions, weekday/weekend splits
       ├─ utils/wearables/notificationEngine.ts  user nudges + practitioner flags
       ├─ utils/wearables/recommendationEngine.ts daily plan adjustments
       └─ utils/wearables/aiInsightComposer.ts   evidence bundle for AI insights
```

Missing data is **excluded, not imputed**: score factors with null inputs get
weight 0 and the remaining weights renormalize, so a CGM-only user gets an
honest metabolic score instead of one padded with fake healthy defaults.

---

## 3. Where the data is displayed

| Surface | What it shows |
|---|---|
| **Health ▸ Wearables ▸ Dashboard** | Hero composite scores (Recovery, Sleep, Stress Load, Metabolic Resilience, Nervous-System Balance) + adaptive metric-group cards. Groups render only when **live**; connected-but-unsynced groups show "waiting for first sync"; unmeasured groups collapse to one-line "connect a device" hints. |
| **Health ▸ Wearables ▸ Trends** | Per-metric charts (7/14/30d) with direction-aware coloring (lower RHR/glucose/BP = green). Picker lists only live metrics. |
| **Health ▸ Wearables ▸ Connections** | Device catalog by category with capability chips (what each device will contribute), plus per-connection "what's actually syncing" state. |
| **Health ▸ Wearables ▸ Plan / Insights-detail** | Recommendation engine output and expanded pattern explanations. |
| **Today tab** | Weekly trend strip + today's readiness context feeding the daily checklist. |
| **Health ▸ Insights (AI chat)** | Wearable summary is injected as hidden context so answers are personalized. |
| **Clinic portal (practitioners)** | `PractitionerFlag`s surface in the alert inbox (severity-ranked); patient detail shows biometric readings and glucose stats. |

## 4. Purpose & workflow once collected

The product thesis (per the competitive teardown): **turn nightly wearable
data into clinical pattern detection and doctor-ready evidence** — not a
single score.

1. **Baseline** — rolling 7/14/30-day personal baselines per metric
   (`baselineEngine`), today excluded so it can't mask its own anomaly.
2. **Deviation** — today vs baseline, classified none/mild/moderate/significant
   with direction-aware logic (elevated RHR bad, elevated HRV good).
3. **Score** — five composite scores with transparent factor breakdowns
   (every card can show *why*).
4. **Pattern** — multi-day detection: overreaching, circadian drift,
   sleep disruption, metabolic stress, chronic inflammation signal,
   cycle-aware context (luteal-phase recovery dips are labeled normal, not
   alarmed) — plus behavior↔outcome correlations (alcohol → next-morning
   HRV, late caffeine → sleep latency, workout intensity → next-day
   readiness) computed from the user's own data.
5. **Action** — see §5.
6. **Evidence** — patterns + deviations feed the AI insight composer and the
   doctor-ready report generation; practitioner review gates anything
   clinical.

## 5. Triggered actions, analytics, features

**User-facing nudges** (`notificationEngine`, deduped, dismissed state
persists):
- RHR elevated vs baseline (sustained multi-day → escalates)
- HRV suppressed → recovery-day suggestion
- Bedtime drift >90 min across 3 nights → circadian nudge
- Sleep debt accumulation; hydration/caffeine only when actually logged

**Clinical escalations** (`PractitionerFlag` → clinic alert inbox):
- BP ≥140/90 flag; **BP ≥180/120 critical** — advise immediate medical attention
- Glucose scoring treats hypoglycemia (<70, critical <54) as high-severity
- Chronic-inflammation signal (persistent temp deviation + RHR + HRV pattern)

**Protocol integration**:
- Recovery/readiness adjusts the daily plan (training intensity, fasting
  suitability); cycle phase gates fasting recommendations for women
- Wearable trends are pulled into lab cross-analysis and the Month-6
  outcome report (before/after deltas)

**Rules for extending**: always compare to the user's own baseline (not
population norms); phrase insights as "associated with", never diagnostic
causation; anything treatment-adjacent goes through practitioner review;
never impute missing data as healthy.

---

## 6. Adding a new metric (checklist)

1. Add the column mapping in `rollup-biometrics/index.ts` (unit-normalize!)
   and `healthService.ts` row mapper (+ DB column if needed).
2. Add a `MetricDefinition` in `constants/wearableCapabilities.ts`
   (fields, group, `lowerIsBetter`, junctionResources, provider lists).
3. Optional: baseline field in `baselineEngine`, score factor in
   `scoringEngine`, rules in `patternDetection`/`notificationEngine`.
4. Add a regression test in `__tests__/wearables/` (unit conversion and
   direction semantics are where bugs live — see git history).
