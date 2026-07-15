import { describe, test, expect } from 'vitest';
import {
  mapClinicalFacts,
  mapLabMarkers,
  mapLabPanels,
  mapSymptomLogs,
  mergeTimeline,
} from '../../backend/services/reasoning/timeline';
import type { TimelineEvent } from '@/types/reasoning';

describe('timeline mappers', () => {
  test('lab panels separate observation date from ingestion date', () => {
    const [event] = mapLabPanels([
      {
        id: 'p1',
        name: 'Comprehensive Panel',
        date: '2026-05-01',
        created_at: '2026-06-15T10:00:00Z',
        biomarkers_json: [{}, {}, {}],
        source: 'quest',
      },
    ]);
    expect(event.observedAt).toBe('2026-05-01T12:00:00.000Z');
    expect(event.recordedAt).toBe('2026-06-15T10:00:00Z');
    expect(event.sourceType).toBe('measured');
    expect(event.detail).toBe('3 biomarkers');
  });

  test('symptom logs are patient_reported', () => {
    const [event] = mapSymptomLogs([
      { id: 's1', symptom_name: 'Fatigue', severity: 7, logged_at: '2026-07-01T08:00:00Z', created_at: '2026-07-01T08:00:01Z' },
    ]);
    expect(event.sourceType).toBe('patient_reported');
    expect(event.title).toBe('Fatigue');
    expect(event.valueNum).toBe(7);
  });

  test('lab markers keep reference ranges in meta', () => {
    const [event] = mapLabMarkers([
      {
        id: 'm1',
        marker_name: 'Vitamin D',
        marker_value: 28,
        unit: 'ng/mL',
        reference_range_low: 30,
        reference_range_high: 100,
        collected_at: '2026-05-01T00:00:00Z',
        created_at: '2026-05-02T00:00:00Z',
      },
    ]);
    expect(event.meta?.referenceLow).toBe(30);
    expect(event.meta?.referenceHigh).toBe(100);
  });

  test('clinical facts carry their declared source type through', () => {
    const [event] = mapClinicalFacts([
      {
        id: 'f1',
        label: 'HRV decrease 22% vs baseline',
        fact_type: 'change',
        source_type: 'rule_engine',
        observed_at: '2026-07-10T12:00:00Z',
        recorded_at: '2026-07-10T12:00:05Z',
        review_status: 'pending_review',
      },
    ]);
    expect(event.sourceType).toBe('rule_engine');
    expect(event.meta?.reviewStatus).toBe('pending_review');
  });
});

describe('mergeTimeline', () => {
  const mk = (id: string, at: string, kind: TimelineEvent['kind'] = 'symptom'): TimelineEvent => ({
    id,
    kind,
    title: id,
    observedAt: at,
    sourceType: 'patient_reported',
  });

  test('sorts newest first and dedupes ids', () => {
    const merged = mergeTimeline([
      mk('a', '2026-01-01T00:00:00Z'),
      mk('b', '2026-03-01T00:00:00Z'),
      mk('a', '2026-01-01T00:00:00Z'),
    ]);
    expect(merged.map((e) => e.id)).toEqual(['b', 'a']);
  });

  test('applies date-range and kind filters', () => {
    const merged = mergeTimeline(
      [
        mk('old', '2025-01-01T00:00:00Z'),
        mk('in-range', '2026-02-01T00:00:00Z'),
        mk('lab', '2026-02-02T00:00:00Z', 'lab_panel'),
      ],
      { from: '2026-01-01', to: '2026-12-31', kinds: ['symptom'] }
    );
    expect(merged.map((e) => e.id)).toEqual(['in-range']);
  });

  test('drops events with invalid dates', () => {
    const merged = mergeTimeline([mk('bad', 'not-a-date'), mk('good', '2026-02-01T00:00:00Z')]);
    expect(merged.map((e) => e.id)).toEqual(['good']);
  });
});
