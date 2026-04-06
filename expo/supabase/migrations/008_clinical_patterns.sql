-- ============================================================
-- AI Longevity Pro - Clinical Pattern Detection & Smart Alerts
-- Run AFTER 007_longevity_scores.sql
-- ============================================================

-- Clinical Pattern Detection Rules (seed data)
CREATE TABLE IF NOT EXISTS public.clinical_pattern_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id text UNIQUE NOT NULL,
  pattern_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('sleep', 'cardiovascular', 'metabolic', 'thyroid_hormonal', 'stress_adrenal', 'inflammation', 'nutrient_deficiency', 'recovery', 'gut_health')),
  data_sources text[] NOT NULL,
  detection_logic jsonb NOT NULL,
  confidence_thresholds jsonb NOT NULL,
  severity text NOT NULL CHECK (severity IN ('informational', 'attention', 'urgent')),
  recommended_action text NOT NULL,
  recommended_tests text[],
  medical_disclaimer text NOT NULL DEFAULT 'This is not a medical diagnosis. Please consult a qualified healthcare professional for proper evaluation.',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Detected patterns (instances of rules firing for users)
CREATE TABLE IF NOT EXISTS public.detected_clinical_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern_id text NOT NULL REFERENCES public.clinical_pattern_rules(pattern_id),
  confidence text NOT NULL CHECK (confidence IN ('low', 'moderate', 'high')),
  severity text NOT NULL CHECK (severity IN ('informational', 'attention', 'urgent')),
  evidence jsonb NOT NULL DEFAULT '{}',
  triggered_values jsonb NOT NULL DEFAULT '{}',
  status text DEFAULT 'new' CHECK (status IN ('new', 'viewed', 'acknowledged', 'shared_with_doctor', 'resolved', 'dismissed')),
  user_notes text,
  practitioner_notes text,
  detected_at timestamptz DEFAULT now(),
  viewed_at timestamptz,
  resolved_at timestamptz
);

ALTER TABLE public.clinical_pattern_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.detected_clinical_patterns ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read pattern rules
CREATE POLICY "Authenticated read pattern rules"
  ON public.clinical_pattern_rules FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Admin can manage pattern rules
CREATE POLICY "Admin manage pattern rules"
  ON public.clinical_pattern_rules FOR ALL
  USING (public.is_admin());

-- Users see own detected patterns
CREATE POLICY "Users read own patterns"
  ON public.detected_clinical_patterns FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own patterns"
  ON public.detected_clinical_patterns FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own patterns"
  ON public.detected_clinical_patterns FOR UPDATE
  USING (user_id = auth.uid());

-- Practitioners see patient patterns
CREATE POLICY "Practitioners read patient patterns"
  ON public.detected_clinical_patterns FOR SELECT
  USING (public.is_practitioner());

CREATE INDEX idx_detected_patterns_user ON public.detected_clinical_patterns(user_id);
CREATE INDEX idx_detected_patterns_status ON public.detected_clinical_patterns(user_id, status);
CREATE INDEX idx_detected_patterns_severity ON public.detected_clinical_patterns(severity, detected_at);

-- Seed the 12 pattern rules
INSERT INTO public.clinical_pattern_rules (pattern_id, pattern_name, category, data_sources, detection_logic, confidence_thresholds, severity, recommended_action, recommended_tests) VALUES
('possible_sleep_apnea', 'Possible Sleep Apnea', 'sleep',
  ARRAY['spo2', 'breathing_regularity', 'sleep_stages', 'resting_hr'],
  '{"rules": [{"metric": "spo2_avg_nightly", "operator": "<", "value": 94, "window_days": 14, "min_occurrences": 5}, {"metric": "spo2_dips_below_90", "operator": ">", "value": 3, "per": "night", "min_nights": 5}, {"metric": "deep_sleep_pct", "operator": "<", "value": 10, "window_days": 7}, {"metric": "resting_hr_sleep", "operator": ">", "value_type": "baseline_plus", "value": 10, "window_days": 7}]}'::jsonb,
  '{"high": {"criteria_met": 4}, "moderate": {"criteria_met": 3}, "low": {"criteria_met": 2}}'::jsonb,
  'attention',
  'Your sleep data shows patterns consistent with sleep-disordered breathing. We recommend discussing these findings with your doctor. A formal sleep study (polysomnography) can confirm or rule out sleep apnea.',
  ARRAY['polysomnography', 'home_sleep_test']),

('possible_afib', 'Possible Atrial Fibrillation Risk', 'cardiovascular',
  ARRAY['resting_hr', 'hrv', 'heart_rate_pattern'],
  '{"rules": [{"metric": "hr_irregularity", "operator": ">", "value_type": "baseline_sd_multiplier", "value": 2}, {"metric": "resting_hr_spikes", "operator": ">", "value": 100, "context": "rest_or_sleep", "min_occurrences": 3, "window_days": 7}, {"metric": "hrv_erratic", "operator": "true", "window_days": 7}]}'::jsonb,
  '{"high": {"criteria_met": 3}, "moderate": {"criteria_met": 2}}'::jsonb,
  'urgent',
  'Your heart rate data shows irregular patterns that may indicate an arrhythmia. Please consult a cardiologist. Consider requesting an ECG or Holter monitor.',
  ARRAY['ecg', 'holter_monitor', 'echocardiogram']),

