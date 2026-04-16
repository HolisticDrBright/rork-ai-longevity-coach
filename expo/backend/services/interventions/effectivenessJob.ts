/**
 * Intervention Effectiveness Job.
 *
 * For every intervention_events row with a large-enough response window,
 * compute pre/post deltas across biomarker, symptom, and wearable outcomes.
 * Flag confounders (concurrent peptides, protocol overlap, seasonal,
 * insufficient baseline). Refresh the cohort aggregate table.
 *
 * Runs nightly after the pattern miner; can be invoked ad-hoc by admins.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { bootstrapMeanCi, hedgesG } from '../patterns/statistics';

export interface JobResult {
  eventsScanned: number;
  outcomesComputed: number;
  aggregatesRefreshed: number;
  durationMs: number;
  errors: string[];
}

/**
 * Desired direction per outcome: 'lower' means a lower value is an
 * improvement (CRP, RHR, body fat); 'higher' means a higher value is an
 * improvement (HRV, VO2 max, vitamin D). Defaults to 'lower' for anything
 * named with 'pain', 'severity', 'symptom_' and to 'higher' for wearable
 * scores. Explicit mappings win.
 */
const OUTCOME_DIRECTION: Record<string, 'lower' | 'higher'> = {
  'hs-crp': 'lower', 'crp': 'lower', 'il-6': 'lower',
  'homocysteine': 'lower', 'fasting glucose': 'lower', 'hba1c': 'lower',
  'ldl': 'lower', 'triglycerides': 'lower', 'alt': 'lower', 'ast': 'lower',
  'insulin': 'lower', 'resting hr': 'lower', 'body_fat_pct': 'lower',
  'waist_to_hip_ratio': 'lower',
  'hdl': 'higher', 'hrv_rmssd': 'higher', 'deep_sleep_pct': 'higher',
  'rem_sleep_pct': 'higher', 'sleep_efficiency_pct': 'higher',
  'vo2_max': 'higher', 'recovery_score': 'higher', 'vitamin d': 'higher',
  'ferritin': 'higher',
};

const BASELINE_WINDOW_DAYS = 30;
const RESPONSE_WINDOW_DAYS = 90;

// Per-outcome lag before we start counting response (biology takes time)
const OUTCOME_LAG_DAYS: Record<string, number> = {
  'hs-crp': 14, 'crp': 14, 'ferritin': 30, 'vitamin d': 42,
  'hrv_rmssd': 7, 'deep_sleep_pct': 7, 'sleep_efficiency_pct': 7,
  'hba1c': 60,
};

function getDirection(outcomeId: string): 'lower' | 'higher' {
  const key = outcomeId.toLowerCase();
  if (OUTCOME_DIRECTION[key]) return OUTCOME_DIRECTION[key];
  if (key.includes('symptom') || key.includes('severity') || key.includes('pain')) return 'lower';
  return 'higher';
}

