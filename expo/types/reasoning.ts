// Clinical reasoning domain types (Phase 1).
// Invariant: every clinically meaningful record separates WHAT was observed
// (observedAt, value) from WHEN we learned it (recordedAt) and WHO/WHAT
// asserted it (sourceType) — AI output is never a confirmed fact.

export type ReasoningSourceType =
  | 'measured'
  | 'patient_reported'
  | 'practitioner_entered'
  | 'published_evidence'
  | 'ai_inference'
  | 'rule_engine';

export type ReasoningReviewStatus =
  | 'not_required'
  | 'pending_review'
  | 'accepted'
  | 'modified'
  | 'rejected';

export type HypothesisStatus =
  | 'proposed'
  | 'under_review'
  | 'supported'
  | 'weakened'
  | 'unresolved'
  | 'rejected'
  | 'archived';

export type EvidenceDirection = 'supports' | 'contradicts' | 'neutral';

export type ReviewDecisionStatus =
  | 'pending'
  | 'accepted'
  | 'modified'
  | 'rejected'
  | 'dismissed';

export type ReviewPriority = 'routine' | 'elevated' | 'urgent';

export type RelationshipType =
  | 'PRECEDES'
  | 'FOLLOWS'
  | 'CORRELATES_WITH'
  | 'MAY_CONTRIBUTE_TO'
  | 'CONTRADICTS'
  | 'IMPROVES'
  | 'WORSENS'
  | 'TARGETS'
  | 'INTERACTS_WITH'
  | 'DUPLICATES'
  | 'REQUIRES_MONITORING'
  | 'ASSOCIATED_WITH'
  | 'RULED_OUT_BY'
  | 'SUPPORTED_BY';

export interface ClinicalFact {
  id: string;
  userId: string;
  factType: string;
  code?: string;
  label: string;
  valueNum?: number;
  valueText?: string;
  valueJson?: Record<string, unknown>;
  unit?: string;
  originalValue?: string;
  originalUnit?: string;
  referenceLow?: number;
  referenceHigh?: number;
  observedAt: string;
  observedEndAt?: string;
  recordedAt: string;
  sourceType: ReasoningSourceType;
  source?: string;
  sourceRecordId?: string;
  sourceDocumentId?: string;
  sourceLocation?: string;
  dataQuality?: number;
  confidence?: number;
  reviewStatus: ReasoningReviewStatus;
  createdBy?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  version: number;
  supersededBy?: string;
}

export interface ClinicalHypothesis {
  id: string;
  userId: string;
  name: string;
  description?: string;
  status: HypothesisStatus;
  /** "Support level" 0–100 — reasoning strength, NOT a medical probability. */
  supportScore: number;
  priorSupportScore?: number;
  scoreChangeReason?: string;
  missingEvidence: string[];
  systems: string[];
  alternatives: { hypothesisId?: string; name: string }[];
  earliestSupportingAt?: string;
  sourceType: ReasoningSourceType;
  reviewStatus: ReasoningReviewStatus;
  createdBy?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
  supportingEvidence?: EvidenceItem[];
  contradictingEvidence?: EvidenceItem[];
}

export interface EvidenceItem {
  id: string;
  userId: string;
  hypothesisId: string;
  direction: EvidenceDirection;
  evidenceType: string;
  factId?: string;
  sourceType: ReasoningSourceType;
  summary: string;
  strength?: number;
  observedAt?: string;
  citation?: string;
  createdBy?: string;
  createdAt: string;
}

export interface ClinicalRelationship {
  id: string;
  userId: string;
  sourceKind: string;
  sourceRef: string;
  targetKind: string;
  targetRef: string;
  relationshipType: RelationshipType;
  direction: 'directed' | 'bidirectional';
  strength?: number;
  confidence?: number;
  temporalRelation?: { lagDays?: number; windowDays?: number };
  sourceType: ReasoningSourceType;
  reviewStatus: ReasoningReviewStatus;
  createdAt: string;
  expiresAt?: string;
}

export interface DetectedChange {
  metric: string;
  label: string;
  direction: 'increase' | 'decrease';
  magnitudePercent: number;
  currentValue: number;
  baselineValue: number;
  unit?: string;
  windowDays: number;
  severity: 'info' | 'notable' | 'significant';
  dataQuality?: number;
  observedAt: string;
}

export interface DataQualityIssue {
  kind: 'missing' | 'stale' | 'conflict' | 'low_confidence';
  subject: string;
  detail: string;
}

export interface MissingDataRecommendation {
  subject: string;
  reason: string;
  suggestion: string;
}

export interface ReasoningSnapshot {
  id: string;
  userId: string;
  snapshotNumber: number;
  trigger: string;
  pipelineVersion: string;
  inputsSummary: Record<string, unknown>;
  hypothesesState: HypothesisSnapshotEntry[];
  detectedChanges: DetectedChange[];
  dataQualityIssues: DataQualityIssue[];
  missingData: MissingDataRecommendation[];
  diffFromPrevious: SnapshotDiff;
  previousSnapshotId?: string;
  createdBy?: string;
  createdAt: string;
}

export interface HypothesisSnapshotEntry {
  hypothesisId: string;
  name: string;
  status: HypothesisStatus;
  supportScore: number;
  supportingCount: number;
  contradictingCount: number;
  sourceType: ReasoningSourceType;
  reviewStatus: ReasoningReviewStatus;
}

export interface SnapshotDiff {
  newChanges: string[];
  resolvedChanges: string[];
  hypothesesAdded: string[];
  hypothesesRemoved: string[];
  scoreChanges: { hypothesisId: string; name: string; from: number; to: number }[];
  summary: string;
}

export interface PractitionerReview {
  id: string;
  patientId: string;
  subjectType: 'hypothesis' | 'fact' | 'relationship' | 'snapshot_change' | 'recommendation';
  subjectId: string;
  priority: ReviewPriority;
  proposedSummary: string;
  context: Record<string, unknown>;
  status: ReviewDecisionStatus;
  decisionNote?: string;
  modifiedPayload?: Record<string, unknown>;
  createdBy?: string;
  decidedBy?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface PractitionerPatientRelationship {
  id: string;
  practitionerId: string;
  patientId: string;
  status: 'pending' | 'active' | 'revoked' | 'ended';
  consentScope: Record<string, boolean>;
  grantedBy?: string;
  note?: string;
  createdAt: string;
  endedAt?: string;
}

export type TimelineEventKind =
  | 'lab_panel'
  | 'lab_marker'
  | 'symptom'
  | 'protocol'
  | 'supplement'
  | 'meal'
  | 'wearable_day'
  | 'hormone'
  | 'clinical_fact'
  | 'snapshot';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  title: string;
  detail?: string;
  /** Clinical time — when it happened to the patient. */
  observedAt: string;
  /** Ingestion time — when the platform learned about it. */
  recordedAt?: string;
  sourceType: ReasoningSourceType;
  source?: string;
  valueNum?: number;
  unit?: string;
  meta?: Record<string, unknown>;
}

export const SOURCE_TYPE_LABELS: Record<ReasoningSourceType, string> = {
  measured: 'Measured',
  patient_reported: 'Patient-reported',
  practitioner_entered: 'Practitioner',
  published_evidence: 'Published evidence',
  ai_inference: 'AI inference',
  rule_engine: 'Rule engine',
};

export const REVIEW_STATUS_LABELS: Record<ReasoningReviewStatus, string> = {
  not_required: 'No review needed',
  pending_review: 'Pending review',
  accepted: 'Practitioner accepted',
  modified: 'Practitioner modified',
  rejected: 'Practitioner rejected',
};
