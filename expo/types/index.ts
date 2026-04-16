export type AppUserRole = 'patient' | 'clinician';

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  sex: 'male' | 'female' | 'other';
  height: number;
  weight: number;
  goals: string[];
  onboardingCompleted: boolean;
  createdAt: string;
  role: AppUserRole;
}

export interface LifestyleProfile {
  sleepHours: number;
  sleepQuality: number;
  stressLevel: number;
  dietType: 'omnivore' | 'vegetarian' | 'vegan' | 'keto' | 'paleo' | 'mediterranean' | 'other';
  cookingSkill: 'none' | 'basic' | 'intermediate' | 'advanced';
  shoppingCadence: 'daily' | 'twice_weekly' | 'weekly' | 'biweekly';
  exerciseFrequency: number;
  exerciseTypes: string[];
}

export interface Contraindication {
  pregnant: boolean;
  nursing: boolean;
  medications: string[];
  allergies: string[];
  conditions: string[];
}

export interface QuestionnaireCategory {
  id: string;
  name: string;
  icon: string;
  description: string;
  questions: QuestionnaireQuestion[];
}

export interface QuestionnaireQuestion {
  id: string;
  text: string;
  categoryId: string;
}

export interface QuestionnaireResponse {
  questionId: string;
  categoryId: string;
  severity: number;
  timestamp: string;
}

export interface CategoryScore {
  categoryId: string;
  categoryName: string;
  score: number;
  maxScore: number;
  percentage: number;
}

export interface Supplement {
  id: string;
  name: string;
  brand?: string;
  dose: string;
  frequency: string;
  timing: 'morning' | 'afternoon' | 'evening' | 'with_meals' | 'before_bed';
  notes?: string;
  orderingLink?: string;
}

export interface Peptide {
  id: string;
  name: string;
  dose: string;
  cycleLength: number;
  daysOn: number;
  daysOff: number;
  timing: string;
  notes?: string;
}

export interface FastingPlan {
  id: string;
  type: 'intermittent' | '24h' | '36h' | '72h' | 'custom';
  eatingWindow: { start: string; end: string };
  extended24hDays?: string[];
  notes?: string;
}

export interface LifestyleTask {
  id: string;
  type: 'sauna' | 'cold_plunge' | 'steps' | 'workout' | 'sleep_routine' | 'meditation' | 'sunlight' | 'custom';
  name: string;
  target?: number;
  unit?: string;
  frequency: string;
  timing?: string;
  notes?: string;
}

export interface Protocol {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate?: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  version: number;
  supplements: Supplement[];
  peptides: Peptide[];
  fastingPlan?: FastingPlan;
  lifestyleTasks: LifestyleTask[];
  createdAt: string;
  updatedAt: string;
}

export interface DailyAdherence {
  id: string;
  date: string;
  protocolId: string;
  completedSupplements: string[];
  completedPeptides: string[];
  completedTasks: string[];
  fastingCompleted: boolean;
  notes?: string;
  symptoms: DailySymptoms;
}

export interface DailySymptoms {
  energy: number;
  sleep: number;
  mood: number;
  digestion: number;
  focus: number;
  notes?: string;
}

export interface WeeklyCheckIn {
  id: string;
  date: string;
  weight: number;
  waistCircumference?: number;
  restingHeartRate?: number;
  sleepScore?: number;
  wins: string;
  challenges: string;
  notes?: string;
}

export interface Biomarker {
  id: string;
  name: string;
  value: number;
  unit: string;
  referenceRange: { min: number; max: number };
  functionalRange: { min: number; max: number };
  status: 'optimal' | 'normal' | 'suboptimal' | 'critical';
  date: string;
}

export interface LabPanel {
  id: string;
  name: string;
  date: string;
  source: string;
  fileUrl?: string;
  biomarkers: Biomarker[];
  notes?: string;
}

export interface TodayAction {
  id: string;
  type: 'supplement' | 'peptide' | 'fasting' | 'task';
  name: string;
  details: string;
  timing: string;
  completed: boolean;
  itemId: string;
}

