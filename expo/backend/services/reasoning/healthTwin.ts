// Adaptive Health Twin — Layers 1 (current state) and 2 (systems model).
// Pure computation over existing rows + the hypothesis ledger. This is a
// personalized response/status model, NOT a biological simulation, and scores
// are "support levels", not diagnostic probabilities (ADR 0002 §7).

import type { ClinicalHypothesis, DetectedChange, ReasoningSourceType } from '@/types/reasoning';
import type { LabMarkerPoint } from './changeDetection';
import { TWIN_SYSTEM_KEYS, type TwinSystemKey } from './hypothesisRules';

export const TWIN_SYSTEM_LABELS: Record<TwinSystemKey, string> = {
  metabolic: 'Metabolic health',
  cardiovascular: 'Cardiovascular health',
  inflammation_immune: 'Inflammation & immune regulation',
  hormonal: 'Hormonal health',
  gastrointestinal: 'Gastrointestinal health',
  detoxification: 'Detoxification & exposure burden',
  mitochondrial_energy: 'Mitochondrial & energy function',
  neuro_cognitive: 'Neurological & cognitive function',
  musculoskeletal: 'Musculoskeletal health',
  stress_autonomic: 'Stress & autonomic regulation',
  sleep_circadian: 'Sleep & circadian health',
  healthy_aging: 'Healthy aging & functional capacity',
};

interface SystemMatcher {
  markerPatterns: RegExp[];
  changeMetrics: string[];
  symptomPatterns: RegExp[];
}

const SYSTEM_MATCHERS: Record<TwinSystemKey, SystemMatcher> = {
  metabolic: {
    markerPatterns: [/glucose/i, /a1c/i, /insulin/i, /triglycerid/i],
    changeMetrics: ['lab:glucose'],
    symptomPatterns: [/craving/i, /energy crash/i],
  },
  cardiovascular: {
    markerPatterns: [/ldl/i, /hdl/i, /cholesterol/i, /apob/i, /lp\(a\)/i, /triglycerid/i, /blood ?pressure/i],
    changeMetrics: ['resting_hr'],
    symptomPatterns: [/palpitation/i, /chest/i],
  },
  inflammation_immune: {
    markerPatterns: [/crp/i, /esr/i, /homocysteine/i, /ferritin/i, /wbc/i, /vitamin ?d/i],
    changeMetrics: ['temp_deviation'],
    symptomPatterns: [/joint pain/i, /swelling/i, /sick/i, /allerg/i],
  },
  hormonal: {
    markerPatterns: [/tsh/i, /t3/i, /t4/i, /testosterone/i, /estradiol/i, /progesterone/i, /dhea/i, /cortisol/i],
    changeMetrics: [],
    symptomPatterns: [/libido/i, /hot flash/i, /pms/i, /cycle/i],
  },
  gastrointestinal: {
    markerPatterns: [/calprotectin/i, /zonulin/i, /elastase/i],
    changeMetrics: [],
    symptomPatterns: [/bloat/i, /digest/i, /bowel/i, /constipat/i, /diarrhea/i, /reflux/i, /nausea/i],
  },
  detoxification: {
    markerPatterns: [/alt/i, /ast/i, /ggt/i, /bilirubin/i, /alkaline phosphatase/i],
    changeMetrics: [],
    symptomPatterns: [/chemical sensitivity/i],
  },
  mitochondrial_energy: {
    markerPatterns: [/ferritin/i, /b12/i, /coq10/i, /carnitine/i, /lactate/i],
    changeMetrics: ['hrv'],
    symptomPatterns: [/fatigue/i, /energy/i, /exhaust/i, /tired/i],
  },
  neuro_cognitive: {
    markerPatterns: [/b12/i, /homocysteine/i, /omega/i],
    changeMetrics: [],
    symptomPatterns: [/brain fog/i, /focus/i, /memory/i, /headache/i, /migraine/i],
  },
  musculoskeletal: {
    markerPatterns: [/vitamin ?d/i, /calcium/i, /ck\b/i, /creatine kinase/i],
    changeMetrics: ['steps'],
    symptomPatterns: [/joint/i, /muscle/i, /soreness/i, /back pain/i, /injur/i],
  },
  stress_autonomic: {
    markerPatterns: [/cortisol/i],
    changeMetrics: ['hrv', 'resting_hr', 'respiratory_rate'],
    symptomPatterns: [/stress/i, /anxiet/i, /overwhelm/i, /irritab/i],
  },
  sleep_circadian: {
    markerPatterns: [/melatonin/i],
    changeMetrics: ['sleep_duration_minutes', 'sleep_efficiency'],
    symptomPatterns: [/sleep/i, /insomnia/i, /waking/i],
  },
  healthy_aging: {
    markerPatterns: [/a1c/i, /crp/i, /dhea/i, /igf/i, /albumin/i],
    changeMetrics: ['steps', 'hrv'],
    symptomPatterns: [],
  },
};

