import { DailyBiometricRecord, TrendDirection } from '@/types/wearables';

export interface TrendAnalysis {
  mean: number | null;
  median: number | null;
  slope: number | null;
  volatility: number | null;
  bestDay: { date: string; value: number } | null;
  worstDay: { date: string; value: number } | null;
  direction: TrendDirection;
  changePercent: number;
  weekdayAvg: number | null;
  weekendAvg: number | null;
  weekdayWeekendDiff: number | null;
}

export interface WindowComparison {
  currentMean: number | null;
  priorMean: number | null;
  changePercent: number | null;
  improved: boolean | null;
}

function extractValidPairs(data: { date: string; value: number | null }[]): { date: string; value: number; index: number }[] {
  return data
    .map((d, i) => ({ date: d.date, value: d.value, index: i }))
    .filter((d): d is { date: string; value: number; index: number } => d.value !== null && !isNaN(d.value));
}

function linearRegression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function computeVolatility(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.round(Math.sqrt(variance) * 100) / 100;
}

function getMedian(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr);
  const day = d.getDay();
  return day === 0 || day === 6;
}

export function computeTrendAnalysis(
  data: { date: string; value: number | null }[],
  higherIsBetter: boolean = true
): TrendAnalysis {
  const valid = extractValidPairs(data);

  if (valid.length < 2) {
    return {
      mean: valid.length === 1 ? valid[0].value : null,
      median: valid.length === 1 ? valid[0].value : null,
      slope: null,
      volatility: null,
      bestDay: valid.length === 1 ? { date: valid[0].date, value: valid[0].value } : null,
      worstDay: valid.length === 1 ? { date: valid[0].date, value: valid[0].value } : null,
      direction: 'insufficient_data',
      changePercent: 0,
      weekdayAvg: null,
      weekendAvg: null,
      weekdayWeekendDiff: null,
    };
  }

  const values = valid.map(v => v.value);
  const sorted = [...values].sort((a, b) => a - b);
  const mean = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
  const median = Math.round(getMedian(sorted) * 10) / 10;
  const { slope } = linearRegression(values);
  const volatility = computeVolatility(values);

  const bestIdx = higherIsBetter
    ? valid.reduce((best, curr) => curr.value > best.value ? curr : best, valid[0])
    : valid.reduce((best, curr) => curr.value < best.value ? curr : best, valid[0]);
  const worstIdx = higherIsBetter
    ? valid.reduce((worst, curr) => curr.value < worst.value ? curr : worst, valid[0])
    : valid.reduce((worst, curr) => curr.value > worst.value ? curr : worst, valid[0]);

  const firstHalf = values.slice(0, Math.floor(values.length / 2));
  const secondHalf = values.slice(Math.floor(values.length / 2));
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const rawChangePct = avgFirst !== 0 ? ((avgSecond - avgFirst) / Math.abs(avgFirst)) * 100 : 0;
  const changePct = Math.round(rawChangePct * 10) / 10;

  let direction: TrendDirection;
  const threshold = 3;
  if (higherIsBetter) {
    direction = changePct > threshold ? 'improving' : changePct < -threshold ? 'declining' : 'stable';
  } else {
    direction = changePct < -threshold ? 'improving' : changePct > threshold ? 'declining' : 'stable';
  }

  const weekdayVals = valid.filter(v => !isWeekend(v.date)).map(v => v.value);
  const weekendVals = valid.filter(v => isWeekend(v.date)).map(v => v.value);
  const weekdayAvg = weekdayVals.length >= 2 ? Math.round((weekdayVals.reduce((a, b) => a + b, 0) / weekdayVals.length) * 10) / 10 : null;
  const weekendAvg = weekendVals.length >= 2 ? Math.round((weekendVals.reduce((a, b) => a + b, 0) / weekendVals.length) * 10) / 10 : null;
  const weekdayWeekendDiff = weekdayAvg !== null && weekendAvg !== null ? Math.round((weekendAvg - weekdayAvg) * 10) / 10 : null;

  return {
    mean,
    median,
    slope: Math.round(slope * 1000) / 1000,
    volatility,
    bestDay: { date: bestIdx.date, value: bestIdx.value },
    worstDay: { date: worstIdx.date, value: worstIdx.value },
    direction,
    changePercent: changePct,
    weekdayAvg,
    weekendAvg,
    weekdayWeekendDiff,
  };
}