function getLag(outcomeId: string): number {
  const key = outcomeId.toLowerCase();
  return OUTCOME_LAG_DAYS[key] ?? 14;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function summarize(values: number[]): { median: number; mean: number } {
  if (values.length === 0) return { median: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { median, mean };
}

function season(isoDate: string): 'winter' | 'spring' | 'summer' | 'fall' {
  const m = new Date(isoDate).getMonth() + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'fall';
  return 'winter';
}

function confidenceFor(params: {
  baselineN: number;
  responseN: number;
  confoundCount: number;
}): 'high' | 'medium' | 'low' | 'insufficient_data' {
  if (params.baselineN < 3 || params.responseN < 3) return 'insufficient_data';
  if (params.confoundCount >= 2 || params.baselineN < 5 || params.responseN < 5) return 'low';
  if (params.confoundCount === 1 || params.baselineN < 10 || params.responseN < 10) return 'medium';
  return 'high';
}

// ────────────────────────────────────────────────────────────
// Per-event computation
// ────────────────────────────────────────────────────────────

async function computeOutcomesForEvent(
  sb: SupabaseClient,
  event: any,
): Promise<number> {
  const patientId = event.patient_id;
  const start = new Date(event.started_at).getTime();
  const end = event.ended_at ? new Date(event.ended_at).getTime() : Date.now();

  if (end - start < 21 * 86400000) return 0; // response window too short

  const baselineStart = new Date(start - BASELINE_WINDOW_DAYS * 86400000).toISOString();
  const baselineEnd = new Date(start).toISOString();

  // Biomarker outcomes
  const { data: markers } = await sb
    .from('lab_markers')
    .select('biomarker_name, value, collected_at')
    .eq('user_id', patientId)
    .gte('collected_at', baselineStart);
  const byBiomarker = new Map<string, { baseline: number[]; response: number[] }>();
  for (const m of (markers as any[] ?? [])) {
    const t = new Date(m.collected_at).getTime();
    const name = String(m.biomarker_name ?? '').toLowerCase();
    const v = Number(m.value);
    if (!Number.isFinite(v) || !name) continue;
    if (!byBiomarker.has(name)) byBiomarker.set(name, { baseline: [], response: [] });
    const bucket = byBiomarker.get(name)!;
    if (t >= new Date(baselineStart).getTime() && t <= start) bucket.baseline.push(v);
    const lag = getLag(name);
    if (t >= start + lag * 86400000 && t <= Math.min(end, start + RESPONSE_WINDOW_DAYS * 86400000)) {
      bucket.response.push(v);
    }
  }

  // Concurrent intervention detection — ± 7 days of event start
  const { data: concurrent } = await sb
    .from('intervention_events')
    .select('id, intervention_type')
    .eq('patient_id', patientId)
    .gte('started_at', new Date(start - 7 * 86400000).toISOString())
    .lte('started_at', new Date(start + 7 * 86400000).toISOString())
    .neq('id', event.id);
  const hasConcurrentPeptide = (concurrent ?? []).some((c: any) => c.intervention_type === 'peptide');
  const hasConcurrentProtocol = (concurrent ?? []).some((c: any) => c.intervention_type === 'protocol');
  const baselineSeason = season(baselineStart);
  const responseSeason = season(new Date(start + RESPONSE_WINDOW_DAYS * 86400000 / 2).toISOString());

  let written = 0;

  for (const [name, buckets] of byBiomarker) {
    if (buckets.baseline.length === 0 && buckets.response.length === 0) continue;
    const baseStats = summarize(buckets.baseline);
    const respStats = summarize(buckets.response);
    const delta = respStats.median - baseStats.median;
    const deltaPct = baseStats.median !== 0 ? (delta / Math.abs(baseStats.median)) * 100 : null;
    const direction: 'improved' | 'worsened' | 'unchanged' | 'inconclusive' = (() => {
      if (buckets.response.length === 0) return 'inconclusive';
      if (Math.abs(delta) < (Math.abs(baseStats.median) * 0.03)) return 'unchanged';
      const dir = getDirection(name);
      if (dir === 'lower') return delta < 0 ? 'improved' : 'worsened';
      return delta > 0 ? 'improved' : 'worsened';
    })();
    const effect = hedgesG(buckets.baseline, buckets.response);

    const confoundFlags: string[] = [];
    if (hasConcurrentPeptide) confoundFlags.push('concurrent_peptide');
    if (hasConcurrentProtocol) confoundFlags.push('protocol_overlap');
    if (baselineSeason !== responseSeason && ['vitamin d', 'cortisol'].some(s => name.includes(s))) {
      confoundFlags.push('seasonal');
    }
    if (buckets.baseline.length < 3) confoundFlags.push('insufficient_baseline');

    const confidence = confidenceFor({
      baselineN: buckets.baseline.length,
      responseN: buckets.response.length,
      confoundCount: confoundFlags.length,
    });

    await sb.from('intervention_outcomes').insert({
      intervention_event_id: event.id,
      outcome_type: 'biomarker',
      outcome_id: name,
      baseline_window_days: BASELINE_WINDOW_DAYS,
      response_window_days: RESPONSE_WINDOW_DAYS,
      baseline_value: baseStats.median,
      response_value: respStats.median,
      delta,
      delta_pct: deltaPct,
      direction,
      effect_size: effect,
      n_baseline_datapoints: buckets.baseline.length,
      n_response_datapoints: buckets.response.length,
      confidence,
      confound_flags: confoundFlags,
    });
    written++;
  }

  return written;
}

// ────────────────────────────────────────────────────────────
// Cohort aggregation
// ────────────────────────────────────────────────────────────

async function refreshCohortAggregates(sb: SupabaseClient): Promise<number> {
  const { data: outcomes } = await sb
    .from('intervention_outcomes')
    .select('*, intervention_events(intervention_type, intervention_id)')
    .in('confidence', ['high', 'medium']);

  // Group by (intervention_type, intervention_id, outcome_type, outcome_id)
  const groups = new Map<string, any[]>();
  for (const o of (outcomes as any[] ?? [])) {
    const ev = o.intervention_events;
    if (!ev) continue;
    const key = `${ev.intervention_type}::${ev.intervention_id}::${o.outcome_type}::${o.outcome_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(o);
  }

  let refreshed = 0;
  for (const [key, group] of groups) {
    if (group.length < 10) continue;
    const effects = group.map((g: any) => Number(g.effect_size)).filter(Number.isFinite);
    const { mean: meanEffect, lower, upper } = bootstrapMeanCi(effects);
    const improved = group.filter((g: any) => g.direction === 'improved').length;
    const worsened = group.filter((g: any) => g.direction === 'worsened').length;
    const n = group.length;

    const [interventionType, interventionId, outcomeType, outcomeId] = key.split('::');

    await sb.from('intervention_effectiveness').upsert({
      intervention_type: interventionType,
      intervention_id: interventionId,
      outcome_type: outcomeType,
      outcome_id: outcomeId,
      cohort_filters: {},
      n_patients: n,
      mean_effect_size: meanEffect,
      ci_lower: lower,
      ci_upper: upper,
      response_rate: improved / n,
      adverse_rate: worsened / n,
      last_refreshed_at: new Date().toISOString(),
    }, { onConflict: 'intervention_type,intervention_id,outcome_type,outcome_id' });
    refreshed++;
  }
  return refreshed;
}

// ────────────────────────────────────────────────────────────
// Public entry point
// ────────────────────────────────────────────────────────────

export async function runEffectivenessJob(sb: SupabaseClient): Promise<JobResult> {
  const start = Date.now();
  const errors: string[] = [];
  let outcomesComputed = 0;

  // Only look at events old enough to have a response window
  const responseThreshold = new Date(Date.now() - 21 * 86400000).toISOString();
  const { data: events } = await sb
    .from('intervention_events')
    .select('*')
    .lte('started_at', responseThreshold)
    .eq('event', 'start');

  const eventsArr = events ?? [];
  for (const event of eventsArr) {
    try {
      // Skip if we already computed outcomes for this event
      const { count } = await sb
        .from('intervention_outcomes')
        .select('*', { count: 'exact', head: true })
        .eq('intervention_event_id', (event as any).id);
      if ((count ?? 0) > 0) continue;

      outcomesComputed += await computeOutcomesForEvent(sb, event);
    } catch (err) {
      errors.push(`event=${(event as any).id}: ${(err as Error).message}`);
    }
  }

  let aggregatesRefreshed = 0;
  try {
    aggregatesRefreshed = await refreshCohortAggregates(sb);
  } catch (err) {
    errors.push(`aggregate: ${(err as Error).message}`);
  }

  return {
    eventsScanned: eventsArr.length,
    outcomesComputed,
    aggregatesRefreshed,
    durationMs: Date.now() - start,
    errors,
  };
}
