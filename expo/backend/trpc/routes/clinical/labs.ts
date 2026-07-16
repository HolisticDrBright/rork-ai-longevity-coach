import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter } from '../../create-context';
import {
  clinicalAuthenticatedProcedure,
  patientAccessProcedure,
} from '../../clinical-authorization';
import { throwFromRpcError } from './rpc-errors';

/**
 * clinical.labs — the desktop's live labs namespace.
 *
 * getWorkspace shapes real biomarker_observations (+ definitions + source
 * documents) into the desktop's LabWorkspace DTO. Mapping rules, in order of
 * clinical importance:
 *  - the ORIGINAL laboratory reference interval is passed through verbatim
 *    (never hidden, never replaced by an optimal range);
 *  - optimal ranges are returned "Not configured" until a practice-scoped
 *    optimal-range table exists — the UI shows the honest absence;
 *  - marker status is NOT derived server-side (parsing free-text reference
 *    intervals to classify high/low is guesswork, and a wrong flag is worse
 *    than none) — markers report "normal"/"needs-review" by review state
 *    until structured ranges exist;
 *  - extraction confidence is the stored ingestion confidence, surfaced as a
 *    0–100 completeness figure with low-confidence review gating intact.
 *
 * reviewMarker calls the review_biomarker SECURITY DEFINER RPC (migration
 * 0013): review columns + append-only audit row, atomically; lab values,
 * units, reference intervals, provenance and confidence are never touched.
 */

interface ObservationRow {
  id: string;
  biomarker_definition_id: string | null;
  value_numeric: number | null;
  value_text: string | null;
  unit: string | null;
  status: string | null;
  original_reference_interval: string | null;
  confidence: number | null;
  provenance: string | null;
  review_status: string;
  reviewed_at: string | null;
  observed_at: string;
  ingested_at: string;
  lab_document_id: string | null;
  source: string;
  biomarker_definitions: { canonical_name: string; biological_system: string | null } | null;
  lab_documents: { file_name: string | null; lab_company: string | null } | null;
}

interface DocumentRow {
  id: string;
  file_name: string | null;
  lab_company: string | null;
  panel_name: string | null;
  lab_date: string | null;
  created_at: string;
}

const fmtDate = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

const trim = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return String(r);
};

