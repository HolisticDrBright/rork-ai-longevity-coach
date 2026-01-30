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
