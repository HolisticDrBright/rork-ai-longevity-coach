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
  original_name: string | null;
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

/**
 * 0–1 or 0–100 stored confidence → 0–100 integer, or NULL when the source
 * never recorded one. Missing confidence is UNKNOWN — it must never be
 * fabricated as a number (a made-up "50%" reads as false precision), and
 * unknown always requires review downstream.
 */
export function confidencePct(raw: number | null): number | null {
  if (raw == null) return null;
  const pct = raw <= 1 ? raw * 100 : raw;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export const bandOf = (pct: number | null): 'high' | 'medium' | 'low' | 'unknown' =>
  pct == null ? 'unknown' : pct >= 90 ? 'high' : pct >= 70 ? 'medium' : 'low';

/**
 * Stored status → desktop status, VERBATIM per direction. The stored value
 * comes from the source lab's printed flag (never derived from free-text
 * ranges). A missing status is UNKNOWN — never assumed normal, and never
 * collapsed into "high" like the pre-P0 mapping did.
 */
export function mapMarkerStatus(
  stored: string | null,
): 'normal' | 'optimal' | 'low' | 'high' | 'critical-low' | 'critical-high' | 'unknown' {
  switch ((stored ?? '').toLowerCase()) {
    case 'normal':
      return 'normal';
    case 'optimal':
      return 'optimal';
    case 'low':
      return 'low';
    case 'high':
      return 'high';
    case 'critical_low':
    case 'critical-low':
      return 'critical-low';
    case 'critical_high':
    case 'critical-high':
      return 'critical-high';
    default:
      return 'unknown';
  }
}

const ABNORMAL = new Set(['low', 'high', 'critical-low', 'critical-high']);

/** Group observations by definition and shape the desktop marker DTOs. */
export function buildMarkers(rows: ObservationRow[]) {
  const byDef = new Map<string, ObservationRow[]>();
  for (const row of rows) {
    if (row.value_numeric == null) continue; // text-only results: chart later, never fabricate numbers
    // Unmatched extractions group by their verbatim source name so repeat
    // uploads of the same unknown marker still form one series.
    const key =
      row.biomarker_definition_id ??
      (row.original_name ? `orig:${row.original_name.toLowerCase()}` : `unnamed:${row.id}`);
    const list = byDef.get(key) ?? [];
    list.push(row);
    byDef.set(key, list);
  }

  const markers = [];
  for (const list of byDef.values()) {
    list.sort((a, b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime());
    const latest = list[0];
    const prior = list[1];
    const name =
      latest.biomarker_definitions?.canonical_name ?? latest.original_name ?? 'Unnamed marker';
    const unit = latest.unit ?? '';
    const current = Number(latest.value_numeric);
    const priorVal = prior?.value_numeric != null ? Number(prior.value_numeric) : undefined;
    const pct = confidencePct(latest.confidence);
    const band = bandOf(pct);
    const status = mapMarkerStatus(latest.status);
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
      status,
      trend: reviewState === 'awaiting-review' ? ('needs-review' as const) : ('stable' as const),
      series,
      confidence: pct,
      confidenceBand: band,
      reviewState,
      collectedAt: fmtDate(latest.observed_at),
      source: {
        reportName:
          latest.lab_documents?.file_name ??
          `${latest.lab_documents?.lab_company ?? latest.source} record`,
        // Rebuilt from structured columns — NOT an excerpt of the source PDF.
        location: 'Structured result preview',
        snippet: `${name}  ${trim(current)} ${unit}   Ref: ${latest.original_reference_interval ?? 'n/a'}`,
        confidenceNote:
          pct == null
            ? 'Extraction confidence was not recorded — verify against the source before relying on this result.'
            : pct >= 90
              ? 'High extraction confidence from the source record.'
              : 'Verify value and unit against the source before relying on this result.',
        documentId: latest.lab_document_id,
      },
      provenance: {
        sourceType: 'measured' as const,
        sourceName: `${latest.lab_documents?.lab_company ?? 'Lab'} · ${fmtDate(latest.observed_at)}`,
        lastUpdated: fmtDate(latest.ingested_at),
        confidence: pct ?? undefined,
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
          'id, biomarker_definition_id, original_name, value_numeric, value_text, unit, status, original_reference_interval, confidence, provenance, review_status, reviewed_at, observed_at, ingested_at, lab_document_id, source, biomarker_definitions ( canonical_name, biological_system ), lab_documents ( file_name, lab_company )',
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

    // Counts describe the CURRENT marker set (latest observation per marker) —
    // historical observations must not inflate the review workload numbers.
    const awaiting = markers.filter((m) => m.reviewState === 'awaiting-review').length;
    const reviewed = markers.filter((m) => m.reviewState === 'reviewed').length;
    const lowConfidence = markers.filter(
      (m) => m.confidenceBand === 'low' || m.confidenceBand === 'unknown',
    ).length;
    const abnormal = markers.filter((m) => ABNORMAL.has(m.status)).length;

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
      const json = data as unknown as {
        review_status: string;
        reviewed_at: string;
        previous_status: string;
        already_set?: boolean;
      };
      return {
        ok: true as const,
        reviewStatus: json.review_status as 'accepted' | 'flagged' | 'rejected',
        reviewedAt: json.reviewed_at ?? null,
        previousStatus: json.previous_status ?? null,
        message: json.already_set
          ? `Already reviewed (${input.decision}) — no duplicate audit written.`
          : `Marker review saved (${input.decision}).`,
      };
    }),
});
