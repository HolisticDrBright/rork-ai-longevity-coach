import { describe, test, expect } from 'vitest';
import {
  computeSupportScore,
  diffSnapshots,
  statusFromScore,
} from '../../backend/services/reasoning/scoring';
import type { DetectedChange, HypothesisSnapshotEntry } from '@/types/reasoning';

describe('computeSupportScore', () => {
  test('no evidence stays at the uncertain midpoint', () => {
    expect(computeSupportScore([])).toBe(50);
  });

  test('supporting evidence raises, contradicting lowers', () => {
    const up = computeSupportScore([{ direction: 'supports', strength: 1 }]);
    const down = computeSupportScore([{ direction: 'contradicts', strength: 1 }]);
    expect(up).toBeGreaterThan(50);
    expect(down).toBeLessThan(50);
  });

  test('diminishing returns: 10 supports do not reach 100', () => {
    const evidence = Array.from({ length: 10 }, () => ({ direction: 'supports' as const, strength: 1 }));
    const score = computeSupportScore(evidence);
    expect(score).toBeGreaterThan(80);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('missing evidence caps the ceiling', () => {
    const evidence = Array.from({ length: 10 }, () => ({ direction: 'supports' as const, strength: 1 }));
    const capped = computeSupportScore(evidence, 5);
    const uncapped = computeSupportScore(evidence, 0);
    expect(capped).toBeLessThan(uncapped);
    expect(capped).toBeLessThanOrEqual(70);
  });

  test('score is bounded to [0, 100]', () => {
    const contradictions = Array.from({ length: 20 }, () => ({ direction: 'contradicts' as const, strength: 1 }));
    expect(computeSupportScore(contradictions)).toBeGreaterThanOrEqual(0);
  });

  test('neutral evidence does not move the score', () => {
    expect(computeSupportScore([{ direction: 'neutral', strength: 1 }])).toBe(50);
  });
});

describe('statusFromScore', () => {
  test('maps score bands to lifecycle states', () => {
    expect(statusFromScore(80, 3)).toBe('supported');
    expect(statusFromScore(20, 3)).toBe('weakened');
    expect(statusFromScore(50, 3)).toBe('unresolved');
    expect(statusFromScore(80, 0)).toBe('proposed');
  });
});

describe('diffSnapshots', () => {
  const entry = (id: string, name: string, score: number): HypothesisSnapshotEntry => ({
    hypothesisId: id,
    name,
    status: 'proposed',
    supportScore: score,
    supportingCount: 0,
    contradictingCount: 0,
    sourceType: 'practitioner_entered',
    reviewStatus: 'accepted',
  });

  const change = (metric: string, label: string): DetectedChange => ({
    metric,
    label,
    direction: 'decrease',
    magnitudePercent: 25,
    currentValue: 40,
    baselineValue: 55,
    windowDays: 7,
    severity: 'significant',
    observedAt: '2026-07-14T12:00:00Z',
  });

  test('first snapshot reports all changes and hypotheses as new', () => {
    const diff = diffSnapshots(null, [entry('h1', 'Iron deficiency', 60)], [change('hrv', 'HRV')]);
    expect(diff.hypothesesAdded).toEqual(['Iron deficiency']);
    expect(diff.newChanges).toEqual(['HRV']);
    expect(diff.summary).toContain('new change');
  });

  test('detects score shifts and resolved changes', () => {
    const previous = {
      hypothesesState: [entry('h1', 'Iron deficiency', 40)],
      detectedChanges: [change('hrv', 'HRV'), change('steps', 'Steps')],
    };
    const diff = diffSnapshots(previous, [entry('h1', 'Iron deficiency', 62)], [change('hrv', 'HRV')]);
    expect(diff.scoreChanges).toEqual([{ hypothesisId: 'h1', name: 'Iron deficiency', from: 40, to: 62 }]);
    expect(diff.resolvedChanges).toEqual(['Steps']);
    expect(diff.newChanges).toHaveLength(0);
  });

  test('no material change produces the quiet summary', () => {
    const previous = {
      hypothesesState: [entry('h1', 'Iron deficiency', 40)],
      detectedChanges: [change('hrv', 'HRV')],
    };
    const diff = diffSnapshots(previous, [entry('h1', 'Iron deficiency', 40)], [change('hrv', 'HRV')]);
    expect(diff.summary).toBe('No material change since the previous analysis.');
  });
});
