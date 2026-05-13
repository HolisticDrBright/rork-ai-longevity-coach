/**
 * Supabase Edge Function: Compute daily_scores
 *
 * For (userId, date), reads today's biometrics + subjective rollup +
 * adherence + nutrition rollup, plus the user's daily_baseline, and
 * computes composite scores:
 *   - recovery_score (0-100): how recovered are you today vs baseline
 *   - recovery_status: 'green' (>= 70) / 'yellow' (40-69) / 'red' (< 40)
 *   - sleep_score_computed (0-100)
 *   - stress_load_score (0-100, higher = more stressed)
 *   - metabolic_resilience_score (0-100)
 *   - adherence_score (0-100, from daily_adherence)
 *   - nervous_system_balance_score (0-100, HRV trend + stress)
 *   - inflammation_strain_score (0-100, higher = more strain)
 *   - confidence_score (0-100, how complete the input data was)
 *
 * Heuristic, not ML-trained. Designed to be deterministic and explainable;
 * scoring_inputs_json captures every input value so users / clinicians can
 * audit "why was today's recovery flagged red".
 *
 * Trigger:
 *   - Called automatically by compute-baselines after baseline updates
 *   - Scheduled cron daily
 *
 * Deploy: supabase functions deploy compute-scores
 * Invoke: supabase.functions.invoke('compute-scores', { body: { userId, date } })
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

interface BiometricRow {
  hrv: number | null;
  resting_hr: number | null;
  sleep_duration_minutes: number | null;
  sleep_efficiency: number | null;
  sleep_score: number | null;
  deep_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  respiratory_rate: number | null;
  temp_deviation: number | null;
  steps: number | null;
  active_minutes: number | null;
}
interface SubjectiveRow {
  energy_avg: number | null;
  stress_avg: number | null;
  soreness_avg: number | null;
  mood_avg: number | null;
}
interface BaselineRow {
  sleep_duration_baseline: number | null;
  sleep_efficiency_baseline: number | null;
  sleep_score_baseline: number | null;
  hrv_baseline: number | null;
  resting_hr_baseline: number | null;
  respiratory_rate_baseline: number | null;
  energy_baseline: number | null;
  stress_baseline: number | null;
}
interface NutritionRow {
  total_protein_g: number | null;
  total_fiber_g: number | null;
  meal_timing_score: number | null;
  protein_distribution_score: number | null;
  alcohol_units: number | null;
  caffeine_mg: number | null;
  inflammatory_load_total: number | null;
  glycemic_load_total: number | null;
  eating_window_minutes: number | null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function ratioToScore(actual: number | null, baseline: number | null, higherIsBetter: boolean): number | null {
  if (actual == null || baseline == null || baseline === 0) return null;
  const ratio = actual / baseline;
  if (higherIsBetter) {
    // 100 = at or above baseline, scaled down as you fall below
    return clamp(Math.round(ratio * 100), 0, 100);
  }
  // lower is better: 100 when actual <= baseline; falls as actual rises
  return clamp(Math.round((2 - ratio) * 100), 0, 100);
}

function inputCompleteness(values: Array<unknown>): number {
  const filled = values.filter(v => v != null).length;
  return Math.round((filled / values.length) * 100);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: { userId: string; date: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { userId, date } = body;
  if (!userId || !date) {
    return new Response(
      JSON.stringify({ error: 'userId and date required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const [bioRes, subjRes, baselineRes, nutritionRes, adherenceRes] = await Promise.all([
    sb.from('daily_biometric_records').select('*').eq('user_id', userId).eq('date', date).maybeSingle(),
    sb.from('daily_subjective_rollups').select('*').eq('user_id', userId).eq('date', date).maybeSingle(),
    sb.from('daily_baselines').select('*').eq('user_id', userId).eq('date', date).maybeSingle(),
    sb.from('daily_nutrition_rollups').select('*').eq('user_id', userId).eq('date', date).maybeSingle(),
    sb.from('daily_adherence').select('completion_percent').eq('user_id', userId).eq('date', date),
  ]);

  const bio = (bioRes.data as BiometricRow | null) ?? null;
  const subj = (subjRes.data as SubjectiveRow | null) ?? null;
  const baseline = (baselineRes.data as BaselineRow | null) ?? null;
  const nutrition = (nutritionRes.data as NutritionRow | null) ?? null;
  const adherenceRows = (adherenceRes.data as { completion_percent: number | null }[] | null) ?? [];

  // ── individual sub-scores ─────────────────────────────────
  const sleep_score_computed = bio?.sleep_score
    ?? (bio?.sleep_efficiency != null && bio?.sleep_duration_minutes != null
        ? Math.round(bio.sleep_efficiency * (clamp(bio.sleep_duration_minutes / 480, 0, 1)))
        : null);

  const hrvScore = ratioToScore(bio?.hrv ?? null, baseline?.hrv_baseline ?? null, true);
  const rhrScore = ratioToScore(bio?.resting_hr ?? null, baseline?.resting_hr_baseline ?? null, false);
  const sleepDurScore = ratioToScore(bio?.sleep_duration_minutes ?? null, baseline?.sleep_duration_baseline ?? null, true);

  // recovery: HRV + RHR + sleep_score average
  const recoveryParts = [hrvScore, rhrScore, sleepDurScore, sleep_score_computed].filter((v): v is number => v != null);
  const recovery_score = recoveryParts.length > 0
    ? Math.round(recoveryParts.reduce((s, v) => s + v, 0) / recoveryParts.length)
    : null;
  const recovery_status =
    recovery_score == null ? null :
    recovery_score >= 70 ? 'green' :
    recovery_score >= 40 ? 'yellow' :
    'red';

  // stress load: subjective stress + low HRV
  const stressInputs: number[] = [];
  if (subj?.stress_avg != null) stressInputs.push(subj.stress_avg * 10); // 0-10 scale → 0-100
  if (hrvScore != null) stressInputs.push(100 - hrvScore);
  const stress_load_score = stressInputs.length > 0
    ? Math.round(stressInputs.reduce((s, v) => s + v, 0) / stressInputs.length)
    : null;

  // metabolic resilience: protein adequacy + meal timing + low alcohol + sleep
  const metabolicParts: number[] = [];
  if (nutrition?.total_protein_g != null) {
    metabolicParts.push(clamp(Math.round(nutrition.total_protein_g / 1.2), 0, 100));
  }
  if (nutrition?.meal_timing_score != null) metabolicParts.push(nutrition.meal_timing_score);
  if (nutrition?.alcohol_units != null) metabolicParts.push(clamp(100 - nutrition.alcohol_units * 30, 0, 100));
  if (sleep_score_computed != null) metabolicParts.push(sleep_score_computed);
  const metabolic_resilience_score = metabolicParts.length > 0
    ? Math.round(metabolicParts.reduce((s, v) => s + v, 0) / metabolicParts.length)
    : null;

  // adherence: average completion across all of today's adherence rows
  const adherence_score = adherenceRows.length > 0
    ? Math.round(adherenceRows
        .filter(r => r.completion_percent != null)
        .reduce((s, r) => s + (r.completion_percent ?? 0), 0)
        / Math.max(1, adherenceRows.filter(r => r.completion_percent != null).length))
    : null;

  // nervous-system balance: HRV (parasympathetic) high - stress
  const nervous_system_balance_score =
    hrvScore != null && stress_load_score != null
      ? Math.round((hrvScore + (100 - stress_load_score)) / 2)
      : (hrvScore ?? (stress_load_score != null ? 100 - stress_load_score : null));

  // inflammation strain: temp deviation, resp rate, soreness
  const inflammationParts: number[] = [];
  if (bio?.temp_deviation != null) {
    inflammationParts.push(clamp(Math.round(Math.abs(bio.temp_deviation) * 50), 0, 100));
  }
  if (subj?.soreness_avg != null) inflammationParts.push(subj.soreness_avg * 10);
  if (nutrition?.inflammatory_load_total != null) {
    inflammationParts.push(clamp(Math.round(nutrition.inflammatory_load_total), 0, 100));
  }
  const inflammation_strain_score = inflammationParts.length > 0
    ? Math.round(inflammationParts.reduce((s, v) => s + v, 0) / inflammationParts.length)
    : null;

  // confidence: how much input data was actually present
  const confidence_score = inputCompleteness([
    bio?.hrv, bio?.sleep_duration_minutes, bio?.resting_hr, bio?.sleep_score,
    subj?.energy_avg, subj?.stress_avg,
    baseline?.hrv_baseline, baseline?.sleep_duration_baseline,
    nutrition?.total_protein_g, nutrition?.meal_timing_score,
    adherence_score,
  ]);

  const row = {
    user_id: userId,
    date,
    recovery_score,
    recovery_status,
    sleep_score_computed,
    stress_load_score,
    metabolic_resilience_score,
    adherence_score,
    nervous_system_balance_score,
    inflammation_strain_score,
    confidence_score,
    scoring_inputs_json: {
      bio: bio ?? null,
      subj: subj ?? null,
      baseline: baseline ?? null,
      nutrition: nutrition ?? null,
      adherence_rows: adherenceRows,
      sub_scores: { hrvScore, rhrScore, sleepDurScore },
    },
    updated_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await sb
    .from('daily_scores')
    .upsert(row, { onConflict: 'user_id,date' });

  if (upsertErr) {
    console.error('[compute-scores] upsert failed', upsertErr);
    return new Response(
      JSON.stringify({ error: upsertErr.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  console.log(`[compute-scores] ${userId}/${date}: recovery=${recovery_score} (${recovery_status}) confidence=${confidence_score}`);

  // Fan out → detect-patterns
  void fetch(`${SUPABASE_URL}/functions/v1/detect-patterns`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, date }),
  }).catch(e => console.error('[compute-scores] detect-patterns fan-out failed', e));

  return new Response(
    JSON.stringify({
      status: 'ok',
      userId,
      date,
      recovery_score,
      recovery_status,
      confidence_score,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
