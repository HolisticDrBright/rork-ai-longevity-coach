// Row mappers: snake_case DB rows → camelCase reasoning domain types.

import type {
  ClinicalFact,
  ClinicalHypothesis,
  EvidenceItem,
  PractitionerPatientRelationship,
  PractitionerReview,
  ReasoningSnapshot,
} from '@/types/reasoning';

type Row = Record<string, unknown>;

const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const n = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function mapRowToHypothesis(row: Row): ClinicalHypothesis {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: s(row.name) ?? '',
    description: s(row.description),
    status: (s(row.status) as ClinicalHypothesis['status']) ?? 'proposed',
    supportScore: n(row.support_score) ?? 0,
    priorSupportScore: n(row.prior_support_score),
    scoreChangeReason: s(row.score_change_reason),
    missingEvidence: arr<string>(row.missing_evidence),
    systems: arr<string>(row.systems),
    alternatives: arr<{ hypothesisId?: string; name: string }>(row.alternatives),
    earliestSupportingAt: s(row.earliest_supporting_at),
    sourceType: (s(row.source_type) as ClinicalHypothesis['sourceType']) ?? 'practitioner_entered',
    reviewStatus: (s(row.review_status) as ClinicalHypothesis['reviewStatus']) ?? 'pending_review',
    createdBy: s(row.created_by),
    reviewedBy: s(row.reviewed_by),
    reviewedAt: s(row.reviewed_at),
    createdAt: s(row.created_at) ?? '',
    updatedAt: s(row.updated_at) ?? '',
  };
}

export function mapRowToEvidence(row: Row): EvidenceItem {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    hypothesisId: String(row.hypothesis_id),
    direction: (s(row.direction) as EvidenceItem['direction']) ?? 'neutral',
    evidenceType: s(row.evidence_type) ?? 'observation',
    factId: s(row.fact_id),
    sourceType: (s(row.source_type) as EvidenceItem['sourceType']) ?? 'measured',
    summary: s(row.summary) ?? '',
    strength: n(row.strength),
    observedAt: s(row.observed_at),
    citation: s(row.citation),
    createdBy: s(row.created_by),
    createdAt: s(row.created_at) ?? '',
  };
}

export function mapRowToFact(row: Row): ClinicalFact {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    factType: s(row.fact_type) ?? 'note',
    code: s(row.code),
    label: s(row.label) ?? '',
    valueNum: n(row.value_num),
    valueText: s(row.value_text),
    valueJson: obj(row.value_json),
    unit: s(row.unit),
    originalValue: s(row.original_value),
    originalUnit: s(row.original_unit),
    referenceLow: n(row.reference_low),
    referenceHigh: n(row.reference_high),
    observedAt: s(row.observed_at) ?? '',
    observedEndAt: s(row.observed_end_at),
    recordedAt: s(row.recorded_at) ?? '',
    sourceType: (s(row.source_type) as ClinicalFact['sourceType']) ?? 'measured',
    source: s(row.source),
    sourceRecordId: s(row.source_record_id),
    sourceDocumentId: s(row.source_document_id),
    sourceLocation: s(row.source_location),
    dataQuality: n(row.data_quality),
    confidence: n(row.confidence),
    reviewStatus: (s(row.review_status) as ClinicalFact['reviewStatus']) ?? 'not_required',
    createdBy: s(row.created_by),
    reviewedBy: s(row.reviewed_by),
    reviewedAt: s(row.reviewed_at),
    version: n(row.version) ?? 1,
    supersededBy: s(row.superseded_by),
  };
}

export function mapRowToSnapshot(row: Row): ReasoningSnapshot {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    snapshotNumber: n(row.snapshot_number) ?? 0,
    trigger: s(row.trigger) ?? 'manual',
    pipelineVersion: s(row.pipeline_version) ?? '0',
    inputsSummary: obj(row.inputs_summary),
    hypothesesState: arr(row.hypotheses_state),
    detectedChanges: arr(row.detected_changes),
    dataQualityIssues: arr(row.data_quality_issues),
    missingData: arr(row.missing_data),
    diffFromPrevious: obj(row.diff_from_previous) as unknown as ReasoningSnapshot['diffFromPrevious'],
    previousSnapshotId: s(row.previous_snapshot_id),
    createdBy: s(row.created_by),
    createdAt: s(row.created_at) ?? '',
  };
}

export function mapRowToReview(row: Row): PractitionerReview {
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    subjectType: (s(row.subject_type) as PractitionerReview['subjectType']) ?? 'hypothesis',
    subjectId: s(row.subject_id) ?? '',
    priority: (s(row.priority) as PractitionerReview['priority']) ?? 'routine',
    proposedSummary: s(row.proposed_summary) ?? '',
    context: obj(row.context),
    status: (s(row.status) as PractitionerReview['status']) ?? 'pending',
    decisionNote: s(row.decision_note),
    modifiedPayload: row.modified_payload ? obj(row.modified_payload) : undefined,
    createdBy: s(row.created_by),
    decidedBy: s(row.decided_by),
    createdAt: s(row.created_at) ?? '',
    decidedAt: s(row.decided_at),
  };
}

export function mapRowToRelationship(row: Row): PractitionerPatientRelationship {
  return {
    id: String(row.id),
    practitionerId: String(row.practitioner_id),
    patientId: String(row.patient_id),
    status: (s(row.status) as PractitionerPatientRelationship['status']) ?? 'active',
    consentScope: obj(row.consent_scope) as Record<string, boolean>,
    grantedBy: s(row.granted_by),
    note: s(row.note),
    createdAt: s(row.created_at) ?? '',
    endedAt: s(row.ended_at),
  };
}
