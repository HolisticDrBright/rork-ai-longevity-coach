/**
 * Pure helper functions for the outcome report builder.
 * No I/O — just delta math and direction/sentiment classification.
 */

import type { Direction, MetricDelta, Sentiment } from './outcomeReportTypes';

/** True when both numbers are present and finite. */
export function hasPair(baseline?: number | null, current?: number | null): boolean {
  return (
    baseline != null && current != null &&
    Number.isFinite(baseline) && Number.isFinite(current)
  );
}

export interface DeltaOptions {
  label: string;
  unit?: string;
  baseline?: number | null;
  current?: number | null;
  // When true, lower is better (e.g. CRP, RHR, body fat).
  lowerIsBetter?: boolean;
  // Deltas smaller than this in absolute percent count as "stable".
  stableThresholdPct?: number;
}

export function buildDelta(opts: DeltaOptions): MetricDelta {
  const { label, unit, baseline, current, lowerIsBetter = false } = opts;
  const stableThreshold = opts.stableThresholdPct ?? 3;

  if (!hasPair(baseline ?? undefined, current ?? undefined)) {
    return {
      label,
      unit,
      baseline: baseline ?? undefined,
      current: current ?? undefined,
      direction: 'unknown',
      sentiment: 'neutral',
      missing: true,
      summary: `${label} not measured in both time points.`,
    };
  }

  const b = baseline as number;
  const c = current as number;
  const delta = c - b;
  const deltaPercent = b !== 0 ? (delta / Math.abs(b)) * 100 : 0;

  let direction: Direction;
  if (Math.abs(deltaPercent) < stableThreshold) direction = 'stable';
  else if (lowerIsBetter) direction = delta < 0 ? 'improved' : 'declined';
  else direction = delta > 0 ? 'improved' : 'declined';

  const sentiment: Sentiment =
    direction === 'improved' ? 'positive' :
    direction === 'declined' ? 'negative' : 'neutral';

  const unitStr = unit ? ` ${unit}` : '';
  const arrow = direction === 'improved' ? '↑' : direction === 'declined' ? '↓' : '→';
  const summary =
    direction === 'stable'
      ? `${label} held steady at ~${c.toFixed(1)}${unitStr}.`
      : `${label} ${arrow} from ${b.toFixed(1)} to ${c.toFixed(1)}${unitStr} (${deltaPercent >= 0 ? '+' : ''}${deltaPercent.toFixed(1)}%).`;

  return {
    label,
    unit,
    baseline: b,
    current: c,
    delta: Number(delta.toFixed(2)),
    deltaPercent: Number(deltaPercent.toFixed(1)),
    direction,
    sentiment,
    summary,
  };
}

/** Compute a 0-100 composite inflammation score from CRP + IL-6 + homocysteine. */
export function compositeInflammationScore(params: {
  crp?: number;
  il6?: number;
  homocysteine?: number;
}): number | undefined {
  // Penalty-based: lower is better. Cap each component.
  const crpScore = params.crp == null ? null : Math.max(0, 100 - Math.min(params.crp * 10, 100));
  const il6Score = params.il6 == null ? null : Math.max(0, 100 - Math.min(params.il6 * 15, 100));
  const homoScore = params.homocysteine == null ? null : Math.max(0, 100 - Math.min(params.homocysteine * 5, 100));

  const components = [crpScore, il6Score, homoScore].filter((v): v is number => v != null);
  if (components.length === 0) return undefined;
  const mean = components.reduce((a, b) => a + b, 0) / components.length;
  return Math.round(mean);
}

/** Average the finite numeric values of a field across rows. */
export function avg<T extends Record<string, any>>(rows: T[], field: keyof T): number | undefined {
  const values = rows
    .map(r => r[field])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Count how many of a list of fields have values in both baseline and current. */
export function computeCompleteness(
  baseline: Record<string, any>,
  current: Record<string, any>,
  requiredFields: string[],
): number {
  const present = requiredFields.filter(f =>
    baseline[f] != null && current[f] != null
  ).length;
  return Math.round((present / requiredFields.length) * 100);
}