export interface TwinContributor {
  summary: string;
  direction: 'concern' | 'reassuring';
  sourceType: ReasoningSourceType;
  observedAt?: string;
}

export interface TwinSystemState {
  key: TwinSystemKey;
  label: string;
  /** 0–100 support level for this system's current health; null = insufficient data. */
  score: number | null;
  trend: 'improving' | 'stable' | 'worsening' | 'unknown';
  contributors: TwinContributor[];
  contradictions: string[];
  dataQuality: number;
  missingData: string[];
  reviewStatus: 'none_pending' | 'pending_review';
  hypotheses: { id: string; name: string; supportScore: number; status: string }[];
}

export interface TwinInputs {
  labPoints: LabMarkerPoint[];
  changes: DetectedChange[];
  symptomRows: Record<string, unknown>[];
  hypotheses: ClinicalHypothesis[];
  hasWearableData: boolean;
  hasLabData: boolean;
  hasSymptomData: boolean;
  previousSystems?: { key: string; score: number | null }[];
}

function latestPerMarker(points: LabMarkerPoint[]): LabMarkerPoint[] {
  const byName = new Map<string, LabMarkerPoint>();
  for (const p of points) {
    const existing = byName.get(p.markerName.toLowerCase());
    if (!existing || p.collectedAt > existing.collectedAt) {
      byName.set(p.markerName.toLowerCase(), p);
    }
  }
  return [...byName.values()];
}

function outOfRange(p: LabMarkerPoint): boolean {
  if (p.referenceLow != null && p.value < p.referenceLow) return true;
  if (p.referenceHigh != null && p.value > p.referenceHigh) return true;
  return false;
}

export function computeSystemsModel(inputs: TwinInputs): TwinSystemState[] {
  const markers = latestPerMarker(inputs.labPoints);
  const prevByKey = new Map((inputs.previousSystems ?? []).map((s) => [s.key, s.score]));
  const activeHypotheses = inputs.hypotheses.filter(
    (h) => h.status !== 'rejected' && h.status !== 'archived'
  );

  return TWIN_SYSTEM_KEYS.map((key) => {
    const matcher = SYSTEM_MATCHERS[key];
    const contributors: TwinContributor[] = [];
    const contradictions: string[] = [];
    let penalty = 0;
    let hasAnyData = false;

    for (const m of markers) {
      if (!matcher.markerPatterns.some((rx) => rx.test(m.markerName))) continue;
      hasAnyData = true;
      if (outOfRange(m)) {
        penalty += 15;
        contributors.push({
          summary: `${m.markerName} ${m.value}${m.unit ? ` ${m.unit}` : ''} outside reference range`,
          direction: 'concern',
          sourceType: 'measured',
          observedAt: m.collectedAt,
        });
      } else {
        contributors.push({
          summary: `${m.markerName} within range`,
          direction: 'reassuring',
          sourceType: 'measured',
          observedAt: m.collectedAt,
        });
      }
    }

    for (const c of inputs.changes) {
      if (!matcher.changeMetrics.includes(c.metric)) continue;
      hasAnyData = true;
      if (c.severity === 'significant') penalty += 15;
      else if (c.severity === 'notable') penalty += 8;
      contributors.push({
        summary: `${c.label} ${c.direction} ${c.magnitudePercent}% vs baseline`,
        direction: c.severity === 'info' ? 'reassuring' : 'concern',
        sourceType: 'rule_engine',
        observedAt: c.observedAt,
      });
    }

    let symptomHits = 0;
    for (const row of inputs.symptomRows) {
      const name = String(row.symptom_name ?? '');
      const severity = typeof row.severity === 'number' ? row.severity : null;
      if (!matcher.symptomPatterns.some((rx) => rx.test(name))) continue;
      hasAnyData = true;
      if ((severity ?? 0) >= 6 && symptomHits < 2) {
        penalty += 10;
        symptomHits += 1;
        contributors.push({
          summary: `Reported ${name} severity ${severity}/10`,
          direction: 'concern',
          sourceType: 'patient_reported',
          observedAt: String(row.logged_at ?? '') || undefined,
        });
      }
    }

    const systemHypotheses = activeHypotheses.filter((h) => h.systems.includes(key));
    for (const h of systemHypotheses) {
      if (h.status === 'supported') penalty += 10;
      const contra = (h.contradictingEvidence ?? []).slice(0, 2);
      for (const e of contra) contradictions.push(e.summary);
    }

    const streams = [
      { relevant: matcher.markerPatterns.length > 0, present: inputs.hasLabData },
      { relevant: matcher.changeMetrics.length > 0, present: inputs.hasWearableData },
      { relevant: matcher.symptomPatterns.length > 0, present: inputs.hasSymptomData },
    ].filter((s) => s.relevant);
    const dataQuality = streams.length
      ? streams.filter((s) => s.present).length / streams.length
      : 0;

    const missingData: string[] = [];
    if (matcher.markerPatterns.length > 0 && !markers.some((m) => matcher.markerPatterns.some((rx) => rx.test(m.markerName)))) {
      missingData.push('No relevant lab markers on record');
    }
    if (matcher.changeMetrics.length > 0 && !inputs.hasWearableData) {
      missingData.push('No wearable data');
    }

    const score = hasAnyData ? Math.max(5, Math.min(100, 100 - penalty)) : null;
    const prev = prevByKey.get(key);
    let trend: TwinSystemState['trend'] = 'unknown';
    if (score !== null && prev !== undefined && prev !== null) {
      trend = score - prev >= 5 ? 'improving' : prev - score >= 5 ? 'worsening' : 'stable';
    }

    return {
      key,
      label: TWIN_SYSTEM_LABELS[key],
      score,
      trend,
      contributors: contributors.slice(0, 8),
      contradictions: contradictions.slice(0, 4),
      dataQuality: Math.round(dataQuality * 100) / 100,
      missingData,
      reviewStatus: systemHypotheses.some((h) => h.reviewStatus === 'pending_review')
        ? 'pending_review'
        : 'none_pending',
      hypotheses: systemHypotheses.map((h) => ({
        id: h.id,
        name: h.name,
        supportScore: h.supportScore,
        status: h.status,
      })),
    };
  });
}

