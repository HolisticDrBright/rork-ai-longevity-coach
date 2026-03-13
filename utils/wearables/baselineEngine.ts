import { DailyBiometricRecord, UserBaseline } from '@/types/wearables';

function safeNum(val: number | null): number | null {
  return val !== null && !isNaN(val) ? val : null;
}

function computeRollingAvg(
  values: (number | null)[],
  minSamples: number = 3
): number | null {
  const valid = values.filter((v): v is number => v !== null && !isNaN(v));
  if (valid.length < minSamples) return null;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10;
}

function computeWeightedRollingAvg(
  values: (number | null)[],
  minSamples: number = 3
): number | null {
  const valid = values
    .map((v, i) => ({ v, i }))
    .filter((item): item is { v: number; i: number } => item.v !== null && !isNaN(item.v));
  if (valid.length < minSamples) return null;

  let weightSum = 0;
  let weightedTotal = 0;
  for (const item of valid) {
    const recency = 1 + (valid.length - item.i) * 0.05;
    weightedTotal += item.v * recency;
    weightSum += recency;
  }
  return Math.round((weightedTotal / weightSum) * 10) / 10;
}

function computeCircularTimeAvg(
  times: (string | null)[],
  minSamples: number = 3
): string | null {
  const validMinutes: number[] = [];
  for (const t of times) {
    if (!t) continue;
    const parts = t.split(':');
    if (parts.length < 2) continue;
    let hours = parseInt(parts[0]);
    const mins = parseInt(parts[1]);
    if (isNaN(hours) || isNaN(mins)) continue;
    if (hours < 12) hours += 24;
    validMinutes.push(hours * 60 + mins);
  }
  if (validMinutes.length < minSamples) return null;

  const avg = validMinutes.reduce((a, b) => a + b, 0) / validMinutes.length;
  let avgHours = Math.floor(avg / 60);
  const avgMins = Math.round(avg % 60);
  if (avgHours >= 24) avgHours -= 24;
  return `${avgHours.toString().padStart(2, '0')}:${avgMins.toString().padStart(2, '0')}`;
}

export function computeRollingBaseline(
  records: DailyBiometricRecord[],
  metric: keyof DailyBiometricRecord,
  days: number,
  minSamples: number = 3
): number | null {
  const slice = records.slice(0, days);
  const values = slice.map(r => safeNum(r[metric] as number | null));
  return computeRollingAvg(values, minSamples);
}

export function computeDeviationPercent(
  current: number | null,
  baseline: number | null
): number | null {
  if (current === null || baseline === null || baseline === 0) return null;
  return Math.round(((current - baseline) / Math.abs(baseline)) * 1000) / 10;
}

export function classifyDeviation(
  deviationPercent: number | null,
  thresholds: { mild: number; moderate: number; severe: number },
  inverted: boolean = false
): 'normal' | 'mild' | 'moderate' | 'severe' {
  if (deviationPercent === null) return 'normal';
  const absDev = Math.abs(deviationPercent);
  const isNegative = inverted ? deviationPercent > 0 : deviationPercent < 0;

  if (!isNegative) return 'normal';
  if (absDev >= thresholds.severe) return 'severe';
  if (absDev >= thresholds.moderate) return 'moderate';
  if (absDev >= thresholds.mild) return 'mild';
  return 'normal';
}

export function generateBaseline(records: DailyBiometricRecord[]): UserBaseline {
  const slice7 = records.slice(0, 7);
  const slice14 = records.slice(0, 14);
  const slice30 = records.slice(0, 30);

  const avgN = (arr: (number | null)[], min: number = 3): number | null => computeRollingAvg(arr, min);
  const wAvgN = (arr: (number | null)[], min: number = 3): number | null => computeWeightedRollingAvg(arr, min);

  return {
    userId: records[0]?.userId ?? 'unknown',
    updatedAt: new Date().toISOString(),
    hrv7Day: wAvgN(slice7.map(r => r.hrv), 4),
    hrv14Day: wAvgN(slice14.map(r => r.hrv), 5),
    hrv30Day: avgN(slice30.map(r => r.hrv), 7),
    restingHr7Day: wAvgN(slice7.map(r => r.restingHr), 4),
    restingHr14Day: wAvgN(slice14.map(r => r.restingHr), 5),
    restingHr30Day: avgN(slice30.map(r => r.restingHr), 7),
    sleepDuration7Day: avgN(slice7.map(r => r.sleepDurationMinutes)),
    sleepDuration14Day: avgN(slice14.map(r => r.sleepDurationMinutes)),
    sleepDuration30Day: avgN(slice30.map(r => r.sleepDurationMinutes)),
    sleepEfficiency7Day: avgN(slice7.map(r => r.sleepEfficiency)),
    sleepEfficiency14Day: avgN(slice14.map(r => r.sleepEfficiency)),
    sleepEfficiency30Day: avgN(slice30.map(r => r.sleepEfficiency)),
    steps7Day: avgN(slice7.map(r => r.steps)),
    steps14Day: avgN(slice14.map(r => r.steps)),
    steps30Day: avgN(slice30.map(r => r.steps)),
    respiratoryRate7Day: avgN(slice7.map(r => r.respiratoryRate)),
    respiratoryRate14Day: avgN(slice14.map(r => r.respiratoryRate)),
    tempDeviation7Day: avgN(slice7.map(r => r.tempDeviation)),
    tempDeviation14Day: avgN(slice14.map(r => r.tempDeviation)),
    bedtimeAvg: computeCircularTimeAvg(slice14.map(r => r.bedtime)) ?? '22:30',
    wakeTimeAvg: computeCircularTimeAvg(slice14.map(r => r.wakeTime)) ?? '06:45',
    weight7Day: avgN(slice7.map(r => r.weight)),
    weight30Day: avgN(slice30.map(r => r.weight)),
  };
}

