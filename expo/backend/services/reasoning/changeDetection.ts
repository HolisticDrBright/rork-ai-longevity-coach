// Deterministic change detection: compares recent daily biometrics against
// stored baselines and recent lab markers against reference ranges.
// No LLM involved — outputs are rule_engine-sourced observations.

import type { DetectedChange, DataQualityIssue, MissingDataRecommendation } from '@/types/reasoning';

export type DailyMetricRow = Record<string, unknown> & { date: string };

export type BaselineRow = Record<string, unknown>;

interface MetricSpec {
  key: string;
  baselineKey: string;
  label: string;
  unit?: string;
  /** Relative change (fraction of baseline) that counts as notable/significant. */
  notablePct: number;
  significantPct: number;
  /** Direction that is clinically adverse; both = any deviation matters. */
  adverseDirection: 'increase' | 'decrease' | 'both';
}

// Mirrors the metrics the wearable engines already compute baselines for.
const METRIC_SPECS: MetricSpec[] = [
  { key: 'hrv', baselineKey: 'hrv_baseline', label: 'HRV', unit: 'ms', notablePct: 0.1, significantPct: 0.2, adverseDirection: 'decrease' },
  { key: 'resting_hr', baselineKey: 'resting_hr_baseline', label: 'Resting heart rate', unit: 'bpm', notablePct: 0.07, significantPct: 0.15, adverseDirection: 'increase' },
  { key: 'sleep_duration_minutes', baselineKey: 'sleep_duration_baseline', label: 'Sleep duration', unit: 'min', notablePct: 0.15, significantPct: 0.3, adverseDirection: 'decrease' },
  { key: 'sleep_efficiency', baselineKey: 'sleep_efficiency_baseline', label: 'Sleep efficiency', unit: '%', notablePct: 0.08, significantPct: 0.15, adverseDirection: 'decrease' },
  { key: 'respiratory_rate', baselineKey: 'respiratory_rate_baseline', label: 'Respiratory rate', unit: 'br/min', notablePct: 0.08, significantPct: 0.15, adverseDirection: 'increase' },
  { key: 'temp_deviation', baselineKey: 'temp_deviation_baseline', label: 'Temperature deviation', unit: '°C', notablePct: 0.5, significantPct: 1.0, adverseDirection: 'both' },
  { key: 'steps', baselineKey: 'steps_baseline', label: 'Steps', notablePct: 0.3, significantPct: 0.5, adverseDirection: 'decrease' },
];

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function numeric(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Detects meaningful deviations of the recent window (default 7 days) from the
 * stored baseline. Returns changes sorted most-significant first.
 */
export function detectBiometricChanges(
  recentDays: DailyMetricRow[],
  baseline: BaselineRow | null,
  windowDays = 7
): DetectedChange[] {
  if (!baseline || recentDays.length === 0) return [];
  const window = [...recentDays]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-windowDays);
  const changes: DetectedChange[] = [];
  const lastDate = String(window[window.length - 1]?.date ?? '');

  for (const spec of METRIC_SPECS) {
    const baseVal = numeric(baseline[spec.baselineKey]);
    if (baseVal === null || baseVal === 0) continue;
    const values = window.map((d) => numeric(d[spec.key])).filter((v): v is number => v !== null);
    if (values.length < Math.min(3, windowDays)) continue;
    const current = mean(values);
    if (current === null) continue;

    const delta = current - baseVal;
    const relative = Math.abs(delta) / Math.abs(baseVal);
    if (relative < spec.notablePct) continue;

    const direction: DetectedChange['direction'] = delta > 0 ? 'increase' : 'decrease';
    const isAdverse = spec.adverseDirection === 'both' || spec.adverseDirection === direction;
    const severity: DetectedChange['severity'] =
      relative >= spec.significantPct && isAdverse ? 'significant' : isAdverse ? 'notable' : 'info';

    changes.push({
      metric: spec.key,
      label: spec.label,
      direction,
      magnitudePercent: Math.round(relative * 1000) / 10,
      currentValue: Math.round(current * 100) / 100,
      baselineValue: Math.round(baseVal * 100) / 100,
      unit: spec.unit,
      windowDays,
      severity,
      dataQuality: values.length / windowDays,
      observedAt: lastDate ? new Date(`${lastDate}T12:00:00Z`).toISOString() : new Date().toISOString(),
    });
  }

  const order = { significant: 0, notable: 1, info: 2 } as const;
  return changes.sort((a, b) => order[a.severity] - order[b.severity] || b.magnitudePercent - a.magnitudePercent);
}

