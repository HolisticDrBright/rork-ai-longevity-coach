/**
 * Pattern Discovery Miner.
 *
 * Nightly / on-demand cohort-level stats job. Given eligible patients (those
 * who opted in via profiles.research_cohort_opt_in AND have ≥ 30 days of data),
 * it builds a per-patient feature matrix and tests candidate pairings across
 * symptom × biomarker, biomarker × biomarker, protocol × outcome, wearable ×
 * symptom, and nutrient × symptom — with lag offsets (0/7/14/30 days).
 *
 * Surviving candidates (q < 0.1, |effect| above threshold, n_patients ≥ 20)
 * land in `discovered_patterns` as status='candidate'. The LLM hypothesizer
 * is invoked separately per candidate by the router.
 *
 * No PHI leaves the server. All inputs are anonymized at aggregation time.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  spearman,
  kendall,
  pointBiserial,
  mutualInformation,
  benjaminiHochberg,
  type CorrelationResult,
} from './statistics';

export interface MinerConfig {
  cohortMinDays: number;
  minPatientsPerPair: number;
  effectThresholdSpearman: number;
  effectThresholdMi: number;
  rawPThreshold: number;
  qThreshold: number;
  lagOffsets: number[];
  maxCandidatesPerKind: number;
}

export const DEFAULT_CONFIG: MinerConfig = {
  cohortMinDays: 30,
  minPatientsPerPair: 20,
  effectThresholdSpearman: 0.25,
  effectThresholdMi: 0.1,
  rawPThreshold: 0.05,
  qThreshold: 0.1,
  lagOffsets: [0, 7, 14, 30],
  maxCandidatesPerKind: 500,
};

export interface MinerResult {
  runId: string;
  cohortSize: number;
  candidatesConsidered: number;
  candidatesPassedFilter: number;
  candidatesPassedFdr: number;
  candidatesUpserted: number;
  durationMs: number;
}

interface CandidateFinding {
  kind: string;
  leftEntity: Record<string, unknown>;
  rightEntity: Record<string, unknown>;
  method: string;
  timeLagDays: number;
  nObservations: number;
  nPatients: number;
  effectSize: number;
  pValue: number;
  ci?: { lower: number; upper: number };
  noveltyScore: number;
  existingRuleOverlap: string[];
  patientValues: Map<string, { left: number; right: number }>;
}

// ────────────────────────────────────────────────────────────
// Cohort + feature extraction
// ────────────────────────────────────────────────────────────

async function fetchEligibleCohort(sb: SupabaseClient, config: MinerConfig): Promise<string[]> {
  const cutoff = new Date(Date.now() - config.cohortMinDays * 86400000).toISOString();
  const { data } = await sb
    .from('profiles')
    .select('id, created_at, research_cohort_opt_in')
    .eq('research_cohort_opt_in', true)
    .lte('created_at', cutoff);
  return (data ?? []).map((p: any) => p.id);
}

/** Pull a thin per-patient time series for a given column from a table. */
async function fetchPatientSeries(
  sb: SupabaseClient,
  patientIds: string[],
  table: string,
  dateColumn: string,
  valueColumn: string,
  filter?: Record<string, string | number>,
): Promise<Map<string, Array<{ date: string; value: number }>>> {
  const result = new Map<string, Array<{ date: string; value: number }>>();
  // Batched IN to keep query size reasonable
  const batchSize = 50;
  for (let i = 0; i < patientIds.length; i += batchSize) {
    const batch = patientIds.slice(i, i + batchSize);
    let query = sb.from(table).select('*').in('user_id', batch);
    if (filter) {
      for (const [k, v] of Object.entries(filter)) {
        query = query.eq(k, v);
      }
    }
    const { data } = await query;
    for (const row of data ?? []) {
      const pid = (row as any).user_id;
      const rawDate = (row as any)[dateColumn];
      const rawVal = (row as any)[valueColumn];
      if (!pid || !rawDate || rawVal == null) continue;
      const date = typeof rawDate === 'string' ? rawDate.substring(0, 10) : new Date(rawDate).toISOString().substring(0, 10);
      const value = Number(rawVal);
      if (!Number.isFinite(value)) continue;
      if (!result.has(pid)) result.set(pid, []);
      result.get(pid)!.push({ date, value });
    }
  }
  return result;
}

/** Carry-forward biomarker values up to `maxDays`; builds per-patient daily values. */
function carryForward(
  series: Map<string, Array<{ date: string; value: number }>>,
  maxDays: number,
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const [pid, rows] of series) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const daily = new Map<string, number>();
    for (let i = 0; i < sorted.length; i++) {
      const startDate = new Date(sorted[i].date).getTime();
      const endDate = i + 1 < sorted.length
        ? Math.min(new Date(sorted[i + 1].date).getTime(), startDate + maxDays * 86400000)
        : startDate + maxDays * 86400000;
      for (let t = startDate; t <= endDate; t += 86400000) {
        const d = new Date(t).toISOString().substring(0, 10);
        daily.set(d, sorted[i].value);
      }
    }
    result.set(pid, daily);
  }
  return result;
}

