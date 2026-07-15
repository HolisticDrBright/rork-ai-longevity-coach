import { describe, test, expect } from 'vitest';
import {
  classifyChangeDuration,
  compareWindows,
  daysBetween,
  detectRechallenge,
  intervalsOverlap,
  overlappingInterventions,
  precedes,
  timeToResponseDays,
} from '../../backend/services/reasoning/temporal';

describe('temporal utilities', () => {
  test('precedes is strict about ordering', () => {
    expect(precedes('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')).toBe(true);
    expect(precedes('2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(false);
    expect(precedes('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(false);
  });

  test('timeToResponseDays returns null when outcome came first', () => {
    expect(timeToResponseDays('2026-01-10T00:00:00Z', '2026-01-01T00:00:00Z')).toBeNull();
    expect(timeToResponseDays('2026-01-01T00:00:00Z', '2026-01-15T00:00:00Z')).toBe(14);
  });

  test('daysBetween handles fractional days', () => {
    expect(daysBetween('2026-01-01T00:00:00Z', '2026-01-01T12:00:00Z')).toBeCloseTo(0.5);
  });

  test('intervalsOverlap treats missing end as ongoing', () => {
    expect(
      intervalsOverlap({ start: '2026-01-01' }, { start: '2026-06-01', end: '2026-06-30' })
    ).toBe(true);
    expect(
      intervalsOverlap(
        { start: '2026-01-01', end: '2026-01-31' },
        { start: '2026-02-01', end: '2026-02-28' }
      )
    ).toBe(false);
  });

  test('overlappingInterventions finds confounder pairs', () => {
    const pairs = overlappingInterventions([
      { name: 'magnesium', start: '2026-01-01', end: '2026-02-01' },
      { name: 'ashwagandha', start: '2026-01-15' },
      { name: 'creatine', start: '2026-03-01' },
    ]);
    expect(pairs).toContainEqual({ a: 'magnesium', b: 'ashwagandha' });
    expect(pairs).toContainEqual({ a: 'ashwagandha', b: 'creatine' });
    expect(pairs).toHaveLength(2);
  });

  test('detectRechallenge counts discontinuation followed by re-exposure', () => {
    const result = detectRechallenge([
      { start: '2026-01-01', end: '2026-01-31' },
      { start: '2026-02-15', end: '2026-03-15' },
    ]);
    expect(result.rechallenges).toBe(1);
    expect(result.discontinuations).toBe(2); // gap + final ended period
  });

  test('detectRechallenge ignores gaps below the threshold', () => {
    const result = detectRechallenge(
      [
        { start: '2026-01-01', end: '2026-01-31' },
        { start: '2026-02-01', end: '2026-02-20' },
      ],
      3
    );
    expect(result.rechallenges).toBe(0);
  });

  test('compareWindows computes absolute and relative change', () => {
    const points = [
      { at: '2026-01-01', value: 10 },
      { at: '2026-01-02', value: 12 },
      { at: '2026-02-01', value: 20 },
      { at: '2026-02-02', value: 22 },
    ];
    const result = compareWindows(
      points,
      { start: '2026-01-01', end: '2026-01-31' },
      { start: '2026-02-01', end: '2026-02-28' }
    );
    expect(result.baselineMean).toBe(11);
    expect(result.interventionMean).toBe(21);
    expect(result.absoluteChange).toBe(10);
    expect(result.relativeChangePercent).toBeCloseTo(90.9, 1);
    expect(result.baselineCount).toBe(2);
    expect(result.interventionCount).toBe(2);
  });

  test('compareWindows returns nulls with no data', () => {
    const result = compareWindows([], { start: '2026-01-01' }, { start: '2026-02-01' });
    expect(result.baselineMean).toBeNull();
    expect(result.absoluteChange).toBeNull();
  });

  test('classifyChangeDuration separates acute from chronic', () => {
    const chronic = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      deviated: i >= 3,
    }));
    expect(classifyChangeDuration(chronic)).toBe('chronic');

    const acute = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      deviated: i >= 12,
    }));
    expect(classifyChangeDuration(acute)).toBe('acute');

    const none = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      deviated: false,
    }));
    expect(classifyChangeDuration(none)).toBe('none');
  });
});
