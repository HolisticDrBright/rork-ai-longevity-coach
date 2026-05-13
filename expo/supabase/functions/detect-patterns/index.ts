/**
 * Supabase Edge Function: Detect patterns
 *
 * Rule-based pattern detection over the last 7-14 days of a user's data.
 * Each rule produces (or removes) a row in detected_patterns keyed by
 * pattern_type. The daily-coach reads detected_patterns to surface
 * persistent issues that don't show up in a single-day snapshot.
 *
 * Detected patterns (all configurable in CONFIG):
 *   - sleep_debt: avg sleep <6.5h for 3+ consecutive days
 *   - stress_accumulation: stress_avg >7 for 3+ days
 *   - low_recovery_streak: recovery_status='red' for 2+ consecutive days
 *   - carb_restriction: total_carbs_g <100g for 3+ days
 *   - long_eating_window: eating_window_minutes > 14h for 3+ days
 *   - high_inflammation_strain: inflammation_strain_score > 70 for 3+ days
 *   - persistent_symptom: same symptom severity >=3 for 3+ days
 *   - dropping_adherence: adherence_score declining trend over 7 days
 *
 * Trigger:
 *   - Called by compute-scores after the day's scores update
 *   - Scheduled cron daily
 *
 * Deploy: supabase functions deploy detect-patterns
 * Invoke: supabase.functions.invoke('detect-patterns', { body: { userId, date } })
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CONFIG = {
  WINDOW_DAYS: 14,
  SLEEP_DEBT_HOURS: 6.5,
  SLEEP_DEBT_CONSECUTIVE: 3,
  STRESS_THRESHOLD: 7,
  STRESS_CONSECUTIVE: 3,
  LOW_RECOVERY_CONSECUTIVE: 2,
  CARB_RESTRICTION_G: 100,
  CARB_CONSECUTIVE: 3,
  EATING_WINDOW_MIN: 14 * 60,
  WINDOW_CONSECUTIVE: 3,
  INFLAMMATION_THRESHOLD: 70,
  INFLAMMATION_CONSECUTIVE: 3,
  SYMPTOM_THRESHOLD: 3,
  SYMPTOM_CONSECUTIVE: 3,
  ADHERENCE_DROP_THRESHOLD: 20, // points lost vs early-window avg
};

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface PatternHit {
  pattern_type: string;
  severity: 'low' | 'moderate' | 'high';
  confidence: 'low' | 'moderate' | 'high';
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function dateNDaysBack(date: string, n: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function consecutiveCount<T>(rows: T[], dateKey: keyof T, predicate: (r: T) => boolean, anchorDate: string): number {
  // Walk backwards from anchorDate. Stop when predicate fails or there's a date gap.
  const sorted = [...rows].sort((a, b) =>
    new Date(b[dateKey] as unknown as string).getTime() - new Date(a[dateKey] as unknown as string).getTime()
  );
  let expected = anchorDate;
  let streak = 0;
  for (const r of sorted) {
    const rd = r[dateKey] as unknown as string;
    if (rd !== expected) break;
    if (!predicate(r)) break;
    streak++;
    const d = new Date(expected);
    d.setUTCDate(d.getUTCDate() - 1);
    expected = d.toISOString().slice(0, 10);
  }
  return streak;
}

// ────────────────────────────────────────────────────────────
// Pattern detectors
// ────────────────────────────────────────────────────────────

function detectSleepDebt(bio: Array<{ date: string; sleep_duration_minutes: number | null }>, anchorDate: string): PatternHit | null {
  const streak = consecutiveCount(
    bio.filter(b => b.sleep_duration_minutes != null),
    'date',
    b => (b.sleep_duration_minutes ?? 0) < CONFIG.SLEEP_DEBT_HOURS * 60,
    anchorDate,
  );
  if (streak < CONFIG.SLEEP_DEBT_CONSECUTIVE) return null;
  const avgSleep = bio.slice(0, streak)
    .reduce((s, b) => s + (b.sleep_duration_minutes ?? 0), 0) / streak / 60;
  return {
    pattern_type: 'sleep_debt',
    severity: streak >= 5 ? 'high' : streak >= 4 ? 'moderate' : 'low',
    confidence: 'high',
    title: `${streak}-day sleep debt`,
    summary: `Average sleep ${avgSleep.toFixed(1)}h (target ≥7h) for ${streak} consecutive days. Compounding cognitive + recovery impact.`,
    evidence: { streak_days: streak, avg_sleep_hours: avgSleep, threshold_hours: CONFIG.SLEEP_DEBT_HOURS },
  };
}

function detectStressAccumulation(subj: Array<{ date: string; stress_avg: number | null }>, anchorDate: string): PatternHit | null {
  const streak = consecutiveCount(
    subj.filter(s => s.stress_avg != null),
    'date',
    s => (s.stress_avg ?? 0) >= CONFIG.STRESS_THRESHOLD,
    anchorDate,
  );
  if (streak < CONFIG.STRESS_CONSECUTIVE) return null;
  return {
    pattern_type: 'stress_accumulation',
    severity: streak >= 5 ? 'high' : 'moderate',
    confidence: 'moderate',
    title: `${streak}-day high-stress streak`,
    summary: `Self-reported stress ≥${CONFIG.STRESS_THRESHOLD}/10 for ${streak} consecutive days.`,
    evidence: { streak_days: streak, threshold: CONFIG.STRESS_THRESHOLD },
  };
}

function detectLowRecovery(scores: Array<{ date: string; recovery_status: string | null }>, anchorDate: string): PatternHit | null {
  const streak = consecutiveCount(
    scores.filter(s => s.recovery_status != null),
    'date',
    s => s.recovery_status === 'red',
    anchorDate,
  );
  if (streak < CONFIG.LOW_RECOVERY_CONSECUTIVE) return null;
  return {
    pattern_type: 'low_recovery_streak',
    severity: streak >= 4 ? 'high' : 'moderate',
    confidence: 'high',
    title: `${streak} red-recovery days in a row`,
    summary: `Recovery status has been 'red' (run-down) for ${streak} consecutive days. Consider a deload day or sleep priority intervention.`,
    evidence: { streak_days: streak },
  };
}

function detectCarbRestriction(nutr: Array<{ date: string; total_carbs_g: number | null }>, anchorDate: string): PatternHit | null {
  const streak = consecutiveCount(
    nutr.filter(n => n.total_carbs_g != null),
    'date',
    n => (n.total_carbs_g ?? 0) < CONFIG.CARB_RESTRICTION_G,
    anchorDate,
  );
  if (streak < CONFIG.CARB_CONSECUTIVE) return null;
  return {
    pattern_type: 'carb_restriction',
    severity: 'low',
    confidence: 'moderate',
    title: `${streak}-day carb restriction`,
    summary: `Daily carbs <${CONFIG.CARB_RESTRICTION_G}g for ${streak} days. Intentional or inadvertent? May affect thyroid output and sleep depth.`,
    evidence: { streak_days: streak, threshold_g: CONFIG.CARB_RESTRICTION_G },
  };
}

function detectLongEatingWindow(nutr: Array<{ date: string; eating_window_minutes: number | null }>, anchorDate: string): PatternHit | null {
  const streak = consecutiveCount(
    nutr.filter(n => n.eating_window_minutes != null),
    'date',
    n => (n.eating_window_minutes ?? 0) > CONFIG.EATING_WINDOW_MIN,
    anchorDate,
  );
  if (streak < CONFIG.WINDOW_CONSECUTIVE) return null;
  return {
    pattern_type: 'long_eating_window',
    severity: 'low',
    confidence: 'moderate',
    title: `${streak}-day long eating window`,
    summary: `Eating window > ${(CONFIG.EATING_WINDOW_MIN / 60).toFixed(0)}h for ${streak} days. Tightening to 10-12h supports metabolic health.`,
    evidence: { streak_days: streak, threshold_minutes: CONFIG.EATING_WINDOW_MIN },
  };
}

function detectInflammationStrain(scores: Array<{ date: string; inflammation_strain_score: number | null }>, anchorDate: string): PatternHit | null {
  const streak = consecutiveCount(
    scores.filter(s => s.inflammation_strain_score != null),
    'date',
    s => (s.inflammation_strain_score ?? 0) > CONFIG.INFLAMMATION_THRESHOLD,
    anchorDate,
  );
  if (streak < CONFIG.INFLAMMATION_CONSECUTIVE) return null;
  return {
    pattern_type: 'high_inflammation_strain',
    severity: streak >= 5 ? 'high' : 'moderate',
    confidence: 'moderate',
    title: `${streak}-day elevated inflammation strain`,
    summary: `Inflammation strain score >${CONFIG.INFLAMMATION_THRESHOLD} for ${streak} days. Likely contributors: temperature deviation, soreness, food inflammation load.`,
    evidence: { streak_days: streak, threshold: CONFIG.INFLAMMATION_THRESHOLD },
  };
}

function detectPersistentSymptoms(symptoms: Array<{ symptom_name: string; severity: number | null; logged_at: string }>): PatternHit[] {
  // Group by symptom_name → consecutive days at severity >= threshold
  const byName = new Map<string, Set<string>>();
  for (const s of symptoms) {
    if ((s.severity ?? 0) < CONFIG.SYMPTOM_THRESHOLD) continue;
    const day = s.logged_at.slice(0, 10);
    if (!byName.has(s.symptom_name)) byName.set(s.symptom_name, new Set());
    byName.get(s.symptom_name)!.add(day);
  }
  const hits: PatternHit[] = [];
  for (const [name, days] of byName) {
    if (days.size >= CONFIG.SYMPTOM_CONSECUTIVE) {
      hits.push({
        pattern_type: `persistent_symptom:${name.toLowerCase().replace(/\s+/g, '_')}`,
        severity: days.size >= 5 ? 'high' : 'moderate',
        confidence: 'moderate',
        title: `Persistent ${name}`,
        summary: `${name} severity ≥${CONFIG.SYMPTOM_THRESHOLD} on ${days.size} of the last ${CONFIG.WINDOW_DAYS} days.`,
        evidence: { symptom: name, days_count: days.size, threshold: CONFIG.SYMPTOM_THRESHOLD },
      });
    }
  }
  return hits;
}

function detectAdherenceDrop(scores: Array<{ date: string; adherence_score: number | null }>): PatternHit | null {
  const sorted = [...scores]
    .filter(s => s.adherence_score != null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  if (sorted.length < 6) return null;
  const half = Math.floor(sorted.length / 2);
  const earlyAvg = sorted.slice(0, half).reduce((s, r) => s + (r.adherence_score ?? 0), 0) / half;
  const recentAvg = sorted.slice(half).reduce((s, r) => s + (r.adherence_score ?? 0), 0) / (sorted.length - half);
  const drop = earlyAvg - recentAvg;
  if (drop < CONFIG.ADHERENCE_DROP_THRESHOLD) return null;
  return {
    pattern_type: 'dropping_adherence',
    severity: drop >= 40 ? 'high' : 'moderate',
    confidence: 'high',
    title: 'Adherence is dropping',
    summary: `Protocol adherence dropped from ~${Math.round(earlyAvg)}% (early window) to ~${Math.round(recentAvg)}% (recent). Worth checking what changed.`,
    evidence: { early_avg: earlyAvg, recent_avg: recentAvg, drop_points: drop, window_days: sorted.length },
  };
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────

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

  const windowStart = dateNDaysBack(date, CONFIG.WINDOW_DAYS - 1);
  const windowStartIso = `${windowStart}T00:00:00Z`;

  const [bioRes, subjRes, scoresRes, nutritionRes, symptomsRes] = await Promise.all([
    sb.from('daily_biometric_records')
      .select('date, sleep_duration_minutes')
      .eq('user_id', userId)
      .gte('date', windowStart)
      .lte('date', date)
      .order('date', { ascending: false }),
    sb.from('daily_subjective_rollups')
      .select('date, stress_avg')
      .eq('user_id', userId)
      .gte('date', windowStart)
      .lte('date', date)
      .order('date', { ascending: false }),
    sb.from('daily_scores')
      .select('date, recovery_status, inflammation_strain_score, adherence_score')
      .eq('user_id', userId)
      .gte('date', windowStart)
      .lte('date', date)
      .order('date', { ascending: false }),
    sb.from('daily_nutrition_rollups')
      .select('date, total_carbs_g, eating_window_minutes')
      .eq('user_id', userId)
      .gte('date', windowStart)
      .lte('date', date)
      .order('date', { ascending: false }),
    sb.from('symptom_logs')
      .select('symptom_name, severity, logged_at')
      .eq('user_id', userId)
      .gte('logged_at', windowStartIso)
      .order('logged_at', { ascending: false }),
  ]);

  const hits: PatternHit[] = [];
  const sleepHit = detectSleepDebt(((bioRes.data as Array<{ date: string; sleep_duration_minutes: number | null }>) ?? []), date);
  if (sleepHit) hits.push(sleepHit);
  const stressHit = detectStressAccumulation(((subjRes.data as Array<{ date: string; stress_avg: number | null }>) ?? []), date);
  if (stressHit) hits.push(stressHit);
  const lowRecHit = detectLowRecovery(((scoresRes.data as Array<{ date: string; recovery_status: string | null }>) ?? []), date);
  if (lowRecHit) hits.push(lowRecHit);
  const carbHit = detectCarbRestriction(((nutritionRes.data as Array<{ date: string; total_carbs_g: number | null }>) ?? []), date);
  if (carbHit) hits.push(carbHit);
  const windowHit = detectLongEatingWindow(((nutritionRes.data as Array<{ date: string; eating_window_minutes: number | null }>) ?? []), date);
  if (windowHit) hits.push(windowHit);
  const inflamHit = detectInflammationStrain(((scoresRes.data as Array<{ date: string; inflammation_strain_score: number | null }>) ?? []), date);
  if (inflamHit) hits.push(inflamHit);
  hits.push(...detectPersistentSymptoms(((symptomsRes.data as Array<{ symptom_name: string; severity: number | null; logged_at: string }>) ?? [])));
  const adhHit = detectAdherenceDrop(((scoresRes.data as Array<{ date: string; adherence_score: number | null }>) ?? []));
  if (adhHit) hits.push(adhHit);

  // Clear stale rows: delete any prior detected_patterns for this user/date
  // not in the new hit set, then upsert the current hits. detected_patterns
  // is keyed (user_id, date, pattern_type) by the unique index.
  const hitTypes = hits.map(h => h.pattern_type);
  if (hitTypes.length > 0) {
    await sb.from('detected_patterns').delete()
      .eq('user_id', userId).eq('date', date)
      .not('pattern_type', 'in', `(${hitTypes.map(t => `"${t}"`).join(',')})`);
  } else {
    await sb.from('detected_patterns').delete().eq('user_id', userId).eq('date', date);
  }

  if (hits.length > 0) {
    const rows = hits.map(h => ({
      user_id: userId,
      date,
      pattern_type: h.pattern_type,
      severity: h.severity,
      confidence: h.confidence,
      title: h.title,
      summary: h.summary,
      evidence_json: h.evidence,
    }));
    const { error: upsertErr } = await sb
      .from('detected_patterns')
      .upsert(rows, { onConflict: 'user_id,date,pattern_type' });
    if (upsertErr) {
      console.error('[detect-patterns] upsert failed', upsertErr);
      return new Response(
        JSON.stringify({ error: upsertErr.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  console.log(`[detect-patterns] ${userId}/${date}: ${hits.length} patterns`);

  return new Response(
    JSON.stringify({
      status: 'ok',
      userId,
      date,
      patterns_detected: hits.length,
      pattern_types: hits.map(h => h.pattern_type),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