/** 0–1 or 0–100 stored confidence → 0–100 integer. */
export function confidencePct(raw: number | null): number {
  if (raw == null) return 50;
  const pct = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

const bandOf = (pct: number): 'high' | 'medium' | 'low' =>
  pct >= 90 ? 'high' : pct >= 70 ? 'medium' : 'low';

const ABNORMAL_STATUSES = new Set(['high', 'low', 'abnormal', 'critical', 'critical-high', 'critical-low']);

/** Group observations by definition and shape the desktop marker DTOs. */
export function buildMarkers(rows: ObservationRow[]) {
  const byDef = new Map<string, ObservationRow[]>();
  for (const row of rows) {
    if (row.value_numeric == null) continue; // text-only results: chart later, never fabricate numbers
    const key = row.biomarker_definition_id ?? `unnamed:${row.id}`;
    const list = byDef.get(key) ?? [];
    list.push(row);
    byDef.set(key, list);
  }

  const markers = [];
  for (const list of byDef.values()) {
    list.sort((a, b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime());
    const latest = list[0];
    const prior = list[1];
    const name = latest.biomarker_definitions?.canonical_name ?? 'Unnamed marker';
    const unit = latest.unit ?? '';
    const current = Number(latest.value_numeric);
    const priorVal = prior?.value_numeric != null ? Number(prior.value_numeric) : undefined;
    const pct = confidencePct(latest.confidence);
    const reviewState =
      latest.review_status === 'accepted'
        ? ('reviewed' as const)
        : latest.review_status === 'unreviewed'
          ? ('awaiting-review' as const)
          : ('not-reviewed' as const);
    const series = [...list]
      .reverse()
      .slice(-7)
      .map((o) => ({ date: fmtDate(o.observed_at), value: Number(o.value_numeric) }));
    const abnormal = ABNORMAL_STATUSES.has((latest.status ?? '').toLowerCase());

    markers.push({
      id: latest.id,
      name,
      unit,
      current,
      currentDisplay: trim(current),
      prior: priorVal,
      priorDisplay: priorVal != null ? trim(priorVal) : undefined,
      changeDisplay:
        priorVal != null ? `${current - priorVal >= 0 ? '+' : '−'}${trim(Math.abs(current - priorVal))}` : undefined,
      changePct:
        priorVal != null && priorVal !== 0
          ? Math.round(((current - priorVal) / priorVal) * 1000) / 10
          : undefined,
      labRangeText: latest.original_reference_interval ?? 'Not provided by lab',
      optimalRange: { unit, source: 'Not configured' },
      status: abnormal ? ('high' as const) : ('normal' as const),
      trend: reviewState === 'awaiting-review' ? ('needs-review' as const) : ('stable' as const),
      series,
      confidence: pct,
      confidenceBand: bandOf(pct),
      reviewState,
      collectedAt: fmtDate(latest.observed_at),
      source: {
        reportName:
          latest.lab_documents?.file_name ??
          `${latest.lab_documents?.lab_company ?? latest.source} record`,
        location: 'Lab record',
        snippet: `${name}  ${trim(current)} ${unit}   Ref: ${latest.original_reference_interval ?? 'n/a'}`,
        confidenceNote:
          pct >= 90
            ? 'High extraction confidence from the source record.'
            : 'Verify value and unit against the source before relying on this result.',
      },
      provenance: {
        sourceType: 'measured' as const,
        sourceName: `${latest.lab_documents?.lab_company ?? 'Lab'} · ${fmtDate(latest.observed_at)}`,
        lastUpdated: fmtDate(latest.ingested_at),
        confidence: pct,
        review: reviewState,
      },
      relatedSystems: latest.biomarker_definitions?.biological_system
        ? [latest.biomarker_definitions.biological_system]
        : [],
      relatedContext: [],
      relatedHypotheses: [],
      relatedProtocols: [],
      seeds: [`${name} ${trim(current)} ${unit} (${fmtDate(latest.observed_at)})`],
    });
  }
  markers.sort((a, b) => a.name.localeCompare(b.name));
  return markers;
}

export const clinicalLabsRouter = createTRPCRouter({
  getWorkspace: patientAccessProcedure.query(async ({ ctx }) => {
    const [obs, docs, patient] = await Promise.all([
      ctx.clinicalDb
        .from('biomarker_observations')
        .select(
          'id, biomarker_definition_id, value_numeric, value_text, unit, status, original_reference_interval, confidence, provenance, review_status, reviewed_at, observed_at, ingested_at, lab_document_id, source, biomarker_definitions ( canonical_name, biological_system ), lab_documents ( file_name, lab_company )',
        )
        .eq('patient_id', ctx.patient.id)
        .is('deleted_at', null)
        .order('observed_at', { ascending: false })
        .limit(1000),
      ctx.clinicalDb
        .from('lab_documents')
        .select('id, file_name, lab_company, panel_name, lab_date, created_at')
        .eq('patient_id', ctx.patient.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(20),
      ctx.clinicalDb
        .from('patient_profiles')
        .select('first_name, last_name')
        .eq('id', ctx.patient.id)
        .maybeSingle(),
    ]);
    if (obs.error || docs.error) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to load labs workspace' });
    }

    const rows = (obs.data ?? []) as unknown as ObservationRow[];
    const documents = (docs.data ?? []) as unknown as DocumentRow[];
    const markers = buildMarkers(rows);

    const awaiting = rows.filter((r) => r.review_status === 'unreviewed').length;
    const lowConfidence = rows.filter((r) => confidencePct(r.confidence) < 70).length;
    const abnormal = rows.filter((r) => ABNORMAL_STATUSES.has((r.status ?? '').toLowerCase())).length;
    const reviewed = rows.filter((r) => r.review_status === 'accepted').length;

    const queue = [
      awaiting > 0 && {
        id: 'q-awaiting',
        kind: 'extraction-review' as const,
        label: `${awaiting} marker${awaiting === 1 ? '' : 's'} awaiting review`,
        source: 'Live record',
        date: fmtDate(rows[0]?.ingested_at ?? null),
        count: awaiting,
        tone: 'ai' as const,
      },
      lowConfidence > 0 && {
        id: 'q-lowconf',
        kind: 'low-confidence' as const,
        label: `${lowConfidence} low-confidence extraction${lowConfidence === 1 ? '' : 's'}`,
        source: 'Live record',
        date: fmtDate(rows[0]?.ingested_at ?? null),
        count: lowConfidence,
        tone: 'warning' as const,
      },
      abnormal > 0 && {
        id: 'q-abnormal',
        kind: 'abnormal' as const,
        label: `${abnormal} flagged abnormal by source`,
        source: 'Live record',
        date: fmtDate(rows[0]?.observed_at ?? null),
        count: abnormal,
        tone: 'critical' as const,
      },
    ].filter(Boolean);

    const name = patient.data
      ? `${(patient.data as { first_name: string | null }).first_name ?? ''} ${(patient.data as { last_name: string | null }).last_name ?? ''}`.trim()
      : 'this patient';

    return {
      patientId: ctx.patient.id,
      patientName: name,
      lastUpload: fmtDate(documents[0]?.created_at ?? null),
      lastSynced: fmtDate(rows[0]?.ingested_at ?? null),
      reviewSummary: { reviewed, awaiting, lowConfidence, abnormal },
      reports: documents.map((d) => ({
        id: d.id,
        name: d.panel_name ?? d.file_name ?? 'Lab document',
        lab: d.lab_company ?? '—',
        collectedAt: fmtDate(d.lab_date),
        uploadedAt: fmtDate(d.created_at),
        markerCount: rows.filter((r) => r.lab_document_id === d.id).length,
      })),
      queue,
      markers,
    };
  }),

  reviewMarker: clinicalAuthenticatedProcedure
    .input(
      z.object({
        observationId: z.string().uuid(),
        decision: z.enum(['accepted', 'flagged', 'rejected']),
        note: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.clinicalDb.rpc('review_biomarker', {
        _observation_id: input.observationId,
        _decision: input.decision,
        _note: input.note ?? null,
      });
      if (error) throwFromRpcError(error, 'review biomarker');
      const json = data as unknown as { review_status: string; reviewed_at: string; previous_status: string };
      return {
        ok: true as const,
        reviewStatus: json.review_status as 'accepted' | 'flagged' | 'rejected',
        reviewedAt: json.reviewed_at ?? null,
        previousStatus: json.previous_status ?? null,
        message: `Marker review saved (${input.decision}).`,
      };
    }),
});
