// Builds the unified longitudinal timeline by mapping rows from existing
// tables into TimelineEvent — a query-time union, no data duplication.
// Every event separates observedAt (clinical time) from recordedAt (ingestion).

import type { TimelineEvent } from '@/types/reasoning';

type Row = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

function dateToIso(dateOnly: string | undefined, fallback?: string): string {
  if (dateOnly) {
    // date columns come back as YYYY-MM-DD; anchor mid-day UTC to avoid TZ drift
    return dateOnly.length === 10 ? `${dateOnly}T12:00:00.000Z` : dateOnly;
  }
  return fallback ?? new Date(0).toISOString();
}

export function mapLabPanels(rows: Row[]): TimelineEvent[] {
  return rows.map((r) => {
    const biomarkers = Array.isArray(r.biomarkers_json) ? (r.biomarkers_json as unknown[]) : [];
    return {
      id: `lab_panel:${String(r.id)}`,
      kind: 'lab_panel' as const,
      title: str(r.name) ?? 'Lab panel',
      detail: `${biomarkers.length} biomarker${biomarkers.length === 1 ? '' : 's'}`,
      observedAt: dateToIso(str(r.date), str(r.created_at)),
      recordedAt: str(r.created_at),
      sourceType: 'measured' as const,
      source: str(r.source) ?? 'lab_panel',
      meta: { panelId: String(r.id) },
    };
  });
}

export function mapLabMarkers(rows: Row[]): TimelineEvent[] {
  return rows.map((r) => ({
    id: `lab_marker:${String(r.id)}`,
    kind: 'lab_marker' as const,
    title: str(r.marker_name) ?? 'Lab marker',
    detail: `${r.marker_value} ${str(r.unit) ?? ''}`.trim(),
    observedAt: str(r.collected_at) ?? dateToIso(undefined, str(r.created_at)),
    recordedAt: str(r.created_at),
    sourceType: 'measured' as const,
    source: str(r.source) ?? 'lab',
    valueNum: num(r.marker_value),
    unit: str(r.unit),
    meta: {
      referenceLow: num(r.reference_range_low),
      referenceHigh: num(r.reference_range_high),
    },
  }));
}

export function mapSymptomLogs(rows: Row[]): TimelineEvent[] {
  return rows.map((r) => ({
    id: `symptom:${String(r.id)}`,
    kind: 'symptom' as const,
    title: str(r.symptom_name) ?? 'Symptom',
    detail: num(r.severity) !== undefined ? `Severity ${r.severity}/10` : undefined,
    observedAt: str(r.logged_at) ?? dateToIso(undefined, str(r.created_at)),
    recordedAt: str(r.created_at),
    sourceType: 'patient_reported' as const,
    source: 'symptom_log',
    valueNum: num(r.severity),
  }));
}

export function mapProtocols(rows: Row[]): TimelineEvent[] {
  return rows.map((r) => ({
    id: `protocol:${String(r.id)}`,
    kind: 'protocol' as const,
    title: `Protocol: ${str(r.name) ?? 'Unnamed'}`,
    detail: str(r.status),
    observedAt: dateToIso(str(r.start_date), str(r.created_at)),
    recordedAt: str(r.created_at),
    sourceType: 'practitioner_entered' as const,
    source: 'protocol',
    meta: { status: str(r.status), endDate: str(r.end_date) },
  }));
}

export function mapSupplementLogs(rows: Row[]): TimelineEvent[] {
  return rows.map((r) => ({
    id: `supplement:${String(r.id)}`,
    kind: 'supplement' as const,
    title: str(r.supplement_name) ?? 'Supplement',
    detail: [str(r.dose), str(r.timing)].filter(Boolean).join(' · ') || undefined,
    observedAt: str(r.logged_at) ?? dateToIso(undefined, str(r.created_at)),
    recordedAt: str(r.created_at),
    sourceType: 'patient_reported' as const,
    source: 'supplement_log',
  }));
}