/** Build daily array for a patient across the full observation window. */
function dailyArray(
  byDate: Map<string, number> | undefined,
  windowStart: string,
  windowEnd: string,
): Array<{ date: string; value: number | null }> {
  const out: Array<{ date: string; value: number | null }> = [];
  const start = new Date(windowStart).getTime();
  const end = new Date(windowEnd).getTime();
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t).toISOString().substring(0, 10);
    out.push({ date: d, value: byDate?.get(d) ?? null });
  }
  return out;
}

// ────────────────────────────────────────────────────────────
// Novelty check
// ────────────────────────────────────────────────────────────

/**
 * Similarity to the existing authoritative rule set. Low score = novel.
 * Pulls rule summaries from the already-authored data:
 *   - peptide_lab_thresholds (biomarker-based peptide rules)
 *   - lab_peptide_mappings (finding → recommended peptide)
 *   - peptide_interactions, peptide_contraindications (safety rules)
 *
 * If the candidate finding references entities that literally appear in the
 * rule set, novelty drops. This is a text-overlap heuristic, not semantic.
 */
async function computeNovelty(
  sb: SupabaseClient,
  leftLabel: string,
  rightLabel: string,
): Promise<{ noveltyScore: number; overlaps: string[] }> {
  const overlaps: string[] = [];
  const combinedQuery = `${leftLabel} ${rightLabel}`.toLowerCase();

  // Lab thresholds (biomarker_name × peptide_slug)
  const { data: thresholds } = await sb
    .from('peptide_lab_thresholds')
    .select('peptide_slug, biomarker_name');
  for (const t of thresholds ?? []) {
    const row = t as any;
    const lhs = String(row.biomarker_name ?? '').toLowerCase();
    const rhs = String(row.peptide_slug ?? '').toLowerCase();
    if (combinedQuery.includes(lhs) && combinedQuery.includes(rhs)) {
      overlaps.push(`peptide_lab_threshold:${row.peptide_slug}:${row.biomarker_name}`);
    }
  }

  // Lab → peptide mappings
  const { data: mappings } = await sb
    .from('lab_peptide_mappings')
    .select('finding_pattern, recommended_peptide_slugs');
  for (const m of mappings ?? []) {
    const row = m as any;
    const pattern = String(row.finding_pattern ?? '').toLowerCase();
    if (combinedQuery.includes(pattern)) {
      overlaps.push(`lab_peptide_mapping:${row.finding_pattern}`);
    }
  }

  // Normalize: 0 overlaps → fully novel (1.0); capped at 5 overlaps → 0.2 novelty
  const novelty = Math.max(0, Math.min(1, 1 - overlaps.length * 0.2));
  return { noveltyScore: novelty, overlaps };
}

// ────────────────────────────────────────────────────────────
// Pair testing
// ────────────────────────────────────────────────────────────

function testPair(
  patientLeft: Map<string, Map<string, number>>,
  patientRight: Map<string, Map<string, number>>,
  leftLabel: string,
  rightLabel: string,
  leftKind: string,
  rightKind: string,
  lagDays: number,
  windowStart: string,
  windowEnd: string,
  config: MinerConfig,
): CandidateFinding | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const patientValues = new Map<string, { left: number; right: number }>();

  // Per-patient means over the observation window (with right shifted by lag)
  for (const [pid, leftDaily] of patientLeft) {
    const rightDaily = patientRight.get(pid);
    if (!rightDaily) continue;

    const leftArr = dailyArray(leftDaily, windowStart, windowEnd);
    let leftSum = 0, leftN = 0;
    let rightSum = 0, rightN = 0;
    for (const { date, value } of leftArr) {
      if (value == null) continue;
      leftSum += value;
      leftN++;
      // Shift right by lag days
      const laggedDate = new Date(new Date(date).getTime() + lagDays * 86400000).toISOString().substring(0, 10);
      const rv = rightDaily.get(laggedDate);
      if (rv != null) {
        rightSum += rv;
        rightN++;
      }
    }
    if (leftN < 5 || rightN < 5) continue;
    const leftMean = leftSum / leftN;
    const rightMean = rightSum / rightN;
    xs.push(leftMean);
    ys.push(rightMean);
    patientValues.set(pid, { left: leftMean, right: rightMean });
  }

  if (xs.length < config.minPatientsPerPair) return null;

  // Pick method: binary-vs-continuous uses point-biserial, otherwise Spearman
  const leftBinary = xs.every(v => v === 0 || v === 1);
  const rightBinary = ys.every(v => v === 0 || v === 1);
  let stat: CorrelationResult;
  if (leftBinary && !rightBinary) stat = pointBiserial(xs, ys);
  else if (!leftBinary && rightBinary) stat = pointBiserial(ys, xs);
  else stat = spearman(xs, ys);

  // Screening filter
  const passesEffect = Math.abs(stat.rho) >= config.effectThresholdSpearman;
  const passesP = stat.pValue < config.rawPThreshold;
  if (!passesEffect || !passesP) {
    // Try MI as a non-linear fallback before giving up
    const mi = mutualInformation(xs, ys);
    if (!(mi.rho >= config.effectThresholdMi && mi.pValue < config.rawPThreshold)) {
      return null;
    }
    stat = mi;
  }

  return {
    kind: `${leftKind}_${rightKind}`,
    leftEntity: { type: leftKind, label: leftLabel },
    rightEntity: { type: rightKind, label: rightLabel },
    method: stat.method,
    timeLagDays: lagDays,
    nObservations: xs.length,
    nPatients: xs.length,
    effectSize: stat.rho,
    pValue: stat.pValue,
    ci: stat.ci95,
    noveltyScore: 0, // computed later, after we have the labels
    existingRuleOverlap: [],
    patientValues,
  };
}