export interface DataCompletenessResult {
  score: number;
  availableMetrics: string[];
  missingMetrics: string[];
  confidenceLevel: 'low' | 'moderate' | 'high';
}

export function computeDataCompleteness(record: DailyBiometricRecord): DataCompletenessResult {
  const metricsToCheck: { key: keyof DailyBiometricRecord; weight: number; label: string }[] = [
    { key: 'hrv', weight: 15, label: 'HRV' },
    { key: 'restingHr', weight: 12, label: 'Resting HR' },
    { key: 'sleepDurationMinutes', weight: 12, label: 'Sleep duration' },
    { key: 'sleepEfficiency', weight: 8, label: 'Sleep efficiency' },
    { key: 'deepSleepMinutes', weight: 6, label: 'Deep sleep' },
    { key: 'remSleepMinutes', weight: 6, label: 'REM sleep' },
    { key: 'steps', weight: 5, label: 'Steps' },
    { key: 'activeMinutes', weight: 4, label: 'Active minutes' },
    { key: 'respiratoryRate', weight: 5, label: 'Respiratory rate' },
    { key: 'tempDeviation', weight: 4, label: 'Temperature' },
    { key: 'energyScore', weight: 4, label: 'Energy score' },
    { key: 'stressScoreSubjective', weight: 3, label: 'Stress score' },
    { key: 'sorenessScore', weight: 3, label: 'Soreness' },
    { key: 'moodScore', weight: 3, label: 'Mood' },
    { key: 'hydrationMl', weight: 3, label: 'Hydration' },
    { key: 'sleepScore', weight: 4, label: 'Sleep score' },
    { key: 'weight', weight: 3, label: 'Weight' },
  ];

  const available: string[] = [];
  const missing: string[] = [];
  let totalWeight = 0;
  let achievedWeight = 0;

  for (const m of metricsToCheck) {
    totalWeight += m.weight;
    const val = record[m.key];
    if (val !== null && val !== undefined) {
      available.push(m.label);
      achievedWeight += m.weight;
    } else {
      missing.push(m.label);
    }
  }

  const score = Math.round((achievedWeight / totalWeight) * 100);
  const confidenceLevel: 'low' | 'moderate' | 'high' =
    score >= 70 ? 'high' : score >= 45 ? 'moderate' : 'low';

  return { score, availableMetrics: available, missingMetrics: missing, confidenceLevel };
}

export interface BaselineDeviation {
  metric: string;
  current: number | null;
  baseline: number | null;
  deviationPercent: number | null;
  classification: 'normal' | 'mild' | 'moderate' | 'severe';
  direction: 'above' | 'below' | 'at' | 'unknown';
}

export function computeAllDeviations(
  record: DailyBiometricRecord,
  baseline: UserBaseline
): BaselineDeviation[] {
  const deviations: BaselineDeviation[] = [];

  const addDeviation = (
    metric: string,
    current: number | null,
    baselineVal: number | null,
    thresholds: { mild: number; moderate: number; severe: number },
    inverted: boolean = false
  ) => {
    const devPct = computeDeviationPercent(current, baselineVal);
    const classification = classifyDeviation(devPct, thresholds, inverted);
    const direction: BaselineDeviation['direction'] =
      current === null || baselineVal === null ? 'unknown'
        : current > baselineVal ? 'above'
          : current < baselineVal ? 'below' : 'at';

    deviations.push({ metric, current, baseline: baselineVal, deviationPercent: devPct, classification, direction });
  };

  addDeviation('HRV', record.hrv, baseline.hrv14Day, { mild: 5, moderate: 10, severe: 20 });
  addDeviation('Resting HR', record.restingHr, baseline.restingHr14Day, { mild: 3, moderate: 7, severe: 12 }, true);
  addDeviation('Sleep Duration', record.sleepDurationMinutes, baseline.sleepDuration14Day, { mild: 8, moderate: 15, severe: 25 });
  addDeviation('Sleep Efficiency', record.sleepEfficiency, baseline.sleepEfficiency14Day, { mild: 5, moderate: 10, severe: 18 });
  addDeviation('Steps', record.steps, baseline.steps14Day, { mild: 20, moderate: 35, severe: 50 });
  addDeviation('Respiratory Rate', record.respiratoryRate, baseline.respiratoryRate14Day, { mild: 5, moderate: 10, severe: 15 }, true);

  return deviations;
}
