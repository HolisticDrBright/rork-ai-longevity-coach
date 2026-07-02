process.env.TZ = 'UTC';

import { describe, test, expect } from 'vitest';
import { generateBaseline, computeRollingBaseline } from '@/utils/wearables/baselineEngine';
import { makeRecord } from './test-helpers';
import type { DailyBiometricRecord } from '@/types/wearables';

/** Build newest-first records: index 0 is today. */
function newestFirst(perDay: Partial<DailyBiometricRecord>[]): DailyBiometricRecord[] {
  return perDay.map((overrides, i) => {
    const d = new Date(Date.UTC(2026, 6, 10) - i * 86400000);
    return makeRecord({
      id: `rec-${i}`,
      date: d.toISOString().substring(0, 10),
      ...overrides,
    });
  });
}

describe('generateBaseline (bug 3c: today must be excluded from its own baseline)', () => {
  test("today's anomalous HRV does not contaminate the baseline it is compared against", () => {
    // Today spikes to 100; the prior 8 days are all steady at 50.
    const records = newestFirst([
      { hrv: 100 },
      { hrv: 50 }, { hrv: 50 }, { hrv: 50 }, { hrv: 50 },
      { hrv: 50 }, { hrv: 50 }, { hrv: 50 }, { hrv: 50 },
    ]);

    const baseline = generateBaseline(records);
    expect(baseline.hrv7Day).toBe(50);
    expect(baseline.hrv14Day).toBe(50);
  });

  test('excludeCurrentDay: false keeps the old include-today behavior', () => {
    const records = newestFirst([
      { hrv: 100 },
      { hrv: 50 }, { hrv: 50 }, { hrv: 50 }, { hrv: 50 },
      { hrv: 50 }, { hrv: 50 }, { hrv: 50 }, { hrv: 50 },
    ]);
    const baseline = generateBaseline(records, { excludeCurrentDay: false });
    expect(baseline.hrv7Day).toBeGreaterThan(50);
  });

  test('bedtimeAvg parses ISO datetimes and averages across midnight', () => {
    // Bedtimes alternate 23:30 and 00:30 (ISO datetimes on the next
    // calendar day) — the circular average is 00:00, not mid-day.
    const records = newestFirst([
      { bedtime: null }, // today, excluded anyway
      { bedtime: '2026-07-09T23:30:00+00:00' },
      { bedtime: '2026-07-09T00:30:00+00:00' },
      { bedtime: '2026-07-07T23:30:00+00:00' },
      { bedtime: '2026-07-07T00:30:00+00:00' },
    ]);
    const baseline = generateBaseline(records);
    expect(baseline.bedtimeAvg).toBe('00:00');
  });
});

describe('computeRollingBaseline', () => {
  test('excludes today by default', () => {
    const records = newestFirst([
      { restingHr: 90 },
      { restingHr: 60 }, { restingHr: 60 }, { restingHr: 60 }, { restingHr: 60 },
    ]);
    expect(computeRollingBaseline(records, 'restingHr', 7)).toBe(60);
    expect(computeRollingBaseline(records, 'restingHr', 7, 3, false)).toBeGreaterThan(60);
  });
});

describe('recency weighting (bug 3b)', () => {
  test('the most recent prior day carries the highest weight', () => {
    // Prior days (newest-first after excluding today): 80 most recent,
    // then six 50s. A recency-weighted mean must exceed the flat mean.
    const withRecentHigh = newestFirst([
      { hrv: null }, // today (excluded)
      { hrv: 80 }, { hrv: 50 }, { hrv: 50 }, { hrv: 50 }, { hrv: 50 }, { hrv: 50 }, { hrv: 50 },
    ]);
    const withOldHigh = newestFirst([
      { hrv: null }, // today (excluded)
      { hrv: 50 }, { hrv: 50 }, { hrv: 50 }, { hrv: 50 }, { hrv: 50 }, { hrv: 50 }, { hrv: 80 },
    ]);

    const recent = generateBaseline(withRecentHigh).hrv7Day;
    const old = generateBaseline(withOldHigh).hrv7Day;
    expect(recent).not.toBeNull();
    expect(old).not.toBeNull();
    // Same values, different order: the series with the high reading most
    // recent must produce the higher weighted baseline.
    expect(recent as number).toBeGreaterThan(old as number);
  });
});