export interface LabMarkerPoint {
  markerName: string;
  value: number;
  unit?: string;
  referenceLow?: number | null;
  referenceHigh?: number | null;
  collectedAt: string;
}

/** Flags out-of-range lab markers and marker-over-marker shifts (>20%). */
export function detectLabChanges(markers: LabMarkerPoint[]): DetectedChange[] {
  const changes: DetectedChange[] = [];
  const byName = new Map<string, LabMarkerPoint[]>();
  for (const m of markers) {
    const list = byName.get(m.markerName) ?? [];
    list.push(m);
    byName.set(m.markerName, list);
  }

  for (const [name, points] of byName) {
    const sorted = points.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
    const latest = sorted[sorted.length - 1];
    const prior = sorted.length > 1 ? sorted[sorted.length - 2] : null;

    const low = latest.referenceLow ?? null;
    const high = latest.referenceHigh ?? null;
    const outOfRange =
      (low !== null && latest.value < low) || (high !== null && latest.value > high);

    if (outOfRange) {
      const direction = high !== null && latest.value > high ? 'increase' : 'decrease';
      const bound = direction === 'increase' ? high! : low!;
      const magnitude = bound !== 0 ? Math.abs((latest.value - bound) / bound) * 100 : 100;
      changes.push({
        metric: `lab:${name}`,
        label: name,
        direction,
        magnitudePercent: Math.round(magnitude * 10) / 10,
        currentValue: latest.value,
        baselineValue: bound,
        unit: latest.unit,
        windowDays: 0,
        severity: magnitude >= 25 ? 'significant' : 'notable',
        observedAt: latest.collectedAt,
      });
    } else if (prior && prior.value !== 0) {
      const rel = (latest.value - prior.value) / Math.abs(prior.value);
      if (Math.abs(rel) >= 0.2) {
        changes.push({
          metric: `lab:${name}`,
          label: name,
          direction: rel > 0 ? 'increase' : 'decrease',
          magnitudePercent: Math.round(Math.abs(rel) * 1000) / 10,
          currentValue: latest.value,
          baselineValue: prior.value,
          unit: latest.unit,
          windowDays: Math.max(1, Math.round(
            (new Date(latest.collectedAt).getTime() - new Date(prior.collectedAt).getTime()) / 86400000
          )),
          severity: 'notable',
          observedAt: latest.collectedAt,
        });
      }
    }
  }
  return changes;
}

/** Identifies stale/missing data streams worth asking the patient about. */
export function assessDataQuality(input: {
  lastWearableDate?: string | null;
  lastLabDate?: string | null;
  lastSymptomDate?: string | null;
  now?: Date;
}): { issues: DataQualityIssue[]; missing: MissingDataRecommendation[] } {
  const now = input.now ?? new Date();
  const issues: DataQualityIssue[] = [];
  const missing: MissingDataRecommendation[] = [];
  const ageDays = (iso?: string | null) =>
    iso ? (now.getTime() - new Date(iso).getTime()) / 86400000 : Infinity;

  const wearableAge = ageDays(input.lastWearableDate);
  if (wearableAge === Infinity) {
    missing.push({
      subject: 'wearables',
      reason: 'No wearable data has been synced.',
      suggestion: 'Connect a wearable to enable recovery and trend analysis.',
    });
  } else if (wearableAge > 3) {
    issues.push({
      kind: 'stale',
      subject: 'wearables',
      detail: `Last wearable sync was ${Math.floor(wearableAge)} days ago.`,
    });
  }

  const labAge = ageDays(input.lastLabDate);
  if (labAge === Infinity) {
    missing.push({
      subject: 'labs',
      reason: 'No lab results on record.',
      suggestion: 'Upload recent lab work to anchor biomarker reasoning.',
    });
  } else if (labAge > 200) {
    issues.push({
      kind: 'stale',
      subject: 'labs',
      detail: `Most recent lab collection is ${Math.floor(labAge)} days old.`,
    });
  }

  const symptomAge = ageDays(input.lastSymptomDate);
  if (symptomAge > 14 && symptomAge !== Infinity) {
    issues.push({
      kind: 'stale',
      subject: 'symptoms',
      detail: `No symptom check-ins in ${Math.floor(symptomAge)} days.`,
    });
  }

  return { issues, missing };
}
