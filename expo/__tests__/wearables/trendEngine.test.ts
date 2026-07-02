import { describe, test, expect } from 'vitest';
import { computeChangePercent, computeWindowComparison } from '@/utils/wearables/trendEngine';
import { isWeekendDate } from '@/utils/date';

describe('computeChangePercent (bug 4: oldest/newest were swapped)', () => {
  test('a rise 50 -> 60 over chronological data reports +20%', () => {
    expect(computeChangePercent([50, 55, 60])).toBe(20);
  });

  test('a fall 60 -> 50 reports a negative change', () => {
    expect(computeChangePercent([60, 55, 50])).toBe(-17);
  });

  test('ignores nulls when finding the endpoints', () => {
    expect(computeChangePercent([null, 50, null, 60, null])).toBe(20);
  });

  test('fewer than 2 valid points reports 0', () => {
    expect(computeChangePercent([null, 50, null])).toBe(0);
    expect(computeChangePercent([])).toBe(0);
  });
});

describe('isWeekendDate (bug 10: date-only strings must not shift west of UTC)', () => {
  test('2026-07-04 is a Saturday in every timezone', () => {
    expect(isWeekendDate('2026-07-04')).toBe(true);
  });

  test('2026-07-05 is a Sunday, 2026-07-06 is a Monday', () => {
    expect(isWeekendDate('2026-07-05')).toBe(true);
    expect(isWeekendDate('2026-07-06')).toBe(false);
  });
});

describe('computeWindowComparison (bug 10: metric direction and zero baseline)', () => {
  test('higher-is-better metric: an increase is an improvement', () => {
    const result = computeWindowComparison([60, 60], [50, 50]);
    expect(result.changePercent).toBe(20);
    expect(result.improved).toBe(true);
  });

  test('lower-is-better metric (inverted): an increase is NOT an improvement', () => {
    const result = computeWindowComparison([60, 60], [50, 50], true);
    expect(result.changePercent).toBe(20);
    expect(result.improved).toBe(false);
  });

  test('lower-is-better metric: a decrease IS an improvement', () => {
    const result = computeWindowComparison([50, 50], [60, 60], true);
    expect(result.improved).toBe(true);
  });

  test('priorMean of 0 returns null changePercent, not a fake 0/false', () => {
    const result = computeWindowComparison([5, 5], [0, 0]);
    expect(result.changePercent).toBeNull();
    expect(result.improved).toBeNull();
  });
});
