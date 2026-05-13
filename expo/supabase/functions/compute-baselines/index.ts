/**
 * Supabase Edge Function: Compute daily_baselines
 *
 * For a given (userId, date), computes 7-day rolling averages of biometric
 * and subjective rollup values and upserts a daily_baselines row. The
 * baselines are what daily-coach + compute-scores + detect-patterns all
 * compare against when deciding "is today's HRV unusually low for this user".
 *
 * Window: previous 7 days INCLUDING today (so a fresh-onboarded user with
 * 1 day of data still gets a meaningful baseline = today's value).
 *
 * Trigger:
 *   - Called automatically by rollup-biometrics after each daily rollup
 *   - Scheduled cron once a day per user
 *
 * Deploy: supabase functions deploy compute-baselines
 * Invoke: supabase.functions.invoke('compute-baselines', { body: { userId, date } })
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const WINDOW_DAYS = 7;

interface BiometricRow {
  date: string;
  sleep_duration_minutes?: number | null;
  sleep_efficiency?: number | null;
  sleep_score?: number | null;
  hrv?: number | null;
  resting_hr?: number | null;
  respiratory_rate?: number | null;
  temp_deviation?: number | null;
  steps?: number | null;
  active_minutes?: number | null;
  bedtime?: string | null;
}

interface SubjectiveRow {
  date: string;
  energy_avg?: number | null;
  stress_avg?: number | null;
  soreness_avg?: number | null;
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 100) / 100;
}

function avgTime(values: Array<string | null | undefined>): string | null {
  // Average bedtime by minutes-of-day (handle wrap-around past midnight by
  // mapping 0-9 to 24-33).
  const minsOfDay = values
    .filter((v): v is string => typeof v === 'string' && v.length >= 5)
    .map(v => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return null;
      let m = d.getUTCHours() * 60 + d.getUTCMinutes();
      if (m < 10 * 60) m += 24 * 60; // wrap early-morning bedtimes
      return m;
    })
    .filter((m): m is number => m != null);
  if (minsOfDay.length === 0) return null;
  let avgMin = Math.round(minsOfDay.reduce((s, v) => s + v, 0) / minsOfDay.length);
  if (avgMin >= 24 * 60) avgMin -= 24 * 60;
  const hh = Math.floor(avgMin / 60).toString().padStart(2, '0');
  const mm = (avgMin % 60).toString().padStart(2, '0');
  return `${hh}:${mm}`;
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

  // window: WINDOW_DAYS-1 days back to today inclusive
  const windowStart = new Date(date);
  windowStart.setUTCDate(windowStart.getUTCDate() - (WINDOW_DAYS - 1));
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  const [bioRes, subjRes] = await Promise.all([
    sb.from('daily_biometric_records')
      .select('date, sleep_duration_minutes, sleep_efficiency, sleep_score, hrv, resting_hr, respiratory_rate, temp_deviation, steps, active_minutes, bedtime')
      .eq('user_id', userId)
      .gte('date', windowStartStr)
      .lte('date', date),
    sb.from('daily_subjective_rollups')
      .select('date, energy_avg, stress_avg, soreness_avg')
      .eq('user_id', userId)
      .gte('date', windowStartStr)
      .lte('date', date),
  ]);

  const bio = (bioRes.data as BiometricRow[] | null) ?? [];
  const subj = (subjRes.data as SubjectiveRow[] | null) ?? [];

  if (bio.length === 0 && subj.length === 0) {
    return new Response(
      JSON.stringify({ status: 'no_data', userId, date }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const row = {
    user_id: userId,
    date,
    baseline_window_days: WINDOW_DAYS,
    sleep_duration_baseline: avg(bio.map(b => b.sleep_duration_minutes)),
    sleep_efficiency_baseline: avg(bio.map(b => b.sleep_efficiency)),
    sleep_score_baseline: avg(bio.map(b => b.sleep_score)),
    hrv_baseline: avg(bio.map(b => b.hrv)),
    resting_hr_baseline: avg(bio.map(b => b.resting_hr)),
    respiratory_rate_baseline: avg(bio.map(b => b.respiratory_rate)),
    temp_deviation_baseline: avg(bio.map(b => b.temp_deviation)),
    steps_baseline: avg(bio.map(b => b.steps)),
    active_minutes_baseline: avg(bio.map(b => b.active_minutes)),
    readiness_baseline: null, // no readiness column on daily_biometric_records yet
    energy_baseline: avg(subj.map(s => s.energy_avg)),
    stress_baseline: avg(subj.map(s => s.stress_avg)),
    soreness_baseline: avg(subj.map(s => s.soreness_avg)),
    bedtime_baseline: avgTime(bio.map(b => b.bedtime)),
    hydration_baseline: null, // hydration tracked elsewhere
  };

  const { error: upsertErr } = await sb
    .from('daily_baselines')
    .upsert(row, { onConflict: 'user_id,date' });

  if (upsertErr) {
    console.error('[compute-baselines] upsert failed', upsertErr);
    return new Response(
      JSON.stringify({ error: upsertErr.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  console.log(`[compute-baselines] ${userId}/${date}: bio=${bio.length} subj=${subj.length}`);

  // Fan out → compute-scores
  void fetch(`${SUPABASE_URL}/functions/v1/compute-scores`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, date }),
  }).catch(e => console.error('[compute-baselines] compute-scores fan-out failed', e));

  return new Response(
    JSON.stringify({
      status: 'ok',
      userId,
      date,
      window_days: WINDOW_DAYS,
      bio_samples: bio.length,
      subj_samples: subj.length,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