export interface HealthDisorder {
  id: string;
  name: string;
  description: string;
  riskPercentage: number;
  riskLevel: 'low' | 'medium' | 'high';
  relatedCategories: string[];
  symptoms: string[];
  recommendedLabs: LabRecommendation[];
}

export interface LabRecommendation {
  id: string;
  name: string;
  description: string;
  orderLink: string;
  priority: 'primary' | 'secondary';
}

export interface HormoneSymptom {
  id: string;
  name: string;
  category: 'high_testosterone_dhea' | 'low_progesterone' | 'low_estrogen' | 'high_estrogen';
  description: string;
}

export interface HormoneEntry {
  id: string;
  date: string;
  cycleDay?: number;
  symptoms: {
    symptomId: string;
    severity: number;
  }[];
  notes?: string;
  currentSupplements?: {
    name: string;
    dose: string;
  }[];
}

export interface HormoneGuidance {
  hormone: string;
  status: 'high' | 'low' | 'normal';
  score: number;
  recommendation: string;
  dosageAction: 'increase' | 'decrease' | 'maintain' | 'consult';
  supplements: string[];
}

export interface LabAnalysis {
  id: string;
  panelId: string;
  date: string;
  summary: string;
  status: 'pending' | 'completed' | 'error';
}

export interface ConditionSupplement {
  id: string;
  name: string;
  brand?: string;
  dose?: string;
  frequency?: string;
  timing?: 'morning' | 'afternoon' | 'evening' | 'with_meals' | 'before_bed';
  notes?: string;
  source: 'fullscript' | 'affiliate' | 'mixed';
  affiliateUrl?: string;
  discountCode?: string;
  condition?: string;
}

export interface ProtocolPhase {
  id: string;
  name: string;
  duration?: string;
  supplements: ConditionSupplement[];
}

export interface ConditionProtocol {
  id: string;
  name: string;
  description: string;
  diet?: string;
  duration?: string;
  lifestyle?: string[];
  supplements: ConditionSupplement[];
  phases?: ProtocolPhase[];
  notes?: string;
}

export type TherapeuticDiet = 'AIP' | 'LOW_FODMAP' | 'KETO' | 'LOW_HISTAMINE';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface DietProfile {
  id: string;
  userId: string;
  activeDiets: TherapeuticDiet[];
  allergies: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface FoodLogItem {
  id: string;
  foodLogId: string;
  name: string;
  passioFoodId: string | null;
  portionQty: number;
  portionUnit: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
  tags: string[];
  createdAt: string;
}

export interface NutritionTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
}

export interface DietCompliance {
  score: number;
  violations: string[];
  cautions: string[];
}

export interface FoodLog {
  id: string;
  userId: string;
  createdAt: string;
  mealType: MealType;
  photoUrl: string | null;
  passioRawJson: any;
  confirmedItemsJson: any;
  totals: NutritionTotals;
  compliance: Record<string, DietCompliance>;
  suggestions: string[];
  items: FoodLogItem[];
  notes: string;
}