export interface TwinCurrentState {
  goals: string[];
  activeSymptoms: { name: string; severity: number | null; lastLoggedAt: string }[];
  medications: string[];
  supplements: string[];
  risks: { summary: string; severity: string; source: ReasoningSourceType }[];
  abnormalBiomarkers: {
    name: string;
    value: number;
    unit?: string;
    referenceLow?: number | null;
    referenceHigh?: number | null;
    collectedAt: string;
  }[];
  patterns: {
    avgSleepMinutes: number | null;
    avgHrv: number | null;
    avgRestingHr: number | null;
    avgSteps: number | null;
    checkinDays: number;
  };
}

export function computeCurrentState(input: {
  goals: string[];
  symptomRows: Record<string, unknown>[];
  medications: string[];
  supplementNames: string[];
  flagRows: Record<string, unknown>[];
  labPoints: LabMarkerPoint[];
  biometricRows: Record<string, unknown>[];
  changes: DetectedChange[];
}): TwinCurrentState {
  const symptomLatest = new Map<string, { severity: number | null; lastLoggedAt: string }>();
  for (const row of input.symptomRows) {
    const name = String(row.symptom_name ?? '');
    const at = String(row.logged_at ?? '');
    const existing = symptomLatest.get(name);
    if (!existing || at > existing.lastLoggedAt) {
      symptomLatest.set(name, {
        severity: typeof row.severity === 'number' ? row.severity : null,
        lastLoggedAt: at,
      });
    }
  }

  const abnormal = latestPerMarker(input.labPoints)
    .filter(outOfRange)
    .map((m) => ({
      name: m.markerName,
      value: m.value,
      unit: m.unit,
      referenceLow: m.referenceLow,
      referenceHigh: m.referenceHigh,
      collectedAt: m.collectedAt,
    }));

  const risks: TwinCurrentState['risks'] = [
    ...input.flagRows
      .filter((r) => r.resolved !== true)
      .map((r) => ({
        summary: String(r.summary ?? r.flag_type ?? 'Practitioner flag'),
        severity: String(r.severity ?? 'moderate'),
        source: 'rule_engine' as const,
      })),
    ...input.changes
      .filter((c) => c.severity === 'significant')
      .map((c) => ({
        summary: `${c.label} ${c.direction} ${c.magnitudePercent}% vs baseline`,
        severity: 'moderate',
        source: 'rule_engine' as const,
      })),
  ].slice(0, 10);

  const nums = (key: string) =>
    input.biometricRows
      .map((r) => r[key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

  return {
    goals: input.goals,
    activeSymptoms: [...symptomLatest.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0))
      .slice(0, 10),
    medications: input.medications,
    supplements: input.supplementNames.slice(0, 20),
    risks,
    abnormalBiomarkers: abnormal.slice(0, 15),
    patterns: {
      avgSleepMinutes: avg(nums('sleep_duration_minutes')),
      avgHrv: avg(nums('hrv')),
      avgRestingHr: avg(nums('resting_hr')),
      avgSteps: avg(nums('steps')),
      checkinDays: input.biometricRows.length,
    },
  };
}
