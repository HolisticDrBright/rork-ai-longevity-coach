/**
 * Month 6 outcome report builder.
 *
 * Pulls baseline + current data from Supabase, computes deltas, produces
 * a narrative, and returns a typed OutcomeReport ready to persist.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateNarrative, NARRATIVE_SYSTEM_PROMPT_VERSION } from './outcomeNarrative';
import {
  avg,
  buildDelta,
  compositeInflammationScore,
  computeCompleteness,
} from './outcomeReportHelpers';
import type {
  AdherenceBlock,
  BiologicalAgeBlock,
  BodyCompBlock,
  InflammationBlock,
  LabShiftsBlock,
  OutcomeReport,
  PatientReportedBlock,
  WearableBlock,
} from './outcomeReportTypes';

const BASELINE_WINDOW_DAYS = 14;
const CURRENT_WINDOW_DAYS = 14;

interface BuildOptions {
  useClaude: boolean;
}

// Keep file sections small: data fetch → compute → narrate → assemble.

// ────────────────────────────────────────────────────────────
// Data fetchers
// ────────────────────────────────────────────────────────────

async function fetchProtocol(sb: SupabaseClient, protocolId: string) {
  const { data, error } = await sb
    .from('longevity_protocols')
    .select('*')
    .eq('id', protocolId)
    .maybeSingle();
  if (error || !data) throw new Error('Protocol not found');
  return data;
}

async function fetchIntake(sb: SupabaseClient, intakeId: string) {
  const { data, error } = await sb
    .from('longevity_intakes')
    .select('*')
    .eq('id', intakeId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * daily_baselines is a rollup table; we average the first/last N days
 * relative to the protocol's start_date.
 */
async function fetchBiometricWindow(
  sb: SupabaseClient,
  userId: string,
  windowStart: string,
  windowEnd: string,
) {
  const { data } = await sb
    .from('daily_baselines')
    .select('*')
    .eq('user_id', userId)
    .gte('date', windowStart)
    .lte('date', windowEnd)
    .order('date', { ascending: true });
  return data ?? [];
}

async function fetchLabMarkers(sb: SupabaseClient, userId: string, sinceIso: string) {
  const { data } = await sb
    .from('lab_markers')
    .select('*')
    .eq('user_id', userId)
    .gte('collected_at', sinceIso)
    .order('collected_at', { ascending: true });
  return data ?? [];
}

async function fetchLabPanels(sb: SupabaseClient, userId: string) {
  const { data } = await sb
    .from('lab_panels')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true });
  return data ?? [];
}