export interface DetectedFoodItem {
  id: string;
  name: string;
  passioFoodId: string | null;
  confidence: number;
  portionQty: number;
  portionUnit: string;
  suggestedPortions: string[];
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface AnalyzePhotoResult {
  foodLogId: string;
  detectedItems: DetectedFoodItem[];
  passioRawJson: any;
  clarifyingQuestions: ClarifyingQuestion[];
}

export interface DaySummary {
  date: string;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  mealsLogged: number;
  overallCompliance: Record<string, DietCompliance>;
}

export type PeptideGoal = 
  | 'fat_loss' 
  | 'sleep' 
  | 'recovery' 
  | 'injury_rehab' 
  | 'cognition' 
  | 'longevity' 
  | 'libido' 
  | 'metabolic_health'
  | 'muscle_growth'
  | 'skin_health'
  | 'immune_support';

export type PeptideRoute = 'subcutaneous' | 'intramuscular' | 'oral' | 'nasal' | 'topical';

export type PeptideForm = 'lyophilized_vial' | 'pre_mixed' | 'oral_capsule' | 'nasal_spray' | 'cream';

export interface PeptideContraindication {
  condition: string;
  severity: 'absolute' | 'relative';
  notes?: string;
}

export interface PeptideData {
  id: string;
  name: string;
  aliases: string[];
  mechanism: string;
  goals: PeptideGoal[];
  forms: PeptideForm[];
  routes: PeptideRoute[];
  storageNotes: string;
  contraindications: PeptideContraindication[];
  interactions: string[];
  sideEffects: string[];
  pregnancySafe: boolean;
  lactationSafe: boolean;
  wadaCaution: boolean;
  legalNote: string;
  clinicianOnly: boolean;
}

export interface DosingGuidance {
  id: string;
  peptideId: string;
  route: PeptideRoute;
  concentrationMg: number;
  unit: 'mcg' | 'mg' | 'IU';
  doseMin: number;
  doseMax: number;
  frequencyOptions: string[];
  durationWeeksMin: number;
  durationWeeksMax: number;
  notes: string;
  sourceReferences: string[];
  clinicianOnly: boolean;
  lastReviewed: string;
}

export interface PeptideEvidence {
  id: string;
  peptideId: string;
  claim: string;
  summary: string;
  strengthGrade: 'A' | 'B' | 'C' | 'D';
  studyType: 'RCT' | 'meta_analysis' | 'cohort' | 'case_study' | 'preclinical';
  population: string;
  pmid?: string;
  doi?: string;
  url?: string;
  lastReviewed: string;
}

export interface PeptideProtocolPhase {
  id: string;
  name: string;
  weekStart: number;
  weekEnd: number;
  dose: string;
  frequency: string;
  notes?: string;
}

export interface PeptideProtocolTemplate {
  id: string;
  peptideIds: string[];
  goals: PeptideGoal[];
  name: string;
  description: string;
  phases: PeptideProtocolPhase[];
  totalWeeks: number;
  monitoringChecklist: string[];
  labsToMonitor: string[];
  stopCriteria: string[];
  clinicianOnly: boolean;
}

export interface UserPeptidePlan {
  id: string;
  peptideId: string;
  protocolTemplateId?: string;
  startDate: string;
  currentPhase: number;
  customDose?: string;
  customFrequency?: string;
  notes: string;
  adherenceLogs: {
    date: string;
    completed: boolean;
    notes?: string;
  }[];
  acknowledged: boolean;
  acknowledgedAt?: string;
}

export interface PeptideRecommendation {
  peptide: PeptideData;
  matchScore: number;
  matchedGoals: PeptideGoal[];
  reasoning: string;
  hasContraindications: boolean;
  contraindicationNotes?: string;
}

// Clinical Decision Support Types

export interface ChiefComplaint {
  id: string;
  description: string;
  onset: 'acute' | 'chronic';
  duration: string;
  severity: number;
  betterWith: string[];
  worseWith: string[];
  previousDiagnoses: string[];
  previousTreatments: string[];
  timestamp: string;
}

export interface AssociatedSymptom {
  id: string;
  name: string;
  category: 'physical' | 'cognitive' | 'emotional' | 'digestive';
  timing: 'morning' | 'afternoon' | 'evening' | 'night' | 'post_meal' | 'cyclical' | 'constant';
  severity: number;
  notes?: string;
}

export interface ClinicalIntake {
  id: string;
  userId: string;
  chiefComplaint: ChiefComplaint;
  associatedSymptoms: AssociatedSymptom[];
  energyLevel: number;
  sleepQuality: number;
  digestiveFunction: number;
  stressPerception: number;
  temperatureSensitivity: 'hot' | 'cold' | 'both' | 'normal';
  painQuality?: 'sharp' | 'dull' | 'throbbing' | 'migrating' | 'fixed' | 'none';
  createdAt: string;
  updatedAt: string;
}

// TCM Pattern Types

export type TCMPattern = 
  | 'qi_deficiency'
  | 'qi_stagnation'
  | 'blood_deficiency'
  | 'blood_stasis'
  | 'yin_deficiency'
  | 'yang_deficiency'
  | 'dampness'
  | 'phlegm'
  | 'heat'
  | 'cold'
  | 'wind';

export type TCMOrganSystem = 'liver' | 'heart' | 'spleen' | 'lung' | 'kidney';

export interface TCMPatternAssessment {
  pattern: TCMPattern;
  score: number;
  relatedSymptoms: string[];
  modernInterpretation: string;
  affectedOrgans: TCMOrganSystem[];
  dietaryRecommendations: string[];
  lifestyleRecommendations: string[];
}

// Functional Medicine Pattern Types

export type FunctionalSystem = 
  | 'blood_sugar'
  | 'inflammation'
  | 'gut_function'
  | 'detoxification'
  | 'hormone_signaling'
  | 'mitochondrial'
  | 'nervous_system'
  | 'immune_activation';

export interface FunctionalPatternAssessment {
  system: FunctionalSystem;
  score: number;
  status: 'optimal' | 'suboptimal' | 'dysregulated';
  relatedSymptoms: string[];
  relatedBiomarkers: string[];
  rootCauseHypotheses: string[];
  interventionPriority: 'high' | 'medium' | 'low';
}

export interface ClinicalCorrelation {
  id: string;
  labFinding?: string;
  symptom: string;
  explanation: string;
  functionalSystem: FunctionalSystem;
  tcmPattern?: TCMPattern;
  confidence: 'high' | 'medium' | 'low';
}

export interface DifferentiatingQuestion {
  id: string;
  question: string;
  options?: string[];
  purpose: string;
  relatedPatterns: (TCMPattern | FunctionalSystem)[];
}

export interface ClinicalAnalysis {
  id: string;
  userId: string;
  intakeId: string;
  chiefComplaintSummary: string;
  functionalPatterns: FunctionalPatternAssessment[];
  tcmPatterns: TCMPatternAssessment[];
  correlations: ClinicalCorrelation[];
  differentiatingQuestions: DifferentiatingQuestion[];
  recommendations: string[];
  disclaimer: string;
  createdAt: string;
}

// ============================================================
// PEPTIDE INTELLIGENCE PLATFORM TYPES
// ============================================================

export type PeptideCategory =
  | 'gh_secretagogue'
  | 'healing'
  | 'immune'
  | 'cognitive'
  | 'sleep'
  | 'sexual_health'
  | 'weight_management'
  | 'longevity'
  | 'skin'
  | 'mitochondrial'
  | 'bioregulator'
  | 'antimicrobial'
  | 'hormone';

export type InteractionSeverity = 'info' | 'caution' | 'warning' | 'critical';

export type ProtocolStatus = 'draft' | 'active' | 'paused' | 'completed' | 'archived';

export type PhaseType = 'loading' | 'active' | 'maintenance' | 'taper' | 'off';

export type TaperType = 'none' | 'linear' | 'step';

export type DoseStatus = 'taken' | 'skipped' | 'partial';

export type InsightDirection = 'improved' | 'declined' | 'stable';

export type CorrelationConfidence = 'strong' | 'moderate' | 'weak';

export type LabType =
  | 'blood_panel'
  | 'dutch'
  | 'gi_map'
  | 'oat'
  | 'mycotoxin'
  | 'heavy_metal'
  | 'viral'
  | 'lyme'
  | 'sibo'
  | 'gut_zoomer';

// Peptide Library Entry (from DB)
export interface PeptideLibraryEntry {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  category: PeptideCategory;
  description: string;
  mechanism: string;
  typicalDoseMin: number;
  typicalDoseMax: number;
  doseUnit: 'mcg' | 'mg' | 'IU';
  halfLifeHours: number;
  routes: PeptideRoute[];
  forms: PeptideForm[];
  goals: PeptideGoal[];
  stackingNotes: string;
  storageNotes: string;
  researchReferences: { title: string; type: string; url?: string }[];
  legalNote: string;
  wadaCaution: boolean;
  clinicianOnly: boolean;
  pregnancySafe: boolean;
  lactationSafe: boolean;
}

// Protocol Types
export interface PeptideProtocol {
  id: string;
  userId: string;
  name: string;
  goal: string;
  status: ProtocolStatus;
  labSnapshotId?: string;
  wearableSnapshot?: Record<string, number>;
  aiReasoning?: string;
  suggestedRetestTimeline?: string;
  startDate?: string;
  endDate?: string;
  practitionerNotes?: string;
  practitionerApproved: boolean;
  approvedAt?: string;
  approvedBy?: string;
  peptides: ProtocolPeptide[];
  phases?: ProtocolPhase[];
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolPeptide {
  id: string;
  protocolId: string;
  peptideId: string;
  peptide?: PeptideLibraryEntry;
  doseAmount: number;
  doseUnit: 'mcg' | 'mg' | 'IU';
  frequency: string;
  timing?: string;
  durationWeeks?: number;
  aiRationale?: string;
  sortOrder: number;
}

export interface ProtocolPhase {
  id: string;
  protocolId: string;
  phaseName: string;
  phaseOrder: number;
  phaseType: PhaseType;
  startDate?: string;
  endDate?: string;
  durationDays?: number;
  description?: string;
}

export interface ProtocolScheduleEntry {
  id: string;
  protocolPeptideId: string;
  phaseId?: string;
  phaseName?: string;
  phaseOrder: number;
  doseAmount: number;
  doseUnit: string;
  frequency: string;
  durationDays: number;
  isActivePhase: boolean;
  taperType: TaperType;
  taperStepReduction?: number;
}

// Dose Logging
export interface PeptideDoseLog {
  id: string;
  userId: string;
  protocolId: string;
  protocolPeptideId: string;
  loggedAt: string;
  doseAmount: number;
  doseUnit: string;
  injectionSite?: string;
  status: DoseStatus;
  skipReason?: string;
  notes?: string;
}

export interface AdherenceStats {
  totalScheduled: number;
  totalTaken: number;
  totalSkipped: number;
  adherencePercent: number;
  currentStreak: number;
  longestStreak: number;
  byPeptide: {
    peptideId: string;
    peptideName: string;
    taken: number;
    skipped: number;
    percent: number;
  }[];
}

// Safety & Interactions
export interface PeptideInteraction {
  id: string;
  peptideASlug: string;
  peptideBSlug: string;
  interactionType: 'synergistic' | 'antagonistic' | 'caution' | 'contraindicated';
  severity: InteractionSeverity;
  description: string;
  recommendation?: string;
}

export interface PeptideContraindication {
  condition: string;
  severity: 'absolute' | 'relative';
  notes?: string;
}

export interface PeptideLabThreshold {
  id: string;
  peptideSlug: string;
  biomarkerName: string;
  thresholdValue: number;
  direction: 'above' | 'below';
  severity: InteractionSeverity;
  message: string;
  recommendation?: string;
}

export interface SafetyReport {
  interactions: PeptideInteraction[];
  contraindications: {
    peptideSlug: string;
    condition: string;
    severity: InteractionSeverity;
    description: string;
    recommendation?: string;
  }[];
  labThresholds: PeptideLabThreshold[];
  overallSeverity: InteractionSeverity;
  safeToStart: boolean;
}

// Correlation & Insights
export interface CorrelationInsight {
  id: string;
  userId: string;
  protocolId: string;
  insightType: 'biomarker' | 'wearable' | 'composite';
  metricName: string;
  baselineValue?: number;
  currentValue?: number;
  changePercent?: number;
  direction: InsightDirection;
  confidence: CorrelationConfidence;
  aiExplanation?: string;
  generatedAt: string;
}

// Wearable Snapshots
export interface WearableSnapshot {
  id: string;
  userId: string;
  protocolId: string;
  snapshotType: 'baseline' | 'current' | 'final';
  hrvAvg?: number;
  restingHrAvg?: number;
  deepSleepPct?: number;
  remSleepPct?: number;
  totalSleepMin?: number;
  spo2Avg?: number;
  bodyTempAvg?: number;
  stepsAvg?: number;
  recoveryScoreAvg?: number;
  measurementPeriodDays: number;
  capturedAt: string;
}

export interface WearableEffectiveness {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  deltaPercent: number;
  direction: InsightDirection;
}

// Lab Optimization Suggestions
export interface LabPeptideMapping {
  id: string;
  labType: LabType;
  findingPattern: string;
  findingDescription: string;
  recommendedPeptideSlugs: string[];
  recommendedPeptides?: PeptideLibraryEntry[];
  priorityLevel: number;
  reasoning: string;
  prerequisiteNote?: string;
}

// Protocol Builder AI Recommendation
export interface ProtocolRecommendation {
  goal: string;
  peptides: {
    slug: string;
    name: string;
    doseAmount: number;
    doseUnit: 'mcg' | 'mg' | 'IU';
    frequency: string;
    timing: string;
    durationWeeks: number;
    rationale: string;
  }[];
  reasoning: string;
  warnings: {
    severity: InteractionSeverity;
    message: string;
  }[];
  suggestedRetestTimeline: string;
  labSnapshot?: Record<string, number>;
  wearableSnapshot?: Record<string, number>;
}

// Protocol Effectiveness Score
export interface ProtocolEffectivenessScore {
  score: number;
  maxScore: number;
  breakdown: {
    category: string;
    score: number;
    weight: number;
    metrics: WearableEffectiveness[];
  }[];
}

// Practitioner Protocol Summary
export interface PractitionerProtocolSummary {
  protocol: PeptideProtocol;
  adherence: AdherenceStats;
  correlations: CorrelationInsight[];
  wearableEffectiveness: WearableEffectiveness[];
  safetyAlerts: SafetyReport;
  effectivenessScore?: ProtocolEffectivenessScore;
}

// ============================================================
// LONGEVITY PROTOCOL MODULE TYPES
// ============================================================

export type MenstrualStatus = 'pre_menopause' | 'peri_menopause' | 'post_menopause' | 'na';
export type FitnessLevel = 'sedentary' | 'recreational' | 'athletic' | 'elite';
export type DietType = 'carnivore' | 'paleo' | 'keto' | 'mediterranean' | 'vegan' | 'standard' | 'other';
export type LongevityProtocolStatus = 'draft' | 'pending_review' | 'approved' | 'active' | 'completed' | 'archived';

// The 12 Hallmarks of Aging
export type HallmarkId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface HallmarkInfo {
  id: HallmarkId;
  name: string;
  description: string;
  interventions: string[];
}

export interface LongevityIntake {
  id: string;
  userId: string;
  biologicalAge?: number;
  chronologicalAge?: number;
  weightCurrent?: number;
  weightIdeal?: number;
  height?: number;
  sex?: 'female' | 'male' | 'other';
  menstrualStatus?: MenstrualStatus;
  bodyComposition?: Record<string, number>;
  fitnessLevel?: FitnessLevel;
  dietType?: DietType;
  conditions: string[];
  sensitivities: string[];
  oppositions: string[];
  longevityGoals: string[];
  preferredBrands: string[];
  modalities: string[];
  topComplaints: string[];
  lifestyleFactors: string[];
  labs?: {
    nutrEval?: Record<string, any>;
    genetics3x4?: Record<string, any>;
    truAge?: Record<string, any>;
    dutch?: Record<string, any>;
    giMap?: Record<string, any>;
    vibrant?: Record<string, any>;
  };
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolSupplement {
  name: string;
  brand?: string;
  dose: string;
  timing: string;
  duration: string;
  purpose: string;
  hallmark: HallmarkId;
}

export interface ProtocolPeptideRx {
  name: string;
  dose: string;
  route: 'subcutaneous' | 'intramuscular' | 'oral' | 'nasal' | 'topical';
  cycle: string;
  purpose: string;
  hallmark: HallmarkId;
}

export interface ProtocolDiet {
  type: DietType;
  macros?: { protein?: string; carbs?: string; fat?: string };
  notes: string;
}

export interface ProtocolFasting {
  protocol: string;
  frequency: string;
  cycleSyncNotes?: string;
}

export interface ProtocolExercise {
  strength: string;
  cardio: string;
  hiit: string;
  frequency: string;
  intensity: string;
}

export interface ProtocolModality {
  modality: string;
  frequency: string;
  duration: string;
  purpose: string;
}

export interface ProtocolMonth {
  month: 1 | 2 | 3 | 4 | 5 | 6;
  theme: string;
  hallmarksTargeted: HallmarkId[];
  supplements: ProtocolSupplement[];
  peptides: ProtocolPeptideRx[];
  diet: ProtocolDiet;
  fasting: ProtocolFasting;
  exercise: ProtocolExercise;
  modalities: ProtocolModality[];
  lifestyle: string[];
  labsToOrder: string[];
  checkInNotes: string;
}

export interface ProtocolSummary {
  targetBiologicalAgeReduction: number;
  hallmarksAddressed: HallmarkId[];
  primaryRootCauses: string[];
  expectedOutcomes: string[];
  contraindicationsFlagged: string[];
}

export interface PulsingCalendarEntry {
  item: string;
  category: 'supplement' | 'peptide' | 'fasting' | 'exercise' | 'modality';
  schedule: string;
  days: number[]; // 0-179 days active
  color: 'green' | 'amber' | 'red' | 'blue' | 'purple';
}

export interface LongevityProtocol {
  id: string;
  intakeId: string;
  userId: string;
  version: number;
  generatedAt: string;
  months: ProtocolMonth[];
  summary: ProtocolSummary;
  pulsingCalendar: PulsingCalendarEntry[];
  safetyNotes: string[];
  practitionerReviewRequired: string[];
  status: LongevityProtocolStatus;
  practitionerNotes?: string;
  practitionerApproved: boolean;
  approvedAt?: string;
  approvedBy?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LongevityProgress {
  id: string;
  protocolId: string;
  userId: string;
  month: number;
  day?: number;
  itemKey: string;
  itemCategory?: 'supplement' | 'peptide' | 'fasting' | 'exercise' | 'modality' | 'lifestyle' | 'lab';
  taken: boolean;
  notes?: string;
  loggedAt: string;
}

export const HALLMARKS: HallmarkInfo[] = [
  { id: 1, name: 'Genomic Instability', description: 'DNA damage accumulates over time', interventions: ['DNA repair support', 'Antioxidants'] },
  { id: 2, name: 'Telomere Attrition', description: 'Telomere shortening drives cellular aging', interventions: ['Epitalon', 'Telomere Prime', 'Stress reduction'] },
  { id: 3, name: 'Epigenetic Alterations', description: 'Methylation patterns drift with age', interventions: ['NAD+ precursors', 'Sirtuin activators', 'Methyl donors'] },
  { id: 4, name: 'Loss of Proteostasis', description: 'Protein quality control fails', interventions: ['Autophagy enhancers', 'Caloric restriction', 'Heat shock'] },
  { id: 5, name: 'Deregulated Nutrient Sensing', description: 'mTOR/AMPK/IGF-1 pathways dysregulate', interventions: ['Rapamycin', 'Fasting', 'mTOR cycling'] },
  { id: 6, name: 'Mitochondrial Dysfunction', description: 'Cellular energy production declines', interventions: ['SS-31', 'MOTS-c', 'CoQ10', 'Methylene blue', 'PQQ'] },
  { id: 7, name: 'Cellular Senescence', description: 'Zombie cells accumulate and inflame', interventions: ['Senolytics', 'Fisetin', 'Quercetin'] },
  { id: 8, name: 'Stem Cell Exhaustion', description: 'Tissue regeneration capacity declines', interventions: ['StemRegen', 'Fasting-mimicking diet', 'Peptides'] },
  { id: 9, name: 'Altered Intercellular Communication', description: 'Signaling between cells degrades', interventions: ['Anti-inflammatories', 'Omega-3s', 'Immune modulation'] },
  { id: 10, name: 'Microbiome Dysbiosis', description: 'Gut microbiome composition shifts', interventions: ['Probiotics', 'Prebiotics', 'Targeted gut repair'] },
  { id: 11, name: 'Chronic Inflammation', description: 'Inflammaging drives degeneration', interventions: ['Curcumin', 'Exercise', 'Dietary modification'] },
  { id: 12, name: 'Extracellular Matrix Stiffening', description: 'Tissue pliability decreases with age', interventions: ['Collagen support', 'GHK-Cu', 'Movement'] },
];
