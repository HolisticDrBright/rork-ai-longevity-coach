/**
 * Type contract for the Month 6 outcome report.
 *
 * The report is the single source of truth for the patient-facing "Results"
 * screen, the practitioner-facing outcome panel, the PDF export, and the
 * cohort-stats aggregate. Every field is optional so the UI can render
 * graceful placeholders when data is missing.
 */

export type Direction = 'improved' | 'declined' | 'stable' | 'unknown';
export type Sentiment = 'positive' | 'negative' | 'neutral';

export interface MetricDelta {
  label: string;
  unit?: string;
  baseline?: number;
  current?: number;
  delta?: number;
  deltaPercent?: number;
  direction: Direction;
  sentiment: Sentiment;
  // Narrative line rendered in the UI and included in the PDF.
  summary?: string;
  // When a metric is important but unmeasured, set missing to true and
  // use summary to explain what to collect next.
  missing?: boolean;
}

export interface OrganAgeDelta {
  organ: string;
  baseline?: number;
  current?: number;
  delta?: number;
  direction: Direction;
}

export interface BiologicalAgeBlock {
  baselineTruAge?: number;
  currentTruAge?: number;
  deltaYears?: number;
  targetDeltaYears?: number;  // what the protocol aimed for
  direction: Direction;
  sentiment: Sentiment;
  organs: OrganAgeDelta[];
}

export interface InflammationBlock {
  crp?: MetricDelta;
  il6?: MetricDelta;
  homocysteine?: MetricDelta;
  compositeScore?: MetricDelta;  // 0-100 synthetic score
}

export interface WearableBlock {
  hrv?: MetricDelta;
  restingHr?: MetricDelta;
  deepSleepPct?: MetricDelta;
  remSleepPct?: MetricDelta;
  sleepEfficiency?: MetricDelta;
  spo2Mean?: MetricDelta;
  spo2Variance?: MetricDelta;
  vo2Max?: MetricDelta;
}

export interface BodyCompBlock {
  weight?: MetricDelta;
  bodyFatPct?: MetricDelta;
  leanMass?: MetricDelta;
  waistToHipRatio?: MetricDelta;
}

export interface LabShiftsBlock {
  nutrEval: {
    correctedDeficiencies: string[];
    remainingDeficiencies: string[];
  };
  dutch?: {
    baselineCortisolRhythm?: string;
    currentCortisolRhythm?: string;
    normalized: boolean;
  };
  giMap?: {
    baselineDysbiosisScore?: number;
    currentDysbiosisScore?: number;
    resolvedMarkers: string[];
    persistentMarkers: string[];
  };
  oat?: {
    topImprovedMetabolites: { name: string; direction: Direction }[];
    topRemainingMetabolites: { name: string; direction: Direction }[];
  };
}

export interface AdherenceBlock {
  supplementPct?: number;
  peptidePct?: number;
  fastingPct?: number;
  exercisePct?: number;
  overallPct?: number;
  totalDosesScheduled?: number;
  totalDosesTaken?: number;
}

export interface PatientReportedBlock {
  energy?: { baseline: number; current: number; delta: number };
  sleepQuality?: { baseline: number; current: number; delta: number };
  cognitiveFunction?: { baseline: number; current: number; delta: number };
  complaintsResolution: {
    complaint: string;
    status: 'resolved' | 'improved' | 'unchanged' | 'worsened';
  }[];
}

export interface NarrativeBlock {
  topWins: string[];
  topGaps: string[];
  maintenanceRecommendation: string;
  practitionerNotes?: string;
}

export interface OutcomeReport {
  protocolId: string;
  userId: string;
  generatedAt: string;
  dataCompletenessPct: number;  // 0-100; missing data pulls this down
  biologicalAge: BiologicalAgeBlock;
  inflammation: InflammationBlock;
  wearables: WearableBlock;
  bodyComp: BodyCompBlock;
  labShifts: LabShiftsBlock;
  adherence: AdherenceBlock;
  patientReported: PatientReportedBlock;
  narrative: NarrativeBlock;
}