('hypertension', 'Possible Hypertension', 'cardiovascular',
  ARRAY['blood_pressure'],
  '{"rules": [{"metric": "bp_systolic", "operator": ">", "value": 130, "min_readings": 3, "window_days": 7}, {"metric": "bp_diastolic", "operator": ">", "value": 80, "min_readings": 3, "window_days": 7}, {"metric": "bp_normal_readings", "operator": "==", "value": 0, "window_days": 7}]}'::jsonb,
  '{"high": {"criteria_met": 3}, "moderate": {"criteria_met": 2}}'::jsonb,
  'attention',
  'Your blood pressure readings consistently exceed recommended thresholds (>130/80). This pattern suggests hypertension. Discuss with your healthcare provider.',
  ARRAY['24hr_ambulatory_bp', 'renal_panel', 'ecg']),

('insulin_resistance', 'Possible Insulin Resistance / Pre-Diabetes', 'metabolic',
  ARRAY['blood_glucose', 'fasting_glucose', 'hba1c', 'weight', 'body_fat'],
  '{"rules": [{"metric": "fasting_glucose", "operator": ">", "value": 100, "min_readings": 5, "window_days": 14}, {"metric": "glucose_post_meal_spike", "operator": ">", "value": 180, "min_occurrences": 5, "window_days": 14}, {"metric": "time_in_range_pct", "operator": "<", "value": 70}, {"metric": "hba1c", "operator": ">", "value": 5.6}]}'::jsonb,
  '{"high": {"criteria_met": 3}, "moderate": {"criteria_met": 2}}'::jsonb,
  'attention',
  'Your glucose patterns suggest possible insulin resistance. Discuss with your doctor and consider requesting a fasting insulin and HOMA-IR test.',
  ARRAY['fasting_insulin', 'homa_ir', 'oral_glucose_tolerance_test']),

('reactive_hypoglycemia', 'Reactive Hypoglycemia', 'metabolic',
  ARRAY['blood_glucose', 'food_log', 'symptoms'],
  '{"rules": [{"metric": "glucose_post_meal_crash", "operator": "<", "value": 60, "window_hours": 4, "min_occurrences": 3, "window_days": 14}, {"metric": "correlated_symptoms", "operator": "any", "values": ["dizziness", "fatigue", "shakiness", "brain_fog"]}]}'::jsonb,
  '{"high": {"criteria_met": 2}, "moderate": {"criteria_met": 1}}'::jsonb,
  'attention',
  'Your data shows glucose drops below normal range after meals, paired with symptoms. This pattern suggests reactive hypoglycemia. Consult your healthcare provider.',
  ARRAY['oral_glucose_tolerance_test', 'fasting_insulin']),

('thyroid_dysfunction', 'Possible Thyroid Dysfunction', 'thyroid_hormonal',
  ARRAY['resting_hr', 'body_temperature', 'weight', 'energy_level', 'sleep_quality', 'tsh'],
  '{"rules": [{"metric": "resting_hr_deviation", "operator": ">", "value_type": "baseline_pct", "value": 15}, {"metric": "body_temp_avg", "operator": "<", "value": 97.0}, {"metric": "weight_change_30d", "operator": ">", "value_type": "lbs", "value": 5}, {"metric": "energy_avg", "operator": "<", "value": 4}, {"metric": "tsh", "operator": "outside", "low": 0.5, "high": 4.5}]}'::jsonb,
  '{"high": {"criteria_met": 4}, "moderate": {"criteria_met": 3}}'::jsonb,
  'attention',
  'Your biometric patterns suggest possible thyroid dysfunction. Consider requesting a comprehensive thyroid panel (TSH, Free T3, Free T4, thyroid antibodies).',
  ARRAY['tsh', 'free_t3', 'free_t4', 'thyroid_antibodies']),

('adrenal_dysfunction', 'Possible Adrenal Dysfunction / HPA Axis Dysregulation', 'stress_adrenal',
  ARRAY['hrv', 'resting_hr', 'sleep_quality', 'energy_level', 'stress_score'],
  '{"rules": [{"metric": "hrv_30d_decline_pct", "operator": ">", "value": 20}, {"metric": "resting_hr_elevation_pct", "operator": ">", "value": 10}, {"metric": "energy_morning_avg", "operator": "<", "value": 4}, {"metric": "sleep_quality_avg", "operator": "<", "value": 50}, {"metric": "stress_avg", "operator": ">", "value": 7}]}'::jsonb,
  '{"high": {"criteria_met": 4}, "moderate": {"criteria_met": 3}}'::jsonb,
  'informational',
  'Your HRV and recovery data show patterns consistent with chronic stress or adrenal fatigue. Consider a 4-point cortisol test (salivary) and discuss with your functional medicine practitioner.',
  ARRAY['salivary_cortisol_4point', 'dhea_s', 'comprehensive_metabolic_panel']),