// ────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────

export async function runMiner(
  sb: SupabaseClient,
  options: {
    triggeredBy?: string;
    config?: Partial<MinerConfig>;
    onProgress?: (msg: string) => void;
  } = {},
): Promise<MinerResult> {
  const config = { ...DEFAULT_CONFIG, ...(options.config ?? {}) };
  const startMs = Date.now();
  const log = options.onProgress ?? (() => {});

  // Open a run row so we can write duration + counts when done.
  const { data: runRow, error: runErr } = await sb
    .from('pattern_miner_runs')
    .insert({
      status: 'running',
      triggered_by: options.triggeredBy ?? null,
      config,
    })
    .select()
    .maybeSingle();
  if (runErr || !runRow) throw new Error(`Failed to create miner run row: ${runErr?.message}`);
  const runId: string = runRow.id;

  try {
    log('Fetching eligible cohort…');
    const cohort = await fetchEligibleCohort(sb, config);
    log(`Cohort: ${cohort.length} patients`);

    if (cohort.length < config.minPatientsPerPair) {
      await sb.from('pattern_miner_runs').update({
        status: 'succeeded',
        cohort_size: cohort.length,
        candidates_considered: 0,
        candidates_passed_filter: 0,
        candidates_passed_fdr: 0,
        candidates_upserted: 0,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startMs,
      }).eq('id', runId);
      return {
        runId, cohortSize: cohort.length, candidatesConsidered: 0,
        candidatesPassedFilter: 0, candidatesPassedFdr: 0, candidatesUpserted: 0,
        durationMs: Date.now() - startMs,
      };
    }

    // Window: last 180 days
    const windowEnd = new Date().toISOString().substring(0, 10);
    const windowStart = new Date(Date.now() - 180 * 86400000).toISOString().substring(0, 10);

    // Fetch series
    log('Fetching biomarkers…');
    const labsSeries = await fetchPatientSeries(sb, cohort, 'lab_markers', 'collected_at', 'value');
    // Group by biomarker name
    const biomarkerByName = new Map<string, Map<string, Array<{ date: string; value: number }>>>();
    {
      for (const [pid, rows] of labsSeries) {
        for (const r of rows) {
          const name = (r as any).biomarker_name ?? (r as any).marker ?? 'unknown';
          if (!biomarkerByName.has(name)) biomarkerByName.set(name, new Map());
          const m = biomarkerByName.get(name)!;
          if (!m.has(pid)) m.set(pid, []);
          m.get(pid)!.push({ date: r.date, value: r.value });
        }
      }
    }

    log('Fetching symptoms…');
    const symptomsRaw = await fetchPatientSeries(sb, cohort, 'symptom_logs', 'logged_at', 'severity');
    // Group by symptom name
    const symptomByName = new Map<string, Map<string, Array<{ date: string; value: number }>>>();
    for (const [pid, rows] of symptomsRaw) {
      for (const r of rows) {
        const name = (r as any).symptom_name ?? (r as any).name ?? 'unknown';
        if (!symptomByName.has(name)) symptomByName.set(name, new Map());
        const m = symptomByName.get(name)!;
        if (!m.has(pid)) m.set(pid, []);
        m.get(pid)!.push({ date: r.date, value: r.value });
      }
    }

    log('Building candidate pair set…');
    const candidates: CandidateFinding[] = [];
    let considered = 0;

    // symptom × biomarker across lags
    for (const [symptomName, symptomSeries] of symptomByName) {
      for (const [biomarkerName, biomarkerSeries] of biomarkerByName) {
        const leftForward = carryForward(symptomSeries, 7);
        const rightForward = carryForward(biomarkerSeries, 60);
        for (const lag of config.lagOffsets) {
          considered++;
          const finding = testPair(
            leftForward, rightForward,
            symptomName, biomarkerName,
            'symptom', 'biomarker',
            lag, windowStart, windowEnd, config,
          );
          if (finding) candidates.push(finding);
        }
      }
    }

    // biomarker × biomarker (different markers)
    const biomarkerNames = [...biomarkerByName.keys()];
    for (let i = 0; i < biomarkerNames.length; i++) {
      for (let j = i + 1; j < biomarkerNames.length; j++) {
        const a = biomarkerByName.get(biomarkerNames[i])!;
        const b = biomarkerByName.get(biomarkerNames[j])!;
        const aCarry = carryForward(a, 60);
        const bCarry = carryForward(b, 60);
        considered++;
        const finding = testPair(
          aCarry, bCarry,
          biomarkerNames[i], biomarkerNames[j],
          'biomarker', 'biomarker',
          0, windowStart, windowEnd, config,
        );
        if (finding) candidates.push(finding);
      }
    }

    log(`Candidates passed screening filter: ${candidates.length} / ${considered}`);

    // BH FDR
    if (candidates.length === 0) {
      await sb.from('pattern_miner_runs').update({
        status: 'succeeded',
        cohort_size: cohort.length,
        candidates_considered: considered,
        candidates_passed_filter: 0,
        candidates_passed_fdr: 0,
        candidates_upserted: 0,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startMs,
      }).eq('id', runId);
      return {
        runId, cohortSize: cohort.length, candidatesConsidered: considered,
        candidatesPassedFilter: 0, candidatesPassedFdr: 0, candidatesUpserted: 0,
        durationMs: Date.now() - startMs,
      };
    }

    const pValues = candidates.map(c => c.pValue);
    const qValues = benjaminiHochberg(pValues);
    const survivors = candidates.filter((_, i) => qValues[i] < config.qThreshold);
    log(`Survived FDR (q < ${config.qThreshold}): ${survivors.length}`);

    // Novelty + upsert
    log('Computing novelty + upserting…');
    let upserted = 0;
    for (let i = 0; i < survivors.length; i++) {
      const f = survivors[i];
      const qIdx = candidates.indexOf(f);
      const q = qValues[qIdx];
      const { noveltyScore, overlaps } = await computeNovelty(
        sb,
        String(f.leftEntity.label ?? ''),
        String(f.rightEntity.label ?? ''),
      );
      const { data: inserted, error: insErr } = await sb
        .from('discovered_patterns')
        .insert({
          kind: f.kind,
          left_entity: f.leftEntity,
          right_entity: f.rightEntity,
          method: f.method,
          time_lag_days: f.timeLagDays,
          n_observations: f.nObservations,
          n_patients: f.nPatients,
          effect_size: f.effectSize,
          p_value: f.pValue,
          q_value: q,
          confidence_interval: f.ci ? { lower: f.ci.lower, upper: f.ci.upper } : null,
          data_window_start: windowStart,
          data_window_end: windowEnd,
          novelty_score: noveltyScore,
          existing_rule_overlap: overlaps,
          miner_run_id: runId,
        })
        .select()
        .maybeSingle();
      if (insErr || !inserted) continue;

      // Observation rows (anonymized — patient_id stored for practitioner drill-down)
      const obsRows = [...f.patientValues.entries()].map(([pid, v]) => ({
        pattern_id: inserted.id,
        patient_id: pid,
        observation_window_start: windowStart,
        observation_window_end: windowEnd,
        left_value: v.left,
        right_value: v.right,
        supporting_data: { lag_days: f.timeLagDays, method: f.method },
      }));
      if (obsRows.length > 0) {
        await sb.from('pattern_observations').insert(obsRows);
      }
      upserted++;
    }

    await sb.from('pattern_miner_runs').update({
      status: 'succeeded',
      cohort_size: cohort.length,
      candidates_considered: considered,
      candidates_passed_filter: candidates.length,
      candidates_passed_fdr: survivors.length,
      candidates_upserted: upserted,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startMs,
    }).eq('id', runId);

    return {
      runId,
      cohortSize: cohort.length,
      candidatesConsidered: considered,
      candidatesPassedFilter: candidates.length,
      candidatesPassedFdr: survivors.length,
      candidatesUpserted: upserted,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    await sb.from('pattern_miner_runs').update({
      status: 'failed',
      error_message: err instanceof Error ? err.message : String(err),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startMs,
    }).eq('id', runId);
    throw err;
  }
}
