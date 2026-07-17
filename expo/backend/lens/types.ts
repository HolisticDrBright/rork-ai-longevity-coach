/**
 * Clinical lens engine — shared types (Milestone 2).
 *
 * The INVARIANT CORE is paradigm-independent BY CONSTRUCTION: it is computed
 * before any lens is consulted and its type never appears in lens-framing
 * output. Lenses may re-rank and re-frame non-urgent material only.
 */

export interface SourceRef {
  kind:
    | 'biomarker_observation'
    | 'medication'
    | 'allergy'
    | 'transcript_segment'
    | 'patient_profile'
    | 'supplement';
  id: string;
  /** exact record version (updated_at / revision) captured at cutoff */
  version: string;
  label?: string;
}

export interface LensInputs {
  encounterId: string;
  organizationId: string;
  patientId: string;
  demographics: { dateOfBirth: string | null; sex: string | null };
  biomarkers: {
    id: string;
    name: string;
    value: number | null;
    valueText: string | null;
    unit: string | null;
    observedAt: string | null;
    version: string;
  }[];
  medications: { id: string; name: string; status: string; version: string }[];
  allergies: { id: string; allergen: string; reaction: string | null; severity: string | null; version: string }[];
  supplements: { id: string; name: string; version: string }[];
  transcript: { segmentId: string; text: string; source: 'raw' | 'corrected'; version: string }[];
  cutoffAt: string;
}

export interface CoreFact {
  fact: string;
  sourceRef: string;
}
export interface RedFlag {
  code: string;
  label: string;
  urgent: boolean;
  domainCode: string;
  sourceRefs: string[];
  knowledgeSourceCodes: string[];
}
export interface InteractionFinding {
  pair: [string, string];
  concern: string;
  knowledgeSourceCodes: string[];
  sourceRefs: string[];
}

/** Req 2 — the eleven mandatory sections. */
export interface InvariantCore {
  objectiveFacts: CoreFact[];
  provenance: SourceRef[];
  missingInformation: string[];
  conflicts: { description: string; sourceRefs: string[] }[];
  allergies: { allergen: string; reaction: string | null; severity: string | null; sourceRef: string }[];
  interactions: InteractionFinding[];
  criticalLabs: { name: string; value: string; concern: string; sourceRef: string; knowledgeSourceCodes: string[] }[];
  redFlags: RedFlag[];
  emergencyConsiderations: string[];
  evidenceQuality: Record<string, string>;
  limitations: string[];
}

export interface CandidateQuestion {
  questionText: string;
  rationale: string;
  distinguishes: string[];
  safetyRelation?: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  answerType: 'free_text' | 'yes_no' | 'numeric' | 'choice' | 'scale';
  domainCode: string;
  patientSources: { ref: string; label?: string }[];
  knowledgeSourceCodes: string[];
  missingDataAssumptions: string[];
  generationMethod: 'deterministic_rules' | 'ai_assisted';
  generationVersion: string;
  dedupeKey: string;
  /** which lens proposed it — for transparent composition */
  sourceLens: string;
}

export interface LensFraming {
  paradigm: string;
  /** domain ranking — urgent (red-flag) domains must stay first */
  ranking: { domainCode: string; sourceLens: string; note?: string }[];
  terminology: { term: string; framedAs: string; note: string; knowledgeSourceCodes: string[] }[];
  framingNotes: string[];
  /** synergistic only: conflicts between member lenses, resolved openly */
  compositionConflicts: { domainCode: string; positions: { lens: string; rank: number }[]; resolution: string }[];
}

export interface SafetyFailure {
  ruleCode: string;
  detail: Record<string, unknown>;
}
