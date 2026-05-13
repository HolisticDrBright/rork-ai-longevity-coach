/**
 * Supabase Edge Function: Compute correlations
 *
 * For a user, computes Pearson correlations over the last N days between
 * curated pairs of variables and writes them to public.correlations. The
 * UI surfaces these as "what's actually moving the needle for you" insights.
 *
 * Pairs computed (a → b means: today's a vs next-day b, with lag of 1):
 *   - sleep_score → next-day energy_avg
 *   - sleep_duration → next-day energy_avg
 *   - hrv → next-day recovery_score
 *   - caffeine_mg → same-day stress_avg
 *   - caffeine_mg → next-day sleep_score
 *   - alcohol_units → next-day sleep_score
 *   - alcohol_units → next-day hrv
 *   - eating_window → next-day energy_avg
 *   - inflammatory_load → next-day soreness_avg
 *   - active_minutes → next-day sleep_score
 *   - meal_timing_score → next-day energy_avg
 *   - protein_distribution_score → next-day soreness_avg (recovery)
 *
 * Strength bucketing (|r|): >=0.5 strong, >=0.3 moderate, >=0.15 weak,
 * else discarded. Direction: positive / negative. Confidence by sample size.
 *
 * Append-only writes (correlations table is keyed by computed_at, not
 * upserted). The UI sorts by computed_at desc.
 *
 * Trigger:
 *   - Scheduled cron weekly (or daily for engaged users)
 *
 * Deploy: supabase functions deploy compute-correlations
 * Invoke: supabase.functions.invoke('compute-correlations', { body: { userId, windowDays } })
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const DEFAULT_WINDOW_DAYS = 30;
const MIN_SAMPLES = 7;

interface Pair {
  variable_a: string;
  variable_b: string;
  lag: 0 | 1; // 0 = same day, 1 = next day
}

const PAIRS: Pair[] = [
  { variable_a: 'sleep_score', variable_b: 'energy_avg', lag: 1 },
  { variable_a: 'sleep_duration_minutes', variable_b: 'energy_avg', lag: 1 },
  { variable_a: 'hrv', variable_b: 'recovery_score', lag: 1 },
  { variable_a: 'caffeine_mg', variable_b: 'stress_avg', lag: 0 },
  { variable_a: 'caffeine_mg', variable_b: 'sleep_score', lag: 1 },
  { variable_a: 'alcohol_units', variable_b: 'sleep_score', lag: 1 },
  { variable_a: 'alcohol_units', variable_b: 'hrv', lag: 1 },
  { variable_a: 'eating_window_minutes', variable_b: 'energy_avg', lag: 1 },
  { variable_a: 'inflammatory_load_total', variable_b: 'soreness_avg', lag: 1 },
  { variable_a: 'active_minutes', variable_b: 'sleep_score', lag: 1 },
  { variable_a: 'meal_timing_score', variable_b: 'energy_avg', lag: 1 },
  { variable_a: 'protein_distribution_score', variable_b: 'soreness_avg', lag: 1 },
];

// ────────────────────────────────────────────────────────────
// Pearson correlation
// ────────────────────────────────────────────────────────────

function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < MIN_SAMPLES) return null;
  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += xs[i]; sumY += ys[i]; }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

function strengthBucket(r: number): 'weak' | 'moderate' | 'strong' | null {
  const abs = Math.abs(r);
  if (abs >= 0.5) return 'strong';
  if (abs >= 0.3) return 'moderate';
  if (abs >= 0.15) return 'weak';
  return null;
}

function confidenceBucket(n: number): 'low' | 'moderate' | 'high' {
  if (n >= 21) return 'high';
  if (n >= 14) return 'moderate';
  return 'low';
}

// ────────────────────────────────────────────────────────────
// Variable lookup: pulls a value from any of the daily tables
// ────────────────────────────────────────────────────────────

interface DailyData {
  bio: Map<string, Record<string, number | null>>;
  subj: Map<string, Record<string, number | null>>;
  scores: Map<string, Record<string, number | null>>;
  nutrition: Map<string, Record<string, number | null>>;
}

function getVariable(data: DailyData, name: string, date: string): number | null {
  // Try each table in turn
  const fromBio = data.bio.get(date)?.[name];
  if (typeof fromBio === 'number') return fromBio;
  const fromSubj = data.subj.get(date)?.[name];
  if (typeof fromSubj === 'number') return fromSubj;
  const fromScores = data.scores.get(date)?.[name];
  if (typeof fromScores === 'number') return fromScores;
  const fromNut = data.nutrition.get(date)?.[name];
  if (typeof fromNut === 'number') return fromNut;
  return null;
}

function buildSeries(data: DailyData, dates: string[], pair: Pair): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const d of dates) {
    const x = getVariable(data, pair.variable_a, d);
    if (x == null) continue;
    let yDate = d;
    if (pair.lag > 0) {
      const dt = new Date(d);
      dt.setUTCDate(dt.getUTCDate() + pair.lag);
      yDate = dt.toISOString().slice(0, 10);
    }
    const y = getVariable(data, pair.variable_b, yDate);
    if (y == null) continue;
    xs.push(x);
    ys.push(y);
  }
  return { xs, ys };
}

function summary(pair: Pair, r: number, n: number): string {
  const direction = r > 0 ? 'positively correlated' : 'negatively correlated';
  const lagDesc = pair.lag === 0 ? '(same day)' : `(${pair.lag}-day lag)`;
  return `${pair.variable_a} and ${pair.variable_b} are ${direction} ${lagDesc} for you (r=${r.toFixed(2)}, n=${n}).`;
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: { userId: string; windowDays?: number };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { userId } = body;
  const windowDays = body.windowDays ?? DEFAULT_WINDOW_DAYS;
  if (!userId) {
    return new Response(
      JSON.stringify({ error: 'userId required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - windowDays);
  const startStr = start.toISOString().slice(0, 10);

  const [bioRes, subjRes, scoresRes, nutRes] = await Promise.all([
    sb.from('daily_biometric_records')
      .select('date, sleep_duration_minutes, sleep_score, hrv, resting_hr, active_minutes')
      .eq('user_id', userId)
      .gte('date', startStr)
      .lte('date', today),
    sb.from('daily_subjective_rollups')
      .select('date, energy_avg, stress_avg, soreness_avg, mood_avg')
      .eq('user_id', userId)
      .gte('date', startStr)
      .lte('date', today),
    sb.from('daily_scores')
      .select('date, recovery_score, sleep_score_computed, stress_load_score, inflammation_strain_score')
      .eq('user_id', userId)
      .gte('date', startStr)
      .lte('date', today),
    sb.from('daily_nutrition_rollups')
      .select('date, total_protein_g, eating_window_minutes, caffeine_mg, alcohol_units, inflammatory_load_total, meal_timing_score, protein_distribution_score')
      .eq('user_id', userId)
      .gte('date', startStr)
      .lte('date', today),
  ]);

  const data: DailyData = {
    bio: new Map(((bioRes.data as Record<string, number | null>[] | null) ?? []).map(r => [r.date as unknown as string, r])),
    subj: new Map(((subjRes.data as Record<string, number | null>[] | null) ?? []).map(r => [r.date as unknown as string, r])),
    scores: new Map(((scoresRes.data as Record<string, number | null>[] | null) ?? []).map(r => [r.date as unknown as string, r])),
    nutrition: new Map(((nutRes.data as Record<string, number | null>[] | null) ?? []).map(r => [r.date as unknown as string, r])),
  };

  // Build the date-axis: every day in the window
  const dates: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(startStr);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const computedAt = new Date().toISOString();
  const insertRows: Array<{
    user_id: string;
    computed_at: string;
    variable_a: string;
    variable_b: string;
    time_window_days: number;
    direction: string;
    strength: string;
    confidence: string;
    sample_size: number;
    summary: string;
    evidence_json: Record<string, unknown>;
  }> = [];

  for (const pair of PAIRS) {
    const { xs, ys } = buildSeries(data, dates, pair);
    if (xs.length < MIN_SAMPLES) continue;
    const r = pearson(xs, ys);
    if (r == null) continue;
    const strength = strengthBucket(r);
    if (!strength) continue;
    insertRows.push({
      user_id: userId,
      computed_at: computedAt,
      variable_a: pair.variable_a,
      variable_b: pair.variable_b,
      time_window_days: windowDays,
      direction: r > 0 ? 'positive' : 'negative',
      strength,
      confidence: confidenceBucket(xs.length),
      sample_size: xs.length,
      summary: summary(pair, r, xs.length),
      evidence_json: { r, lag_days: pair.lag, xs_n: xs.length, ys_n: ys.length },
    });
  }

  if (insertRows.length === 0) {
    return new Response(
      JSON.stringify({ status: 'no_significant_correlations', userId, window_days: windowDays }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const { error: insertErr } = await sb.from('correlations').insert(insertRows);
  if (insertErr) {
    console.error('[compute-correlations] insert failed', insertErr);
    return new Response(
      JSON.stringify({ error: insertErr.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  console.log(`[compute-correlations] ${userId}: ${insertRows.length} significant correlations over ${windowDays}d`);

  return new Response(
    JSON.stringify({
      status: 'ok',
      userId,
      window_days: windowDays,
      correlations_written: insertRows.length,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
