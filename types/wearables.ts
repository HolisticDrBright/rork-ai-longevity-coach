export type WearableSource = 'apple_health' | 'google_health' | 'oura' | 'whoop' | 'fitbit' | 'garmin' | 'manual';

export type RecoveryStatus = 'green' | 'yellow' | 'red';

export type ConfidenceLevel = 'low' | 'moderate' | 'high';

export type CyclePhase = 'menstrual' | 'follicular' | 'ovulatory' | 'luteal' | 'unknown';

export type TrainingGuidance =
  | 'intense_lift'
  | 'strength_reduced_volume'
  | 'zone_2_only'
  | 'mobility_recovery'
  | 'full_recovery_day';

export type TrendDirection = 'improving' | 'stable' | 'declining' | 'insufficient_data';

export interface DailyBiometricRecord {
  id: string;
  userId: string;
  source: WearableSource;
  date: string;
  sleepDurationMinutes: number | null;
  sleepEfficiency: number | null;
  deepSleepMinutes: number | null;
  remSleepMinutes: number | null;
  lightSleepMinutes: number | null;
  sleepLatencyMinutes: number | null;
  wakeAfterSleepOnset: number | null;
  awakenings: number | null;
  sleepScore: number | null;
  bedtime: string | null;
  wakeTime: string | null;
  hrv: number | null;
  restingHr: number | null;
  avgHr: number | null;
  nighttimeHr: number | null;
  respiratoryRate: number | null;
  tempDeviation: number | null;
  skinTemp: number | null;
  readinessScore: number | null;
  stressScoreDevice: number | null;
  steps: number | null;
  distanceKm: number | null;
  caloriesBurned: number | null;
  activeMinutes: number | null;
  sedentaryMinutes: number | null;
  vo2Max: number | null;
  workoutMinutes: number | null;
  workoutType: string | null;
  trainingLoad: number | null;
  strainScore: number | null;
  weight: number | null;
  bodyFatPercent: number | null;
  spo2: number | null;
  glucoseAvg: number | null;
  bloodPressureSystolic: number | null;
  bloodPressureDiastolic: number | null;
  cyclePhase: CyclePhase | null;
  cycleDayEstimate: number | null;
  hydrationMl: number | null;
  alcoholUnits: number | null;
  caffeineMg: number | null;
  caffeineLastTime: string | null;
  energyScore: number | null;
  stressScoreSubjective: number | null;
  sorenessScore: number | null;
  moodScore: number | null;
  libidoScore: number | null;
  bowelScore: number | null;
  cravingsScore: number | null;
  adherenceScore: number | null;
  subjectiveReadiness: number | null;
  symptomFlags: string[];
  dataQualityScore: number;
}

export interface MealLogEntry {
  id: string;
  userId: string;
  date: string;
  mealTime: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  calories: number;
  foodQualityScore: number;
  tags: string[];
  glycemicLoadEstimate: 'low' | 'medium' | 'high';
  inflammatoryLoadEstimate: 'low' | 'medium' | 'high';
}

export interface SupplementLogEntry {
  id: string;
  userId: string;
  date: string;
  supplementName: string;
  category: string;
  dose: string;
  timing: 'morning' | 'afternoon' | 'evening' | 'before_bed';
  adherence: boolean;
  associatedGoal: string;
}

export interface SymptomLogEntry {
  id: string;
  userId: string;
  date: string;
  symptom: string;
  severity: number;
  onset: string;
  notes: string;
}

export interface UserBaseline {
  userId: string;
  updatedAt: string;
  hrv7Day: number | null;
  hrv14Day: number | null;
  hrv30Day: number | null;
  restingHr7Day: number | null;
  restingHr14Day: number | null;
  restingHr30Day: number | null;
  sleepDuration7Day: number | null;
  sleepDuration14Day: number | null;
  sleepDuration30Day: number | null;
  sleepEfficiency7Day: number | null;
  sleepEfficiency14Day: number | null;
  sleepEfficiency30Day: number | null;
  steps7Day: number | null;
  steps14Day: number | null;
  steps30Day: number | null;
  respiratoryRate7Day: number | null;
  respiratoryRate14Day: number | null;
  tempDeviation7Day: number | null;
  tempDeviation14Day: number | null;
  bedtimeAvg: string | null;
  wakeTimeAvg: string | null;
  weight7Day: number | null;
  weight30Day: number | null;
}

