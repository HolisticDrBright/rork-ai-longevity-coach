// Pin the timezone BEFORE any Date work so ISO-datetime bedtimes resolve to
// a deterministic local clock time in these golden tests.
process.env.TZ = 'UTC';

import { describe, test, expect } from 'vitest';
import {
  computeMetabolicResilienceScore,
  computeSleepScore,
  computeAdherenceScore,
  scoreGlucose,
} from '@/utils/wearables/scoringEngine';
import { makeRecord, makeBaseline } from './test-helpers';

const findFactor = (breakdown: { factor: string }[], name: string) => {
  const item = breakdown.find(b => b.factor === name);
  expect(item, `breakdown should contain "${name}"`).toBeDefined();
  return item as { factor: string; weight: number; rawValue: number | null; normalizedScore: number; impact: string };
};

describe('glucose scoring (bug 1: hypoglycemia must not score as positive)', () => {
  test('glucose 55 (hypoglycemia) scores < 50 with negative impact', () => {
    const record = makeRecord({ glucoseAvg: 55 });
    const result = computeMetabolicResilienceScore(record, []);
    const glucose = findFactor(result.breakdown, 'Glucose (if available)');

    expect(glucose.rawValue).toBe(55);
    expect(glucose.normalizedScore).toBeLessThan(50);
    expect(glucose.impact).toBe('negative');
  });

  test('scoreGlucose tiers', () => {
    expect(scoreGlucose(50)).toBe(10); // critical low
    expect(scoreGlucose(55)).toBe(30); // low
    expect(scoreGlucose(69)).toBe(30);
    expect(scoreGlucose(85)).toBe(95); // optimal
    expect(scoreGlucose(100)).toBe(95);
    expect(scoreGlucose(105)).toBe(70); // slightly elevated
    expect(scoreGlucose(120)).toBe(50); // elevated
    expect(scoreGlucose(130)).toBe(30); // high
  });

  test('hypoglycemia scores strictly worse than mild elevation', () => {
    expect(scoreGlucose(55)).toBeLessThan(scoreGlucose(108));
  });

  test('missing glucose is excluded from the score (weight 0, neutral)', () => {
    const record = makeRecord({ glucoseAvg: null });
    const result = computeMetabolicResilienceScore(record, []);
    const glucose = findFactor(result.breakdown, 'Glucose (if available)');
    expect(glucose.weight).toBe(0);
    expect(glucose.rawValue).toBeNull();
    expect(glucose.impact).toBe('neutral');
  });
});

describe('bedtime parsing and midnight wraparound (bug 2)', () => {
  test('ISO bedtime "2026-07-01T23:45:00+00:00" parses as 23.75h, not 2026', () => {
    const record = makeRecord({ bedtime: '2026-07-01T23:45:00+00:00' });
    const baseline = makeBaseline({ bedtimeAvg: '22:30' });
    const result = computeSleepScore(record, baseline);
    const consistency = findFactor(result.breakdown, 'Bedtime consistency');

    // Parsed clock hour, NOT the year from split(':')[0].
    expect(consistency.rawValue).toBeCloseTo(23.75, 5);
    // Drift is 1.25h -> 100 - 1.25 * 40 = 50 (the old parser produced 0).
    expect(consistency.normalizedScore).toBe(50);
  });

  test('post-midnight bedtime 00:30 vs baseline 22:30 is a 2h drift, not 22h', () => {
    const record = makeRecord({ bedtime: '00:30' });
    const baseline = makeBaseline({ bedtimeAvg: '22:30' });
    const result = computeSleepScore(record, baseline);
    const consistency = findFactor(result.breakdown, 'Bedtime consistency');

    // Circular distance: 2h -> 100 - 2 * 40 = 20. The old linear math
    // computed |0.5 - 22.5| = 22h drift -> 0.
    expect(consistency.normalizedScore).toBe(20);
  });

  test('adherence: 00:30 bedtime is AFTER the 22:30 target (late), not before it', () => {
    const record = makeRecord({ bedtime: '00:30' });
    const result = computeAdherenceScore(record, [], []);
    const bedtimeTarget = findFactor(result.breakdown, 'Bedtime target');

    // 00:30 is after midnight -> worst tier (30), never the "on target" 95.
    expect(bedtimeTarget.normalizedScore).toBe(30);
  });

  test('adherence: ISO bedtime is parsed and scored on clock hours', () => {
    const record = makeRecord({ bedtime: '2026-07-01T22:15:00+00:00' });
    const result = computeAdherenceScore(record, [], []);
    const bedtimeTarget = findFactor(result.breakdown, 'Bedtime target');

    expect(bedtimeTarget.rawValue).toBeCloseTo(22.25, 5);
    expect(bedtimeTarget.normalizedScore).toBe(95); // before 22:30 target
  });

  test('missing hydration is excluded from adherence (weight 0, no imputed 1500ml)', () => {
    const record = makeRecord({ hydrationMl: null });
    const result = computeAdherenceScore(record, [], []);
    const hydration = findFactor(result.breakdown, 'Hydration target');
    expect(hydration.weight).toBe(0);
    expect(hydration.rawValue).toBeNull();
    expect(hydration.impact).toBe('neutral');
  });
});

describe('all-null records (bug 17)', () => {
  test('a fully-null record yields the insufficient-data default, no positive impacts', () => {
    const record = makeRecord();
    const result = computeSleepScore(record, null);
    expect(result.label).toBe('Insufficient Data');
    expect(result.breakdown.every(b => b.impact !== 'positive')).toBe(true);
  });
});
