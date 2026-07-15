import { describe, test, expect } from 'vitest';
import {
  assessDataQuality,
  detectBiometricChanges,
  detectLabChanges,
} from '../../backend/services/reasoning/changeDetection';

function days(values: Partial<Record<string, number>>[], startDay = 1): { date: string; [k: string]: unknown }[] {
  return values.map((v, i) => ({
    date: `2026-07-${String(startDay + i).padStart(2, '0')}`,
    ...v,
  }));
}

describe('detectBiometricChanges', () => {
  test('flags a sustained HRV drop as significant (adverse direction)', () => {
    const recent = days([
      { hrv: 40 }, { hrv: 38 }, { hrv: 41 }, { hrv: 39 }, { hrv: 40 }, { hrv: 38 }, { hrv: 40 },
    ]);
    const baseline = { hrv_baseline: 55 };
    const changes = detectBiometricChanges(recent, baseline);
    const hrv = changes.find((c) => c.metric === 'hrv');
    expect(hrv).toBeDefined();
    expect(hrv!.direction).toBe('decrease');
    expect(hrv!.severity).toBe('significant');
    expect(hrv!.baselineValue).toBe(55);
  });

  test('an HRV increase is informational, not adverse', () => {
    const recent = days([
      { hrv: 70 }, { hrv: 72 }, { hrv: 69 }, { hrv: 71 }, { hrv: 73 }, { hrv: 70 }, { hrv: 72 },
    ]);
    const changes = detectBiometricChanges(recent, { hrv_baseline: 55 });
    const hrv = changes.find((c) => c.metric === 'hrv');
    expect(hrv).toBeDefined();
    expect(hrv!.severity).toBe('info');
  });

  test('ignores metrics with too few datapoints', () => {
    const recent = days([{ hrv: 30 }, { hrv: 31 }]);
    const changes = detectBiometricChanges(recent, { hrv_baseline: 60 });
    expect(changes.find((c) => c.metric === 'hrv')).toBeUndefined();
  });

  test('returns empty without a baseline', () => {
    const recent = days([{ hrv: 30 }, { hrv: 31 }, { hrv: 29 }, { hrv: 30 }]);
    expect(detectBiometricChanges(recent, null)).toEqual([]);
  });

  test('small deviations below the notable threshold are dropped', () => {
    const recent = days([
      { resting_hr: 61 }, { resting_hr: 62 }, { resting_hr: 61 }, { resting_hr: 62 },
      { resting_hr: 61 }, { resting_hr: 62 }, { resting_hr: 61 },
    ]);
    const changes = detectBiometricChanges(recent, { resting_hr_baseline: 60 });
    expect(changes.find((c) => c.metric === 'resting_hr')).toBeUndefined();
  });
});

describe('detectLabChanges', () => {
  test('flags out-of-range markers with severity by distance from bound', () => {
    const changes = detectLabChanges([
      {
        markerName: 'Ferritin',
        value: 9,
        unit: 'ng/mL',
        referenceLow: 30,
        referenceHigh: 400,
        collectedAt: '2026-06-01T00:00:00Z',
      },
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0].direction).toBe('decrease');
    expect(changes[0].severity).toBe('significant');
    expect(changes[0].observedAt).toBe('2026-06-01T00:00:00Z');
  });

  test('flags >20% shift between consecutive in-range results', () => {
    const changes = detectLabChanges([
      { markerName: 'TSH', value: 1.0, referenceLow: 0.4, referenceHigh: 4.5, collectedAt: '2026-01-01T00:00:00Z' },
      { markerName: 'TSH', value: 1.6, referenceLow: 0.4, referenceHigh: 4.5, collectedAt: '2026-06-01T00:00:00Z' },
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0].direction).toBe('increase');
    expect(changes[0].magnitudePercent).toBeCloseTo(60, 0);
  });

  test('stable in-range markers produce no changes', () => {
    const changes = detectLabChanges([
      { markerName: 'TSH', value: 1.5, referenceLow: 0.4, referenceHigh: 4.5, collectedAt: '2026-01-01T00:00:00Z' },
      { markerName: 'TSH', value: 1.55, referenceLow: 0.4, referenceHigh: 4.5, collectedAt: '2026-06-01T00:00:00Z' },
    ]);
    expect(changes).toHaveLength(0);
  });
});

describe('assessDataQuality', () => {
  const now = new Date('2026-07-15T00:00:00Z');

  test('reports missing streams as recommendations', () => {
    const { issues, missing } = assessDataQuality({ now });
    expect(missing.map((m) => m.subject)).toEqual(expect.arrayContaining(['wearables', 'labs']));
    expect(issues).toHaveLength(0);
  });

  test('reports stale streams as issues', () => {
    const { issues } = assessDataQuality({
      lastWearableDate: '2026-07-01T00:00:00Z',
      lastLabDate: '2025-01-01T00:00:00Z',
      lastSymptomDate: '2026-06-01T00:00:00Z',
      now,
    });
    const kinds = issues.map((i) => `${i.kind}:${i.subject}`);
    expect(kinds).toContain('stale:wearables');
    expect(kinds).toContain('stale:labs');
    expect(kinds).toContain('stale:symptoms');
  });

  test('fresh data produces neither issues nor missing entries', () => {
    const { issues, missing } = assessDataQuality({
      lastWearableDate: '2026-07-14T00:00:00Z',
      lastLabDate: '2026-06-20T00:00:00Z',
      lastSymptomDate: '2026-07-14T00:00:00Z',
      now,
    });
    expect(issues).toHaveLength(0);
    expect(missing).toHaveLength(0);
  });
});