export interface ScoreResult {
  score: number;
  status: RecoveryStatus;
  label: string;
  breakdown: ScoreBreakdownItem[];
}

export interface ScoreBreakdownItem {
  factor: string;
  weight: number;
  rawValue: number | null;
  normalizedScore: number;
  impact: 'positive' | 'neutral' | 'negative';
}

export interface CorrelationResult {
  id: string;
  factorA: string;
  factorB: string;
  direction: 'positive' | 'negative';
  strength: number;
  confidence: ConfidenceLevel;
  dataPoints: number;
  insight: string;
  actionable: boolean;
}

export interface PatternDetection {
  id: string;
  type: 'low_recovery' | 'overreaching' | 'sleep_disruption' | 'metabolic_stress' | 'cycle_aware' | 'positive_reinforcement' | 'circadian_drift' | 'chronic_inflammation';
  severity: 'mild' | 'moderate' | 'severe';
  confidence: ConfidenceLevel;
  description: string;
  factors: string[];
  daysPersisting: number;
  escalationNeeded: boolean;
}

export interface DailyRecommendation {
  date: string;
  recoveryStatus: RecoveryStatus;
  recoveryScore: number;
  oneSentenceSummary: string;
  topActions: ActionItem[];
  trainingGuidance: TrainingGuidanceOutput;
  nutritionGuidance: NutritionGuidanceOutput;
  supplementGuidance: SupplementGuidanceOutput;
  sleepGuidance: SleepGuidanceOutput;
  stressGuidance: StressGuidanceOutput;
  escalationFlags: EscalationFlag[];
  patterns: PatternDetection[];
  correlations: CorrelationResult[];
  scores: AllScores;
}

export interface ActionItem {
  id: string;
  priority: number;
  action: string;
  reason: string;
  category: 'training' | 'nutrition' | 'sleep' | 'stress' | 'supplement' | 'recovery';
  icon: string;
}

export interface TrainingGuidanceOutput {
  recommendation: TrainingGuidance;
  label: string;
  explanation: string;
  suggestedWorkout: string;
  intensityLevel: number;
}

export interface NutritionGuidanceOutput {
  suggestions: string[];
  mealTimingAdvice: string;
  hydrationTargetMl: number;
  proteinTargetG: number;
  notes: string;
}

export interface SupplementGuidanceOutput {
  priorities: SupplementPriority[];
  notes: string;
}

export interface SupplementPriority {
  name: string;
  timing: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export interface SleepGuidanceOutput {
  targetBedtime: string;
  mealCutoff: string;
  caffeineCutoff: string;
  windDownSuggestions: string[];
  notes: string;
}

export interface StressGuidanceOutput {
  suggestions: string[];
  avoidItems: string[];
  notes: string;
}

export interface EscalationFlag {
  id: string;
  severity: 'warning' | 'alert';
  message: string;
  daysPersisting: number;
  recommendation: string;
}

export interface AllScores {
  recovery: ScoreResult;
  sleep: ScoreResult;
  stressLoad: ScoreResult;
  metabolicResilience: ScoreResult;
  adherence: ScoreResult;
  nervousSystemBalance: ScoreResult;
  inflammationStrain: ScoreResult;
}

export interface TrendDataPoint {
  date: string;
  value: number | null;
}

export interface TrendSeries {
  label: string;
  color: string;
  data: TrendDataPoint[];
  direction: TrendDirection;
  changePercent: number;
}

export interface WearableConnection {
  id: string;
  source: WearableSource;
  connected: boolean;
  lastSync: string | null;
  permissions: string[];
}

export interface InsightMessage {
  id: string;
  date: string;
  type: 'observation' | 'correlation' | 'positive' | 'warning' | 'escalation';
  title: string;
  body: string;
  confidence: ConfidenceLevel;
  relatedFactors: string[];
  actionSuggestion: string | null;
  priority: number;
}

export interface WearablesState {
  connections: WearableConnection[];
  todayRecord: DailyBiometricRecord | null;
  historicalRecords: DailyBiometricRecord[];
  baseline: UserBaseline | null;
  todayRecommendation: DailyRecommendation | null;
  insights: InsightMessage[];
  mealLogs: MealLogEntry[];
  supplementLogs: SupplementLogEntry[];
  symptomLogs: SymptomLogEntry[];
  isLoading: boolean;
  lastUpdated: string | null;
}