('systemic_inflammation', 'Systemic Inflammation Warning', 'inflammation',
  ARRAY['hrv', 'resting_hr', 'body_temperature', 'symptoms', 'hscrp'],
  '{"rules": [{"metric": "resting_hr_elevation_pct", "operator": ">", "value": 10, "window_days": 7}, {"metric": "hrv_decline", "operator": "true", "window_days": 7}, {"metric": "body_temp_elevation", "operator": ">", "value": 0.5, "window_days": 5}, {"metric": "correlated_symptoms", "operator": "any", "values": ["joint_pain", "fatigue", "brain_fog"]}, {"metric": "hscrp", "operator": ">", "value": 3.0}]}'::jsonb,
  '{"high": {"criteria_met": 4}, "moderate": {"criteria_met": 3}}'::jsonb,
  'attention',
  'Multiple data points suggest elevated systemic inflammation. Discuss with your healthcare provider and consider requesting hsCRP and ESR labs.',
  ARRAY['hscrp', 'esr', 'comprehensive_metabolic_panel', 'cbc']),

('iron_deficiency', 'Possible Iron Deficiency / Anemia', 'nutrient_deficiency',
  ARRAY['resting_hr', 'hrv', 'energy_level', 'spo2', 'ferritin', 'hemoglobin'],
  '{"rules": [{"metric": "resting_hr_elevated_compensation", "operator": "true"}, {"metric": "energy_avg", "operator": "<", "value": 4}, {"metric": "spo2_trend_declining", "operator": "true"}, {"metric": "correlated_symptoms", "operator": "any", "values": ["fatigue", "dizziness", "cold_extremities", "shortness_of_breath"]}, {"metric": "ferritin", "operator": "<", "value": 30}]}'::jsonb,
  '{"high": {"criteria_met": 4}, "moderate": {"criteria_met": 3}}'::jsonb,
  'informational',
  'Your data patterns may indicate iron deficiency. Consider requesting a full iron panel (ferritin, serum iron, TIBC, transferrin saturation).',
  ARRAY['ferritin', 'serum_iron', 'tibc', 'transferrin_saturation', 'cbc']),

('overtraining', 'Overtraining Syndrome', 'recovery',
  ARRAY['hrv', 'resting_hr', 'sleep_quality', 'recovery_score', 'workout_intensity'],
  '{"rules": [{"metric": "hrv_14d_decline_pct", "operator": ">", "value": 20}, {"metric": "resting_hr_elevation", "operator": ">", "value": 8}, {"metric": "recovery_score_avg", "operator": "<", "value": 40, "window_days": 5}, {"metric": "training_load_increase", "operator": "true", "window_days": 14}, {"metric": "mood_energy_declining", "operator": "true"}]}'::jsonb,
  '{"high": {"criteria_met": 4}, "moderate": {"criteria_met": 3}}'::jsonb,
  'attention',
  'Your recovery data strongly suggests overtraining. Consider reducing training intensity by 50% for 1-2 weeks and focusing on sleep, nutrition, and active recovery.',
  ARRAY['cortisol', 'testosterone', 'crp']),

('chronic_sleep_deprivation', 'Chronic Sleep Deprivation', 'sleep',
  ARRAY['sleep_duration', 'sleep_quality', 'hrv', 'recovery_score'],
  '{"rules": [{"metric": "sleep_duration_avg", "operator": "<", "value": 6, "window_days": 14}, {"metric": "hrv_decline_pct", "operator": ">", "value": 15}, {"metric": "recovery_score_avg", "operator": "<", "value": 50}]}'::jsonb,
  '{"high": {"criteria_met": 3}, "moderate": {"criteria_met": 2}}'::jsonb,
  'attention',
  'Your sleep patterns indicate chronic sleep deprivation. This is associated with increased inflammation, impaired cognitive function, and accelerated aging. Consider reviewing your sleep habits and consulting with a sleep specialist.',
  ARRAY['sleep_study', 'cortisol']),

('gut_dysbiosis', 'Possible Gut Dysbiosis', 'gut_health',
  ARRAY['symptoms', 'food_log', 'supplement_adherence'],
  '{"rules": [{"metric": "digestive_symptoms_frequency", "operator": ">", "value": 4, "per": "week", "window_weeks": 3}, {"metric": "food_correlation", "operator": "true", "categories": ["high_fodmap", "gluten", "dairy"]}, {"metric": "elimination_compliance", "operator": "<", "value": 60}]}'::jsonb,
  '{"high": {"criteria_met": 3}, "moderate": {"criteria_met": 2}}'::jsonb,
  'informational',
  'Your symptom patterns suggest possible gut dysbiosis or food sensitivities. Consider a comprehensive stool analysis (GI-MAP) and discuss with your functional medicine practitioner.',
  ARRAY['gi_map', 'food_sensitivity_panel', 'comprehensive_stool_analysis'])

ON CONFLICT (pattern_id) DO NOTHING;
