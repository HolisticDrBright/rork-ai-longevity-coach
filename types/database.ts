export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
      };
      user_roles: {
        Row: UserRoleRow;
        Insert: UserRoleInsert;
        Update: UserRoleUpdate;
      };
      health_goals: {
        Row: HealthGoalRow;
        Insert: HealthGoalInsert;
        Update: HealthGoalUpdate;
      };
      wearable_connections: {
        Row: WearableConnectionRow;
        Insert: WearableConnectionInsert;
        Update: WearableConnectionUpdate;
      };
      raw_health_events: {
        Row: RawHealthEventRow;
        Insert: RawHealthEventInsert;
        Update: RawHealthEventUpdate;
      };
      daily_biometric_records: {
        Row: DailyBiometricRow;
        Insert: DailyBiometricInsert;
        Update: DailyBiometricUpdate;
      };
      meal_logs: {
        Row: MealLogRow;
        Insert: MealLogInsert;
        Update: MealLogUpdate;
      };
      daily_nutrition_rollups: {
        Row: DailyNutritionRollupRow;
        Insert: DailyNutritionRollupInsert;
        Update: DailyNutritionRollupUpdate;
      };
      supplement_logs: {
        Row: SupplementLogRow;
        Insert: SupplementLogInsert;
        Update: SupplementLogUpdate;
      };
      daily_supplement_rollups: {
        Row: DailySupplementRollupRow;
        Insert: DailySupplementRollupInsert;
        Update: DailySupplementRollupUpdate;
      };
      symptom_logs: {
        Row: SymptomLogRow;
        Insert: SymptomLogInsert;
        Update: SymptomLogUpdate;
      };
      daily_subjective_rollups: {
        Row: DailySubjectiveRollupRow;
        Insert: DailySubjectiveRollupInsert;
        Update: DailySubjectiveRollupUpdate;
      };
      lab_markers: {
        Row: LabMarkerRow;
        Insert: LabMarkerInsert;
        Update: LabMarkerUpdate;
      };
      daily_baselines: {
        Row: DailyBaselineRow;
        Insert: DailyBaselineInsert;
        Update: DailyBaselineUpdate;
      };
      daily_scores: {
        Row: DailyScoreRow;
        Insert: DailyScoreInsert;
        Update: DailyScoreUpdate;
      };
      detected_patterns: {
        Row: DetectedPatternRow;
        Insert: DetectedPatternInsert;
        Update: DetectedPatternUpdate;
      };
      correlations: {
        Row: CorrelationRow;
        Insert: CorrelationInsert;
        Update: CorrelationUpdate;
      };
      daily_recommendations: {
        Row: DailyRecommendationRow;
        Insert: DailyRecommendationInsert;
        Update: DailyRecommendationUpdate;
      };
      practitioner_flags: {
        Row: PractitionerFlagRow;
        Insert: PractitionerFlagInsert;
        Update: PractitionerFlagUpdate;
      };
      notification_queue: {
        Row: NotificationQueueRow;
        Insert: NotificationQueueInsert;
        Update: NotificationQueueUpdate;
      };
      app_settings: {
        Row: AppSettingsRow;
        Insert: AppSettingsInsert;
        Update: AppSettingsUpdate;
      };
      questionnaire_responses: {
        Row: QuestionnaireResponseRow;
        Insert: QuestionnaireResponseInsert;
        Update: QuestionnaireResponseUpdate;
      };
      clinical_intakes: {
        Row: ClinicalIntakeRow;
        Insert: ClinicalIntakeInsert;
        Update: ClinicalIntakeUpdate;
      };
      lifestyle_profiles: {
        Row: LifestyleProfileRow;
        Insert: LifestyleProfileInsert;
        Update: LifestyleProfileUpdate;
      };
      contraindications: {
        Row: ContraindicationRow;
        Insert: ContraindicationInsert;
        Update: ContraindicationUpdate;
      };
      protocols: {
        Row: ProtocolRow;
        Insert: ProtocolInsert;
        Update: ProtocolUpdate;
      };
      daily_adherence: {
        Row: DailyAdherenceRow;
        Insert: DailyAdherenceInsert;
        Update: DailyAdherenceUpdate;
      };
      hormone_entries: {
        Row: HormoneEntryRow;
        Insert: HormoneEntryInsert;
        Update: HormoneEntryUpdate;
      };
      lab_panels: {
        Row: LabPanelRow;
        Insert: LabPanelInsert;
        Update: LabPanelUpdate;
      };
    };
    Functions: Record<string, never>;
    Enums: {
      user_role: 'user' | 'practitioner' | 'admin';
      wearable_provider: 'apple_health' | 'google_health' | 'oura' | 'whoop' | 'fitbit' | 'garmin';
      connection_status: 'active' | 'inactive' | 'expired' | 'revoked';
      recovery_status: 'green' | 'yellow' | 'red';
      severity_level: 'low' | 'moderate' | 'high';
      confidence_level: 'low' | 'moderate' | 'high';
      notification_status: 'pending' | 'sent' | 'delivered' | 'failed';
      sex_type: 'male' | 'female' | 'other';
      diet_type: 'omnivore' | 'vegetarian' | 'vegan' | 'keto' | 'paleo' | 'mediterranean' | 'other';
      protocol_status: 'active' | 'paused' | 'completed' | 'archived';
    };
  };
}

export interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  sex: string | null;
  birth_date: string | null;
  timezone: string | null;
  avatar_url: string | null;
  height: number | null;
  weight: number | null;
  goals: string[] | null;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
}

export type ProfileInsert = Omit<ProfileRow, 'created_at' | 'updated_at'> & {
  created_at?: string;
  updated_at?: string;
};

export type ProfileUpdate = Partial<ProfileInsert>;

export interface UserRoleRow {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
}

export type UserRoleInsert = Omit<UserRoleRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type UserRoleUpdate = Partial<UserRoleInsert>;

export interface HealthGoalRow {
  id: string;
  user_id: string;
  primary_goal: string | null;
  secondary_goals_json: Record<string, unknown> | null;
  target_weight: number | null;
  target_body_fat: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type HealthGoalInsert = Omit<HealthGoalRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type HealthGoalUpdate = Partial<HealthGoalInsert>;

export interface WearableConnectionRow {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  scopes_json: Record<string, unknown> | null;
  status: string;
  last_sync_at: string | null;
  last_successful_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export type WearableConnectionInsert = Omit<WearableConnectionRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type WearableConnectionUpdate = Partial<WearableConnectionInsert>;

export interface RawHealthEventRow {
  id: string;
  user_id: string;
  provider: string;
  provider_record_id: string | null;
  record_type: string;
  payload_json: Record<string, unknown>;
  recorded_at: string;
  imported_at: string;
}

export type RawHealthEventInsert = Omit<RawHealthEventRow, 'id' | 'imported_at'> & {
  id?: string;
  imported_at?: string;
};

export type RawHealthEventUpdate = Partial<RawHealthEventInsert>;

export interface DailyBiometricRow {
  id: string;
  user_id: string;
  date: string;
  primary_source: string | null;
  sleep_duration_minutes: number | null;
  time_in_bed_minutes: number | null;
  sleep_efficiency: number | null;
  sleep_latency_minutes: number | null;
  wake_after_sleep_onset_minutes: number | null;
  awakenings: number | null;
  rem_sleep_minutes: number | null;
  deep_sleep_minutes: number | null;
  light_sleep_minutes: number | null;
  sleep_score: number | null;
  bedtime: string | null;
  wake_time: string | null;
  bedtime_variability_minutes: number | null;
  hrv: number | null;
  resting_hr: number | null;
  avg_hr: number | null;
  respiratory_rate: number | null;
  temp_deviation: number | null;
  readiness_score_vendor: number | null;
  stress_score_vendor: number | null;
  steps: number | null;
  distance_meters: number | null;
  calories_burned: number | null;
  active_minutes: number | null;
  sedentary_minutes: number | null;
  workout_minutes: number | null;
  training_load: number | null;
  strain_score: number | null;
  vo2max: number | null;
  weight_kg: number | null;
  body_fat_percent: number | null;
  spo2: number | null;
  glucose_avg: number | null;
  systolic_bp: number | null;
  diastolic_bp: number | null;
  hydration_ml: number | null;
  alcohol_units: number | null;
  caffeine_mg: number | null;
  cycle_phase: string | null;
  energy_score_subjective: number | null;
  stress_score_subjective: number | null;
  soreness_score_subjective: number | null;
  mood_score_subjective: number | null;
  cravings_score_subjective: number | null;
  libido_score_subjective: number | null;
  bowel_score_subjective: number | null;
  adherence_score_raw: number | null;
  symptom_flags_json: Record<string, unknown> | null;
  data_quality_score: number | null;
  created_at: string;
  updated_at: string;
}

export type DailyBiometricInsert = Omit<DailyBiometricRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type DailyBiometricUpdate = Partial<DailyBiometricInsert>;

export interface MealLogRow {
  id: string;
  user_id: string;
  meal_time: string;
  meal_type: string;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  glycemic_load_estimate: number | null;
  inflammatory_load_estimate: number | null;
  food_quality_score: number | null;
  tags_json: string[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type MealLogInsert = Omit<MealLogRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type MealLogUpdate = Partial<MealLogInsert>;

export interface DailyNutritionRollupRow {
  id: string;
  user_id: string;
  date: string;
  total_calories: number | null;
  total_protein_g: number | null;
  total_carbs_g: number | null;
  total_fat_g: number | null;
  total_fiber_g: number | null;
  meal_count: number | null;
  first_meal_time: string | null;
  last_meal_time: string | null;
  eating_window_minutes: number | null;
  protein_distribution_score: number | null;
  meal_timing_score: number | null;
  inflammatory_load_total: number | null;
  glycemic_load_total: number | null;
  alcohol_units: number | null;
  caffeine_mg: number | null;
  hydration_ml: number | null;
  created_at: string;
  updated_at: string;
}

export type DailyNutritionRollupInsert = Omit<DailyNutritionRollupRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type DailyNutritionRollupUpdate = Partial<DailyNutritionRollupInsert>;

export interface SupplementLogRow {
  id: string;
  user_id: string;
  supplement_name: string;
  category: string | null;
  dose: string | null;
  unit: string | null;
  timing: string | null;
  logged_at: string;
  associated_goal: string | null;
  adherence_event: boolean | null;
  created_at: string;
  updated_at: string;
}

export type SupplementLogInsert = Omit<SupplementLogRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type SupplementLogUpdate = Partial<SupplementLogInsert>;

export interface DailySupplementRollupRow {
  id: string;
  user_id: string;
  date: string;
  supplements_taken_count: number | null;
  expected_supplements_count: number | null;
  supplement_adherence_percent: number | null;
  core_stack_adherence_percent: number | null;
  sleep_support_taken: boolean | null;
  metabolic_support_taken: boolean | null;
  recovery_support_taken: boolean | null;
  mitochondrial_support_taken: boolean | null;
  created_at: string;
  updated_at: string;
}

export type DailySupplementRollupInsert = Omit<DailySupplementRollupRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type DailySupplementRollupUpdate = Partial<DailySupplementRollupInsert>;

export interface SymptomLogRow {
  id: string;
  user_id: string;
  symptom_name: string;
  severity: number | null;
  logged_at: string;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type SymptomLogInsert = Omit<SymptomLogRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type SymptomLogUpdate = Partial<SymptomLogInsert>;

export interface DailySubjectiveRollupRow {
  id: string;
  user_id: string;
  date: string;
  energy_avg: number | null;
  stress_avg: number | null;
  soreness_avg: number | null;
  mood_avg: number | null;
  cravings_avg: number | null;
  libido_avg: number | null;
  bowel_avg: number | null;
  checkin_completion_score: number | null;
  created_at: string;
  updated_at: string;
}

export type DailySubjectiveRollupInsert = Omit<DailySubjectiveRollupRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type DailySubjectiveRollupUpdate = Partial<DailySubjectiveRollupInsert>;

export interface LabMarkerRow {
  id: string;
  user_id: string;
  marker_name: string;
  marker_value: number;
  unit: string;
  reference_range_low: number | null;
  reference_range_high: number | null;
  optimal_range_low: number | null;
  optimal_range_high: number | null;
  collected_at: string;
  source: string | null;
  created_at: string;
}

export type LabMarkerInsert = Omit<LabMarkerRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type LabMarkerUpdate = Partial<LabMarkerInsert>;

export interface DailyBaselineRow {
  id: string;
  user_id: string;
  date: string;
  baseline_window_days: number;
  sleep_duration_baseline: number | null;
  sleep_efficiency_baseline: number | null;
  sleep_score_baseline: number | null;
  hrv_baseline: number | null;
  resting_hr_baseline: number | null;
  respiratory_rate_baseline: number | null;
  temp_deviation_baseline: number | null;
  steps_baseline: number | null;
  active_minutes_baseline: number | null;
  readiness_baseline: number | null;
  energy_baseline: number | null;
  stress_baseline: number | null;
  soreness_baseline: number | null;
  bedtime_baseline: string | null;
  hydration_baseline: number | null;
  created_at: string;
}

export type DailyBaselineInsert = Omit<DailyBaselineRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type DailyBaselineUpdate = Partial<DailyBaselineInsert>;

export interface DailyScoreRow {
  id: string;
  user_id: string;
  date: string;
  recovery_score: number | null;
  recovery_status: string | null;
  sleep_score_computed: number | null;
  stress_load_score: number | null;
  metabolic_resilience_score: number | null;
  adherence_score: number | null;
  nervous_system_balance_score: number | null;
  inflammation_strain_score: number | null;
  confidence_score: number | null;
  scoring_inputs_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type DailyScoreInsert = Omit<DailyScoreRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type DailyScoreUpdate = Partial<DailyScoreInsert>;

export interface DetectedPatternRow {
  id: string;
  user_id: string;
  date: string;
  pattern_type: string;
  severity: string;
  confidence: string;
  title: string;
  summary: string | null;
  evidence_json: Record<string, unknown> | null;
  created_at: string;
}

export type DetectedPatternInsert = Omit<DetectedPatternRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type DetectedPatternUpdate = Partial<DetectedPatternInsert>;

export interface CorrelationRow {
  id: string;
  user_id: string;
  computed_at: string;
  variable_a: string;
  variable_b: string;
  time_window_days: number;
  direction: string;
  strength: string;
  confidence: string;
  sample_size: number;
  summary: string | null;
  evidence_json: Record<string, unknown> | null;
}

export type CorrelationInsert = Omit<CorrelationRow, 'id'> & {
  id?: string;
};

export type CorrelationUpdate = Partial<CorrelationInsert>;

export interface DailyRecommendationRow {
  id: string;
  user_id: string;
  date: string;
  recovery_status: string | null;
  training_guidance: string | null;
  nutrition_guidance: string | null;
  supplement_guidance: string | null;
  sleep_guidance: string | null;
  stress_guidance: string | null;
  escalation_flag: string | null;
  top_actions_json: Record<string, unknown>[] | null;
  explanation_short: string | null;
  explanation_long: string | null;
  recommendation_payload_json: Record<string, unknown> | null;
  ai_summary_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type DailyRecommendationInsert = Omit<DailyRecommendationRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type DailyRecommendationUpdate = Partial<DailyRecommendationInsert>;

export interface PractitionerFlagRow {
  id: string;
  user_id: string;
  date: string;
  flag_type: string;
  severity: string;
  summary: string | null;
  evidence_json: Record<string, unknown> | null;
  resolved: boolean;
  created_at: string;
  updated_at: string;
}

export type PractitionerFlagInsert = Omit<PractitionerFlagRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type PractitionerFlagUpdate = Partial<PractitionerFlagInsert>;

export interface NotificationQueueRow {
  id: string;
  user_id: string;
  date: string;
  notification_type: string;
  payload_json: Record<string, unknown> | null;
  send_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export type NotificationQueueInsert = Omit<NotificationQueueRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type NotificationQueueUpdate = Partial<NotificationQueueInsert>;

export interface AppSettingsRow {
  id: string;
  user_id: string;
  settings_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type AppSettingsInsert = Omit<AppSettingsRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type AppSettingsUpdate = Partial<AppSettingsInsert>;

export interface QuestionnaireResponseRow {
  id: string;
  user_id: string;
  question_id: string;
  category_id: string;
  severity: number;
  timestamp: string;
  created_at: string;
}

export type QuestionnaireResponseInsert = Omit<QuestionnaireResponseRow, 'id' | 'created_at'> & {
  id?: string;
  created_at?: string;
};

export type QuestionnaireResponseUpdate = Partial<QuestionnaireResponseInsert>;

export interface ClinicalIntakeRow {
  id: string;
  user_id: string;
  chief_complaint_json: Record<string, unknown>;
  associated_symptoms_json: Record<string, unknown>[];
  energy_level: number | null;
  sleep_quality: number | null;
  digestive_function: number | null;
  stress_perception: number | null;
  temperature_sensitivity: string | null;
  pain_quality: string | null;
  created_at: string;
  updated_at: string;
}

export type ClinicalIntakeInsert = Omit<ClinicalIntakeRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type ClinicalIntakeUpdate = Partial<ClinicalIntakeInsert>;

export interface LifestyleProfileRow {
  id: string;
  user_id: string;
  sleep_hours: number | null;
  sleep_quality: number | null;
  stress_level: number | null;
  diet_type: string | null;
  cooking_skill: string | null;
  shopping_cadence: string | null;
  exercise_frequency: number | null;
  exercise_types: string[] | null;
  created_at: string;
  updated_at: string;
}

export type LifestyleProfileInsert = Omit<LifestyleProfileRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type LifestyleProfileUpdate = Partial<LifestyleProfileInsert>;

export interface ContraindicationRow {
  id: string;
  user_id: string;
  pregnant: boolean;
  nursing: boolean;
  medications: string[];
  allergies: string[];
  conditions: string[];
  created_at: string;
  updated_at: string;
}

export type ContraindicationInsert = Omit<ContraindicationRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type ContraindicationUpdate = Partial<ContraindicationInsert>;

export interface ProtocolRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  status: string;
  version: number;
  supplements_json: Record<string, unknown>[];
  peptides_json: Record<string, unknown>[];
  fasting_plan_json: Record<string, unknown> | null;
  lifestyle_tasks_json: Record<string, unknown>[];
  created_at: string;
  updated_at: string;
}

export type ProtocolInsert = Omit<ProtocolRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type ProtocolUpdate = Partial<ProtocolInsert>;

export interface DailyAdherenceRow {
  id: string;
  user_id: string;
  date: string;
  protocol_id: string;
  completed_supplements: string[];
  completed_peptides: string[];
  completed_tasks: string[];
  fasting_completed: boolean;
  notes: string | null;
  symptoms_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type DailyAdherenceInsert = Omit<DailyAdherenceRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type DailyAdherenceUpdate = Partial<DailyAdherenceInsert>;

export interface HormoneEntryRow {
  id: string;
  user_id: string;
  date: string;
  cycle_day: number | null;
  symptoms_json: Record<string, unknown>[];
  notes: string | null;
  current_supplements_json: Record<string, unknown>[] | null;
  created_at: string;
  updated_at: string;
}

export type HormoneEntryInsert = Omit<HormoneEntryRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type HormoneEntryUpdate = Partial<HormoneEntryInsert>;

export interface LabPanelRow {
  id: string;
  user_id: string;
  name: string;
  date: string;
  source: string | null;
  file_url: string | null;
  biomarkers_json: Record<string, unknown>[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type LabPanelInsert = Omit<LabPanelRow, 'id' | 'created_at' | 'updated_at'> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type LabPanelUpdate = Partial<LabPanelInsert>;