export function computeWindowComparison(
  currentWindow: (number | null)[],
  priorWindow: (number | null)[]
): WindowComparison {
  const currentValid = currentWindow.filter((v): v is number => v !== null);
  const priorValid = priorWindow.filter((v): v is number => v !== null);

  if (currentValid.length < 2 || priorValid.length < 2) {
    return { currentMean: null, priorMean: null, changePercent: null, improved: null };
  }

  const currentMean = currentValid.reduce((a, b) => a + b, 0) / currentValid.length;
  const priorMean = priorValid.reduce((a, b) => a + b, 0) / priorValid.length;
  const changePercent = priorMean !== 0 ? Math.round(((currentMean - priorMean) / Math.abs(priorMean)) * 1000) / 10 : 0;

  return {
    currentMean: Math.round(currentMean * 10) / 10,
    priorMean: Math.round(priorMean * 10) / 10,
    changePercent,
    improved: changePercent > 0,
  };
}

export function detectWeeklyPattern(
  records: DailyBiometricRecord[],
  metric: keyof DailyBiometricRecord
): { weekday: number; avgValue: number }[] {
  const dayBuckets: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

  for (const r of records) {
    const val = r[metric];
    if (val === null || val === undefined || typeof val !== 'number') continue;
    const day = new Date(r.date).getDay();
    dayBuckets[day].push(val);
  }

  return Object.entries(dayBuckets)
    .filter(([_, vals]) => vals.length >= 1)
    .map(([day, vals]) => ({
      weekday: parseInt(day),
      avgValue: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
    }));
}

export function detectWeekdayWeekendEffect(
  records: DailyBiometricRecord[],
  metric: keyof DailyBiometricRecord
): { weekdayAvg: number | null; weekendAvg: number | null; difference: number | null; significant: boolean } {
  const weekdayVals: number[] = [];
  const weekendVals: number[] = [];

  for (const r of records) {
    const val = r[metric];
    if (val === null || val === undefined || typeof val !== 'number') continue;
    if (isWeekend(r.date)) {
      weekendVals.push(val);
    } else {
      weekdayVals.push(val);
    }
  }

  const weekdayAvg = weekdayVals.length >= 2 ? Math.round((weekdayVals.reduce((a, b) => a + b, 0) / weekdayVals.length) * 10) / 10 : null;
  const weekendAvg = weekendVals.length >= 2 ? Math.round((weekendVals.reduce((a, b) => a + b, 0) / weekendVals.length) * 10) / 10 : null;
  const difference = weekdayAvg !== null && weekendAvg !== null ? Math.round((weekendAvg - weekdayAvg) * 10) / 10 : null;
  const significant = difference !== null && Math.abs(difference) > (weekdayAvg !== null ? weekdayAvg * 0.08 : 5);

  return { weekdayAvg, weekendAvg, difference, significant };
}

export interface CycleLinkedTrend {
  phase: string;
  metricAvg: number | null;
  sampleCount: number;
}

export function computeCycleLinkedTrends(
  records: DailyBiometricRecord[],
  metric: keyof DailyBiometricRecord
): CycleLinkedTrend[] {
  const phases = ['menstrual', 'follicular', 'ovulatory', 'luteal'];
  const phaseBuckets: Record<string, number[]> = {};
  for (const p of phases) phaseBuckets[p] = [];

  for (const r of records) {
    if (!r.cyclePhase || r.cyclePhase === 'unknown') continue;
    const val = r[metric];
    if (val === null || val === undefined || typeof val !== 'number') continue;
    phaseBuckets[r.cyclePhase]?.push(val);
  }

  return phases.map(phase => ({
    phase,
    metricAvg: phaseBuckets[phase].length >= 2
      ? Math.round((phaseBuckets[phase].reduce((a, b) => a + b, 0) / phaseBuckets[phase].length) * 10) / 10
      : null,
    sampleCount: phaseBuckets[phase].length,
  }));
}