export function mapMealLogs(rows: Row[]): TimelineEvent[] {
  return rows.map((r) => ({
    id: `meal:${String(r.id)}`,
    kind: 'meal' as const,
    title: `Meal (${str(r.meal_type) ?? 'unspecified'})`,
    detail: num(r.calories) !== undefined ? `${Math.round(num(r.calories)!)} kcal` : undefined,
    observedAt: str(r.meal_time) ?? dateToIso(undefined, str(r.created_at)),
    recordedAt: str(r.created_at),
    sourceType: 'patient_reported' as const,
    source: 'meal_log',
    valueNum: num(r.calories),
    unit: 'kcal',
  }));
}

export function mapWearableDays(rows: Row[]): TimelineEvent[] {
  return rows.map((r) => {
    const parts: string[] = [];
    if (num(r.hrv) !== undefined) parts.push(`HRV ${r.hrv}`);
    if (num(r.resting_hr) !== undefined) parts.push(`RHR ${r.resting_hr}`);
    if (num(r.sleep_duration_minutes) !== undefined)
      parts.push(`Sleep ${Math.round(num(r.sleep_duration_minutes)! / 6) / 10}h`);
    if (num(r.steps) !== undefined) parts.push(`${r.steps} steps`);
    return {
      id: `wearable:${String(r.id)}`,
      kind: 'wearable_day' as const,
      title: 'Wearable summary',
      detail: parts.join(' · ') || undefined,
      observedAt: dateToIso(str(r.date), str(r.created_at)),
      recordedAt: str(r.created_at),
      sourceType: 'measured' as const,
      source: str(r.primary_source) ?? 'wearable',
      meta: { dataQuality: num(r.data_quality_score) },
    };
  });
}

export function mapHormoneEntries(rows: Row[]): TimelineEvent[] {
  return rows.map((r) => {
    const symptoms = Array.isArray(r.symptoms_json) ? (r.symptoms_json as unknown[]) : [];
    return {
      id: `hormone:${String(r.id)}`,
      kind: 'hormone' as const,
      title: 'Hormone check-in',
      detail: `${symptoms.length} symptom${symptoms.length === 1 ? '' : 's'}${
        num(r.cycle_day) !== undefined ? ` · cycle day ${r.cycle_day}` : ''
      }`,
      observedAt: dateToIso(str(r.date), str(r.created_at)),
      recordedAt: str(r.created_at),
      sourceType: 'patient_reported' as const,
      source: 'hormone_entry',
    };
  });
}

export function mapClinicalFacts(rows: Row[]): TimelineEvent[] {
  return rows.map((r) => ({
    id: `fact:${String(r.id)}`,
    kind: 'clinical_fact' as const,
    title: str(r.label) ?? 'Clinical fact',
    detail: str(r.value_text) ?? (num(r.value_num) !== undefined ? `${r.value_num} ${str(r.unit) ?? ''}`.trim() : undefined),
    observedAt: str(r.observed_at) ?? new Date(0).toISOString(),
    recordedAt: str(r.recorded_at) ?? str(r.created_at),
    sourceType: (str(r.source_type) as TimelineEvent['sourceType']) ?? 'measured',
    source: str(r.source),
    valueNum: num(r.value_num),
    unit: str(r.unit),
    meta: { factType: str(r.fact_type), reviewStatus: str(r.review_status) },
  }));
}

export interface TimelineFilter {
  from?: string;
  to?: string;
  kinds?: TimelineEvent['kind'][];
}

/** Merges mapped events, applies filters, sorts newest-first, dedupes ids. */
export function mergeTimeline(events: TimelineEvent[], filter?: TimelineFilter): TimelineEvent[] {
  const seen = new Set<string>();
  const fromT = filter?.from ? new Date(filter.from).getTime() : -Infinity;
  const toT = filter?.to ? new Date(filter.to).getTime() : Infinity;
  const kinds = filter?.kinds?.length ? new Set(filter.kinds) : null;

  return events
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      const t = new Date(e.observedAt).getTime();
      if (Number.isNaN(t) || t < fromT || t > toT) return false;
      if (kinds && !kinds.has(e.kind)) return false;
      return true;
    })
    .sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
}