async function fetchAdherence(sb: SupabaseClient, protocolId: string) {
  const { data } = await sb
    .from('longevity_protocol_progress')
    .select('month, item_category, taken')
    .eq('protocol_id', protocolId);
  return data ?? [];
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ────────────────────────────────────────────────────────────
// Compute blocks
// ────────────────────────────────────────────────────────────

function latestMarker(markers: any[], biomarkerNames: string[]): number | undefined {
  const lower = biomarkerNames.map(n => n.toLowerCase());
  const matches = markers
    .filter(m => lower.includes(String(m.biomarker_name ?? '').toLowerCase()))
    .sort((a, b) => new Date(a.collected_at).getTime() - new Date(b.collected_at).getTime());
  const last = matches[matches.length - 1];
  return last ? Number(last.value) : undefined;
}

function firstMarker(markers: any[], biomarkerNames: string[]): number | undefined {
  const lower = biomarkerNames.map(n => n.toLowerCase());
  const matches = markers
    .filter(m => lower.includes(String(m.biomarker_name ?? '').toLowerCase()))
    .sort((a, b) => new Date(a.collected_at).getTime() - new Date(b.collected_at).getTime());
  const first = matches[0];
  return first ? Number(first.value) : undefined;
}

function buildBiologicalAge(baselinePanel: any, currentPanel: any, targetDelta?: number): BiologicalAgeBlock {
  const baseTruAge = baselinePanel?.parsed_json?.truage?.biologicalAge;
  const currTruAge = currentPanel?.parsed_json?.truage?.biologicalAge;
  const delta = baseTruAge != null && currTruAge != null ? currTruAge - baseTruAge : undefined;

  const organs: BiologicalAgeBlock['organs'] = [];
  const baseOrgans = baselinePanel?.parsed_json?.truage?.organs ?? {};
  const currOrgans = currentPanel?.parsed_json?.truage?.organs ?? {};
  for (const organ of new Set([...Object.keys(baseOrgans), ...Object.keys(currOrgans)])) {
    const b = Number(baseOrgans[organ]);
    const c = Number(currOrgans[organ]);
    if (!Number.isFinite(b) || !Number.isFinite(c)) continue;
    const d = c - b;
    organs.push({
      organ,
      baseline: b,
      current: c,
      delta: Number(d.toFixed(1)),
      direction: Math.abs(d) < 0.5 ? 'stable' : d < 0 ? 'improved' : 'declined',
    });
  }

  const direction = delta == null ? 'unknown' : Math.abs(delta) < 0.5 ? 'stable' : delta < 0 ? 'improved' : 'declined';
  return {
    baselineTruAge: baseTruAge,
    currentTruAge: currTruAge,
    deltaYears: delta == null ? undefined : Number(delta.toFixed(1)),
    targetDeltaYears: targetDelta,
    direction,
    sentiment: direction === 'improved' ? 'positive' : direction === 'declined' ? 'negative' : 'neutral',
    organs,
  };
}

function buildInflammation(baselineMarkers: any[], currentMarkers: any[]): InflammationBlock {
  const baseCrp = firstMarker(baselineMarkers, ['hs-CRP', 'CRP', 'C-Reactive Protein']);
  const currCrp = latestMarker(currentMarkers, ['hs-CRP', 'CRP', 'C-Reactive Protein']);
  const baseIl6 = firstMarker(baselineMarkers, ['IL-6', 'Interleukin-6']);
  const currIl6 = latestMarker(currentMarkers, ['IL-6', 'Interleukin-6']);
  const baseHomo = firstMarker(baselineMarkers, ['Homocysteine']);
  const currHomo = latestMarker(currentMarkers, ['Homocysteine']);

  const crp = buildDelta({ label: 'hs-CRP', unit: 'mg/L', baseline: baseCrp, current: currCrp, lowerIsBetter: true });
  const il6 = buildDelta({ label: 'IL-6', unit: 'pg/mL', baseline: baseIl6, current: currIl6, lowerIsBetter: true });
  const homocysteine = buildDelta({ label: 'Homocysteine', unit: 'µmol/L', baseline: baseHomo, current: currHomo, lowerIsBetter: true });

  const baseScore = compositeInflammationScore({ crp: baseCrp, il6: baseIl6, homocysteine: baseHomo });
  const currScore = compositeInflammationScore({ crp: currCrp, il6: currIl6, homocysteine: currHomo });
  const compositeScore = buildDelta({
    label: 'Inflammation score',
    baseline: baseScore,
    current: currScore,
    lowerIsBetter: false, // higher score = healthier (penalty-based)
  });

  return { crp, il6, homocysteine, compositeScore };
}

function buildWearables(baseline: any[], current: any[]): WearableBlock {
  return {
    hrv: buildDelta({ label: 'HRV (rMSSD)', unit: 'ms', baseline: avg(baseline, 'hrv_rmssd'), current: avg(current, 'hrv_rmssd') }),
    restingHr: buildDelta({ label: 'Resting HR', unit: 'bpm', baseline: avg(baseline, 'resting_hr'), current: avg(current, 'resting_hr'), lowerIsBetter: true }),
    deepSleepPct: buildDelta({ label: 'Deep sleep', unit: '%', baseline: avg(baseline, 'deep_sleep_pct'), current: avg(current, 'deep_sleep_pct') }),
    remSleepPct: buildDelta({ label: 'REM sleep', unit: '%', baseline: avg(baseline, 'rem_sleep_pct'), current: avg(current, 'rem_sleep_pct') }),
    sleepEfficiency: buildDelta({ label: 'Sleep efficiency', unit: '%', baseline: avg(baseline, 'sleep_efficiency_pct'), current: avg(current, 'sleep_efficiency_pct') }),
    spo2Mean: buildDelta({ label: 'SpO₂ mean', unit: '%', baseline: avg(baseline, 'spo2_mean'), current: avg(current, 'spo2_mean') }),
    spo2Variance: buildDelta({ label: 'SpO₂ variance', baseline: avg(baseline, 'spo2_variance'), current: avg(current, 'spo2_variance'), lowerIsBetter: true }),
    vo2Max: buildDelta({ label: 'VO₂ max', unit: 'ml/kg/min', baseline: avg(baseline, 'vo2_max'), current: avg(current, 'vo2_max') }),
  };
}

function buildBodyComp(baseline: any[], current: any[], intake: any): BodyCompBlock {
  const baseWeight = intake?.weight_current ?? avg(baseline, 'weight');
  const currWeight = avg(current, 'weight');
  return {
    weight: buildDelta({ label: 'Weight', unit: 'lbs', baseline: baseWeight, current: currWeight, lowerIsBetter: true }),
    bodyFatPct: buildDelta({ label: 'Body fat', unit: '%', baseline: avg(baseline, 'body_fat_pct'), current: avg(current, 'body_fat_pct'), lowerIsBetter: true }),
    leanMass: buildDelta({ label: 'Lean mass', unit: 'lbs', baseline: avg(baseline, 'lean_mass_lbs'), current: avg(current, 'lean_mass_lbs') }),
    waistToHipRatio: buildDelta({ label: 'Waist-to-hip', baseline: avg(baseline, 'waist_to_hip_ratio'), current: avg(current, 'waist_to_hip_ratio'), lowerIsBetter: true, stableThresholdPct: 2 }),
  };
}

function buildLabShifts(baselinePanels: any[], currentPanels: any[]): LabShiftsBlock {
  const findPanel = (panels: any[], source: string) =>
    panels.find(p => String(p.source ?? '').toLowerCase().includes(source.toLowerCase()));

  const baseNutrEval = findPanel(baselinePanels, 'NutrEval');
  const currNutrEval = findPanel(currentPanels, 'NutrEval');

  const baseDeficiencies: string[] = baseNutrEval?.parsed_json?.deficiencies ?? [];
  const currDeficiencies: string[] = currNutrEval?.parsed_json?.deficiencies ?? [];
  const corrected = baseDeficiencies.filter(d => !currDeficiencies.includes(d)).slice(0, 5);
  const remaining = currDeficiencies.slice(0, 5);

  const baseDutch = findPanel(baselinePanels, 'DUTCH');
  const currDutch = findPanel(currentPanels, 'DUTCH');
  const dutch = baseDutch || currDutch ? {
    baselineCortisolRhythm: baseDutch?.parsed_json?.cortisolRhythm,
    currentCortisolRhythm: currDutch?.parsed_json?.cortisolRhythm,
    normalized: currDutch?.parsed_json?.cortisolRhythm === 'normal',
  } : undefined;

  const baseGi = findPanel(baselinePanels, 'GI-MAP');
  const currGi = findPanel(currentPanels, 'GI-MAP');
  const baseGiMarkers: string[] = baseGi?.parsed_json?.flaggedMarkers ?? [];
  const currGiMarkers: string[] = currGi?.parsed_json?.flaggedMarkers ?? [];
  const giMap = baseGi || currGi ? {
    baselineDysbiosisScore: baseGi?.parsed_json?.dysbiosisScore,
    currentDysbiosisScore: currGi?.parsed_json?.dysbiosisScore,
    resolvedMarkers: baseGiMarkers.filter(m => !currGiMarkers.includes(m)),
    persistentMarkers: currGiMarkers,
  } : undefined;

  const currOat = findPanel(currentPanels, 'OAT');
  const oat = currOat ? {
    topImprovedMetabolites: (currOat.parsed_json?.improvedMetabolites ?? []).slice(0, 3)
      .map((m: string) => ({ name: m, direction: 'improved' as const })),
    topRemainingMetabolites: (currOat.parsed_json?.flaggedMetabolites ?? []).slice(0, 3)
      .map((m: string) => ({ name: m, direction: 'unknown' as const })),
  } : undefined;

  return {
    nutrEval: { correctedDeficiencies: corrected, remainingDeficiencies: remaining },
    dutch,
    giMap,
    oat,
  };
}

function buildAdherence(progressRows: any[]): AdherenceBlock {
  const byCategory: Record<string, { taken: number; total: number }> = {};
  for (const row of progressRows) {
    const cat = row.item_category ?? 'other';
    if (!byCategory[cat]) byCategory[cat] = { taken: 0, total: 0 };
    byCategory[cat].total++;
    if (row.taken) byCategory[cat].taken++;
  }
  const pct = (cat: string) => {
    const b = byCategory[cat];
    if (!b || b.total === 0) return undefined;
    return Math.round((b.taken / b.total) * 100);
  };
  const totalScheduled = progressRows.length;
  const totalTaken = progressRows.filter(r => r.taken).length;
  return {
    supplementPct: pct('supplement'),
    peptidePct: pct('peptide'),
    fastingPct: pct('fasting'),
    exercisePct: pct('exercise'),
    overallPct: totalScheduled > 0 ? Math.round((totalTaken / totalScheduled) * 100) : undefined,
    totalDosesScheduled: totalScheduled,
    totalDosesTaken: totalTaken,
  };
}

function buildPatientReported(intake: any, currentSelfReport: any): PatientReportedBlock {
  const mkScale = (key: string) => {
    const b = intake?.[key];
    const c = currentSelfReport?.[key];
    if (b == null || c == null) return undefined;
    return { baseline: Number(b), current: Number(c), delta: Number(c) - Number(b) };
  };
  const complaints: string[] = intake?.top_complaints ?? [];
  const resolved: string[] = currentSelfReport?.resolved_complaints ?? [];
  const improved: string[] = currentSelfReport?.improved_complaints ?? [];
  const worsened: string[] = currentSelfReport?.worsened_complaints ?? [];
  return {
    energy: mkScale('energy_scale'),
    sleepQuality: mkScale('sleep_scale'),
    cognitiveFunction: mkScale('cognition_scale'),
    complaintsResolution: complaints.map(c => ({
      complaint: c,
      status: resolved.includes(c) ? 'resolved'
        : improved.includes(c) ? 'improved'
        : worsened.includes(c) ? 'worsened'
        : 'unchanged',
    })),
  };
}

// ────────────────────────────────────────────────────────────
// Public entry point
// ────────────────────────────────────────────────────────────

export interface BuildResult {
  report: OutcomeReport;
  narrativeMethod: 'deterministic' | 'claude' | 'claude_fallback';
  narrativeSystemPromptVersion: string;
  elapsedMs: number;
}

export async function buildOutcomeReport(
  sb: SupabaseClient,
  protocolId: string,
  options: BuildOptions,
): Promise<BuildResult> {
  const start = Date.now();

  const protocol = await fetchProtocol(sb, protocolId);
  const userId: string = protocol.user_id;
  const intake = await fetchIntake(sb, protocol.intake_id);
  const startDate: string = protocol.start_date ?? protocol.created_at.split('T')[0];

  const baselineEnd = addDays(startDate, BASELINE_WINDOW_DAYS);
  const currentStart = addDays(startDate, 180 - CURRENT_WINDOW_DAYS);
  const currentEnd = addDays(startDate, 180);
  const baselineMs = new Date(startDate).toISOString();

  const [
    baselineBio,
    currentBio,
    labMarkers,
    labPanels,
    progress,
  ] = await Promise.all([
    fetchBiometricWindow(sb, userId, startDate, baselineEnd),
    fetchBiometricWindow(sb, userId, currentStart, currentEnd),
    fetchLabMarkers(sb, userId, baselineMs),
    fetchLabPanels(sb, userId),
    fetchAdherence(sb, protocolId),
  ]);

  // Split lab panels into baseline (uploaded within first 30 days) vs
  // current (uploaded in last 60 days). This is approximate on purpose —
  // the real signal is which upload has the most recent DUTCH / NutrEval.
  const startMs = new Date(startDate).getTime();
  const baselineCutoffMs = startMs + 30 * 86400000;
  const currentCutoffMs = startMs + 120 * 86400000;
  const baselinePanels = labPanels.filter((p: any) => new Date(p.date).getTime() <= baselineCutoffMs);
  const currentPanels = labPanels.filter((p: any) => new Date(p.date).getTime() >= currentCutoffMs);

  const baseFullPanel = baselinePanels[baselinePanels.length - 1];
  const currFullPanel = currentPanels[currentPanels.length - 1];

  // Baseline / current lab markers (collected in the respective windows)
  const baselineMarkers = labMarkers.filter((m: any) =>
    new Date(m.collected_at).getTime() <= baselineCutoffMs
  );
  const currentMarkers = labMarkers.filter((m: any) =>
    new Date(m.collected_at).getTime() >= currentCutoffMs
  );

  const summaryTarget = protocol.summary?.targetBiologicalAgeReduction
    ?? protocol.summary?.target_biological_age_reduction;

  const biologicalAge = buildBiologicalAge(baseFullPanel, currFullPanel, summaryTarget);
  const inflammation = buildInflammation(baselineMarkers, currentMarkers);
  const wearables = buildWearables(baselineBio, currentBio);
  const bodyComp = buildBodyComp(baselineBio, currentBio, intake);
  const labShifts = buildLabShifts(baselinePanels, currentPanels);
  const adherence = buildAdherence(progress);

  // Latest self-reported scores from lifestyle_profiles or a dedicated check-in table.
  const { data: currentSelfReport } = await sb
    .from('longevity_intakes')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const patientReported = buildPatientReported(intake, currentSelfReport);

  const completeness = computeCompleteness(
    {
      truAge: biologicalAge.baselineTruAge,
      hrv: wearables.hrv?.baseline,
      sleep: wearables.deepSleepPct?.baseline,
      crp: inflammation.crp?.baseline,
      weight: bodyComp.weight?.baseline,
    },
    {
      truAge: biologicalAge.currentTruAge,
      hrv: wearables.hrv?.current,
      sleep: wearables.deepSleepPct?.current,
      crp: inflammation.crp?.current,
      weight: bodyComp.weight?.current,
    },
    ['truAge', 'hrv', 'sleep', 'crp', 'weight'],
  );

  const partialReport: OutcomeReport = {
    protocolId,
    userId,
    generatedAt: new Date().toISOString(),
    dataCompletenessPct: completeness,
    biologicalAge,
    inflammation,
    wearables,
    bodyComp,
    labShifts,
    adherence,
    patientReported,
    narrative: { topWins: [], topGaps: [], maintenanceRecommendation: '' },
  };

  const narrativeResult = await generateNarrative(partialReport, options.useClaude);

  const finalReport: OutcomeReport = {
    ...partialReport,
    narrative: narrativeResult.narrative,
  };

  return {
    report: finalReport,
    narrativeMethod: narrativeResult.method,
    narrativeSystemPromptVersion: narrativeResult.systemPromptVersion,
    elapsedMs: Date.now() - start,
  };
}

export { NARRATIVE_SYSTEM_PROMPT_VERSION };
