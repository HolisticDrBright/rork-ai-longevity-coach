import { describe, test, expect } from 'vitest';
import {
  computeCurrentState,
  computeSystemsModel,
} from '../../backend/services/reasoning/healthTwin';
import type { ClinicalHypothesis, DetectedChange } from '@/types/reasoning';

const labPoint = (name: string, value: number, low: number | null, high: number | null, unit = '') => ({
  markerName: name,
  value,
  unit,
  referenceLow: low,
  referenceHigh: high,
  collectedAt: '2026-07-01T00:00:00Z',
});

const hrvDrop: DetectedChange = {
  metric: 'hrv',
  label: 'HRV',
  direction: 'decrease',
  magnitudePercent: 22,
  currentValue: 40,
  baselineValue: 55,
  windowDays: 7,
  severity: 'significant',
  observedAt: '2026-07-14T12:00:00Z',
};

const baseInputs = {
  labPoints: [],
  changes: [] as DetectedChange[],
  symptomRows: [] as Record<string, unknown>[],
  hypotheses: [] as ClinicalHypothesis[],
  hasWearableData: false,
  hasLabData: false,
  hasSymptomData: false,
};

describe('computeSystemsModel', () => {
  test('returns all 12 systems', () => {
    const systems = computeSystemsModel(baseInputs);
    expect(systems).toHaveLength(12);
    expect(systems.map((s) => s.key)).toContain('sleep_circadian');
  });

  test('no data means null score and missing-data notes', () => {
    const systems = computeSystemsModel(baseInputs);
    const metabolic = systems.find((s) => s.key === 'metabolic')!;
    expect(metabolic.score).toBeNull();
    expect(metabolic.missingData).toContain('No relevant lab markers on record');
    expect(metabolic.trend).toBe('unknown');
  });

  test('out-of-range markers lower the system score; in-range markers reassure', () => {
    const systems = computeSystemsModel({
      ...baseInputs,
      hasLabData: true,
      labPoints: [
        labPoint('Fasting Glucose', 118, 65, 99, 'mg/dL'),
        labPoint('HDL Cholesterol', 62, 40, null, 'mg/dL'),
      ],
    });
    const metabolic = systems.find((s) => s.key === 'metabolic')!;
    expect(metabolic.score).not.toBeNull();
    expect(metabolic.score!).toBeLessThan(100);
    expect(metabolic.contributors.some((c) => c.direction === 'concern')).toBe(true);

    const cardio = systems.find((s) => s.key === 'cardiovascular')!;
    expect(cardio.contributors.some((c) => c.direction === 'reassuring')).toBe(true);
  });

  test('significant wearable changes hit stress/autonomic system', () => {
    const systems = computeSystemsModel({
      ...baseInputs,
      hasWearableData: true,
      changes: [hrvDrop],
    });
    const stress = systems.find((s) => s.key === 'stress_autonomic')!;
    expect(stress.score).not.toBeNull();
    expect(stress.score!).toBeLessThanOrEqual(85);
    expect(stress.contributors[0].sourceType).toBe('rule_engine');
  });

  test('trend compares against the previous snapshot systems state', () => {
    const current = computeSystemsModel({
      ...baseInputs,
      hasLabData: true,
      labPoints: [labPoint('Fasting Glucose', 92, 65, 99)],
      previousSystems: [{ key: 'metabolic', score: 70 }],
    });
    const metabolic = current.find((s) => s.key === 'metabolic')!;
    expect(metabolic.trend).toBe('improving');
  });

  test('pending hypotheses set the review status on their systems', () => {
    const hypo: ClinicalHypothesis = {
      id: 'h1',
      userId: 'u1',
      name: 'Insulin resistance pattern',
      status: 'proposed',
      supportScore: 55,
      missingEvidence: [],
      systems: ['metabolic'],
      alternatives: [],
      sourceType: 'rule_engine',
      reviewStatus: 'pending_review',
      createdAt: '',
      updatedAt: '',
    };
    const systems = computeSystemsModel({ ...baseInputs, hypotheses: [hypo] });
    const metabolic = systems.find((s) => s.key === 'metabolic')!;
    expect(metabolic.reviewStatus).toBe('pending_review');
    expect(metabolic.hypotheses[0].name).toBe('Insulin resistance pattern');
  });

  test('severe symptoms register as concern contributors (capped at two)', () => {
    const systems = computeSystemsModel({
      ...baseInputs,
      hasSymptomData: true,
      symptomRows: [
        { symptom_name: 'bloating', severity: 8, logged_at: '2026-07-01T00:00:00Z' },
        { symptom_name: 'constipation', severity: 7, logged_at: '2026-07-02T00:00:00Z' },
        { symptom_name: 'diarrhea', severity: 9, logged_at: '2026-07-03T00:00:00Z' },
      ],
    });
    const gi = systems.find((s) => s.key === 'gastrointestinal')!;
    expect(gi.score).not.toBeNull();
    expect(gi.contributors.filter((c) => c.direction === 'concern')).toHaveLength(2);
  });
});

describe('computeCurrentState', () => {
  test('assembles goals, symptoms, meds, risks, abnormal markers and patterns', () => {
    const state = computeCurrentState({
      goals: ['Improve energy'],
      symptomRows: [
        { symptom_name: 'Fatigue', severity: 7, logged_at: '2026-07-10T00:00:00Z' },
        { symptom_name: 'Fatigue', severity: 5, logged_at: '2026-07-01T00:00:00Z' },
      ],
      medications: ['Levothyroxine'],
      supplementNames: ['Magnesium Glycinate'],
      flagRows: [{ flag_type: 'hrv_drop', severity: 'high', summary: 'Sustained HRV suppression', resolved: false }],
      labPoints: [labPoint('Ferritin', 12, 30, 400, 'ng/mL'), labPoint('TSH', 2.0, 0.4, 4.5)],
      biometricRows: [
        { sleep_duration_minutes: 420, hrv: 48, resting_hr: 58, steps: 8000 },
        { sleep_duration_minutes: 400, hrv: 52, resting_hr: 56, steps: 9000 },
      ],
      changes: [hrvDrop],
    });

    expect(state.goals).toEqual(['Improve energy']);
    expect(state.activeSymptoms[0]).toMatchObject({ name: 'Fatigue', severity: 7 });
    expect(state.medications).toEqual(['Levothyroxine']);
    expect(state.abnormalBiomarkers.map((b) => b.name)).toEqual(['Ferritin']);
    expect(state.risks.map((r) => r.summary)).toEqual(
      expect.arrayContaining(['Sustained HRV suppression', 'HRV decrease 22% vs baseline'])
    );
    expect(state.patterns.avgSleepMinutes).toBe(410);
    expect(state.patterns.checkinDays).toBe(2);
  });

  test('keeps the most recent severity per symptom', () => {
    const state = computeCurrentState({
      goals: [],
      symptomRows: [
        { symptom_name: 'Headache', severity: 3, logged_at: '2026-07-12T00:00:00Z' },
        { symptom_name: 'Headache', severity: 8, logged_at: '2026-07-01T00:00:00Z' },
      ],
      medications: [],
      supplementNames: [],
      flagRows: [],
      labPoints: [],
      biometricRows: [],
      changes: [],
    });
    expect(state.activeSymptoms).toHaveLength(1);
    expect(state.activeSymptoms[0].severity).toBe(3);
  });
});
