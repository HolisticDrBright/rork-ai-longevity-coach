// Temporal reasoning utilities (pure functions, no I/O).
// Correlation is never causation: these helpers only establish time ordering,
// windows, overlap and rechallenge patterns for downstream reasoning to weigh.

export interface DateInterval {
  start: string; // ISO
  end?: string;  // ISO; undefined = ongoing
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysBetween(aIso: string, bIso: string): number {
  return (new Date(bIso).getTime() - new Date(aIso).getTime()) / MS_PER_DAY;
}

/** True when `intervention` began strictly before `outcome` was observed. */
export function precedes(interventionStartIso: string, outcomeIso: string): boolean {
  return new Date(interventionStartIso).getTime() < new Date(outcomeIso).getTime();
}

/** Days from intervention start to outcome; null when the order is wrong. */
export function timeToResponseDays(interventionStartIso: string, outcomeIso: string): number | null {
  if (!precedes(interventionStartIso, outcomeIso)) return null;
  return daysBetween(interventionStartIso, outcomeIso);
}

export function intervalsOverlap(a: DateInterval, b: DateInterval): boolean {
  const aStart = new Date(a.start).getTime();
  const aEnd = a.end ? new Date(a.end).getTime() : Number.POSITIVE_INFINITY;
  const bStart = new Date(b.start).getTime();
  const bEnd = b.end ? new Date(b.end).getTime() : Number.POSITIVE_INFINITY;
  return aStart <= bEnd && bStart <= aEnd;
}

export interface NamedInterval extends DateInterval {
  name: string;
}

/** All pairs of interventions active at the same time (possible confounders). */
export function overlappingInterventions(intervals: NamedInterval[]): { a: string; b: string }[] {
  const pairs: { a: string; b: string }[] = [];
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      if (intervalsOverlap(intervals[i], intervals[j])) {
        pairs.push({ a: intervals[i].name, b: intervals[j].name });
      }
    }
  }
  return pairs;
}

export interface ExposurePeriod extends DateInterval {}

/**
 * Detects discontinuation followed by re-exposure (rechallenge) for one agent.
 * Requires a gap of at least `minGapDays` between periods to count.
 */
export function detectRechallenge(periods: ExposurePeriod[], minGapDays = 3): {
  discontinuations: number;
  rechallenges: number;
} {
  const sorted = [...periods]
    .filter((p) => p.start)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  let discontinuations = 0;
  let rechallenges = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (!current.end) continue; // still ongoing — no discontinuation
    const gap = daysBetween(current.end, next.start);
    if (gap >= minGapDays) {
      discontinuations += 1;
      rechallenges += 1;
    }
  }
  // A final ended period with no re-exposure is a discontinuation without rechallenge.
  const last = sorted[sorted.length - 1];
  if (last?.end) discontinuations += 1;
  return { discontinuations, rechallenges };
}

export interface WindowComparison {
  baselineMean: number | null;
  interventionMean: number | null;
  absoluteChange: number | null;
  relativeChangePercent: number | null;
  baselineCount: number;
  interventionCount: number;
}

/**
 * Compares metric values in a baseline window vs an intervention window.
 * Points are {at, value}; windows are inclusive intervals.
 */
export function compareWindows(
  points: { at: string; value: number }[],
  baseline: DateInterval,
  intervention: DateInterval
): WindowComparison {
  const inWindow = (at: string, w: DateInterval) => {
    const t = new Date(at).getTime();
    const start = new Date(w.start).getTime();
    const end = w.end ? new Date(w.end).getTime() : Number.POSITIVE_INFINITY;
    return t >= start && t <= end;
  };
  const baseVals = points.filter((p) => inWindow(p.at, baseline)).map((p) => p.value);
  const intVals = points.filter((p) => inWindow(p.at, intervention)).map((p) => p.value);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const baselineMean = mean(baseVals);
  const interventionMean = mean(intVals);
  const absoluteChange =
    baselineMean !== null && interventionMean !== null ? interventionMean - baselineMean : null;
  const relativeChangePercent =
    absoluteChange !== null && baselineMean !== null && baselineMean !== 0
      ? (absoluteChange / Math.abs(baselineMean)) * 100
      : null;
  return {
    baselineMean,
    interventionMean,
    absoluteChange,
    relativeChangePercent,
    baselineCount: baseVals.length,
    interventionCount: intVals.length,
  };
}

/**
 * Classifies a change as acute (short deviation) vs chronic (sustained) using
 * how many of the trailing `windowDays` deviate in the same direction.
 */
export function classifyChangeDuration(
  dailyDeviations: { date: string; deviated: boolean }[],
  windowDays = 14,
  chronicThreshold = 0.6
): 'acute' | 'chronic' | 'none' {
  const recent = [...dailyDeviations]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-windowDays);
  if (recent.length === 0) return 'none';
  const deviatedCount = recent.filter((d) => d.deviated).length;
  if (deviatedCount === 0) return 'none';
  return deviatedCount / recent.length >= chronicThreshold ? 'chronic' : 'acute';
}
