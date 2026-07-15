import { describe, test, expect } from 'vitest';
import {
  buildReasoningContext,
  detectContradictions,
  findMarker,
  generateRuleHypotheses,
  type ReasoningContext,
} from '../../backend/services/reasoning/hypothesisRules';
import type { DetectedChange } from '@/types/reasoning';

const marker = (name: string, value: number, low?: number | null, high?: number | null, unit = '') => ({
  name,
  value,
  unit,
  low: low ?? null,
  high: high ?? null,
  collectedAt: '2026-07-01T00:00:00Z',
});

const emptyCtx = (over: Partial<ReasoningContext> = {}): ReasoningContext => ({
  markers: [],
  changes: [],
  symptoms: [],
  ...over,
});

const change = (metric: string, direction: 'increase' | 'decrease', severity: DetectedChange['severity'] = 'significant', currentValue = 40): DetectedChange => ({
  metric,
  label: metric,
  direction,
  magnitudePercent: 22,
  currentValue,
  baselineValue: 55,
  windowDays: 7,
  severity,
  observedAt: '2026-07-14T12:00:00Z',
});

describe('marker alias matching', () => {
  test('finds markers by fuzzy name and prefers the most recent', () => {
    const ctx = emptyCtx({
      markers: [
        { ...marker('Vitamin D, 25-OH', 22), collectedAt: '2026-01-01T00:00:00Z' },
        { ...marker('Vitamin D 25-Hydroxy', 35), collectedAt: '2026-07-01T00:00:00Z' },
      ],
    });
    const found = findMarker(ctx, 'vitamin_d');
    expect(found?.value).toBe(35);
  });

  test('matches HbA1c spelled as Hemoglobin A1c', () => {
    const ctx = emptyCtx({ markers: [marker('Hemoglobin A1c', 6.1, 4, 5.6, '%')] });
    expect(findMarker(ctx, 'hba1c')?.value).toBe(6.1);
  });
});

describe('generateRuleHypotheses', () => {
  test('low ferritin fires the iron rule; fatigue adds symptom evidence', () => {
    const ctx = emptyCtx({
      markers: [marker('Ferritin', 12, 30, 400, 'ng/mL')],
      symptoms: [{ name: 'Fatigue', severity: 7, loggedAt: '2026-07-10T00:00:00Z' }],
    });
    const results = generateRuleHypotheses(ctx);
    const iron = results.find((r) => r.code === 'rule:iron_insufficiency');
    expect(iron).toBeDefined();
    expect(iron!.supporting).toHaveLength(2);
    expect(iron!.supporting.map((e) => e.evidenceType)).toEqual(expect.arrayContaining(['lab', 'symptom']));
    expect(iron!.missingEvidence.length).toBeGreaterThan(0);
    expect(iron!.systems).toContain('mitochondrial_energy');
  });

  test('normal ferritin does not fire the iron rule', () => {
    const ctx = emptyCtx({ markers: [marker('Ferritin', 85, 30, 400)] });
    expect(generateRuleHypotheses(ctx).find((r) => r.code === 'rule:iron_insufficiency')).toBeUndefined();
  });

  test('ferritin without a range uses the conservative fallback threshold', () => {
    const low = emptyCtx({ markers: [marker('Ferritin', 20)] });
    const ok = emptyCtx({ markers: [marker('Ferritin', 50)] });
    expect(generateRuleHypotheses(low).some((r) => r.code === 'rule:iron_insufficiency')).toBe(true);
    expect(generateRuleHypotheses(ok).some((r) => r.code === 'rule:iron_insufficiency')).toBe(false);
  });

  test('insulin resistance fires on multiple glycemic markers with combined evidence', () => {
    const ctx = emptyCtx({
      markers: [marker('Fasting Glucose', 108, 65, 99, 'mg/dL'), marker('Hemoglobin A1c', 5.9, 4, 5.6, '%')],
    });
    const r = generateRuleHypotheses(ctx).find((x) => x.code === 'rule:insulin_resistance');
    expect(r).toBeDefined();
    expect(r!.supporting).toHaveLength(2);
    expect(r!.missingEvidence).toEqual(expect.arrayContaining(['Fasting insulin (HOMA-IR)']));
  });

  test('HRV drop fires autonomic strain with trend evidence', () => {
    const ctx = emptyCtx({ changes: [change('hrv', 'decrease')] });
    const r = generateRuleHypotheses(ctx).find((x) => x.code === 'rule:autonomic_strain');
    expect(r).toBeDefined();
    expect(r!.supporting[0].evidenceType).toBe('trend');
  });

  test('unremarkable data proposes nothing', () => {
    const ctx = emptyCtx({
      markers: [marker('Ferritin', 85, 30, 400), marker('TSH', 1.8, 0.4, 4.5)],
      changes: [],
      symptoms: [{ name: 'Fatigue', severity: 2, loggedAt: '2026-07-10T00:00:00Z' }],
    });
    expect(generateRuleHypotheses(ctx)).toHaveLength(0);
  });
});

describe('detectContradictions', () => {
  test('normalized ferritin contradicts an active iron hypothesis', () => {
    const ctx = emptyCtx({ markers: [marker('Ferritin', 90, 30, 400, 'ng/mL')] });
    const findings = detectContradictions(ctx, ['rule:iron_insufficiency']);
    expect(findings).toHaveLength(1);
    expect(findings[0].summary).toContain('within range');
  });

  test('no contradiction while the marker is still low or missing', () => {
    expect(
      detectContradictions(emptyCtx({ markers: [marker('Ferritin', 12, 30, 400)] }), ['rule:iron_insufficiency'])
    ).toHaveLength(0);
    expect(detectContradictions(emptyCtx(), ['rule:iron_insufficiency'])).toHaveLength(0);
  });

  test('only checks codes that are active', () => {
    const ctx = emptyCtx({ markers: [marker('Ferritin', 90, 30, 400)] });
    expect(detectContradictions(ctx, [])).toHaveLength(0);
  });
});

describe('buildReasoningContext', () => {
  test('maps rows into the rule context', () => {
    const ctx = buildReasoningContext({
      labPoints: [
        { markerName: 'TSH', value: 6.2, unit: 'mIU/L', referenceLow: 0.4, referenceHigh: 4.5, collectedAt: '2026-06-01T00:00:00Z' },
      ],
      changes: [change('hrv', 'decrease')],
      symptomRows: [{ symptom_name: 'stress', severity: 8, logged_at: '2026-07-01T00:00:00Z' }],
    });
    expect(ctx.markers[0].name).toBe('TSH');
    expect(ctx.symptoms[0].severity).toBe(8);
    const thyroid = generateRuleHypotheses(ctx).find((r) => r.code === 'rule:thyroid_dysregulation');
    expect(thyroid).toBeDefined();
  });
});
