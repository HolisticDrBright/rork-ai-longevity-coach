-- ============================================================
-- AI Longevity Pro - Clinic Module Tables
-- Run AFTER 002_rls_policies.sql
-- These tables back the practitioner-facing clinic routes
-- ============================================================

-- ============================================================
-- CLINIC PATIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clinic_patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  date_of_birth text NOT NULL,
  sex text NOT NULL CHECK (sex IN ('male', 'female', 'other')),
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip_code text,
  country text DEFAULT 'US',
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  tags text[] DEFAULT '{}',
  assigned_clinician_id text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.clinic_patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinicians manage own patients"
  ON public.clinic_patients FOR ALL
  USING (clinician_id = auth.uid());

CREATE INDEX idx_clinic_patients_clinician ON public.clinic_patients(clinician_id);
CREATE INDEX idx_clinic_patients_status ON public.clinic_patients(clinician_id, status);
CREATE INDEX idx_clinic_patients_name ON public.clinic_patients(clinician_id, last_name, first_name);

CREATE TRIGGER set_clinic_patients_updated_at
  BEFORE UPDATE ON public.clinic_patients
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ============================================================
-- CLINIC HEALTH HISTORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clinic_health_histories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.clinic_patients(id) ON DELETE CASCADE,
  conditions text[] DEFAULT '{}',
  past_conditions text[] DEFAULT '{}',
  family_history text[] DEFAULT '{}',
  current_medications jsonb DEFAULT '[]',
  past_medications jsonb DEFAULT '[]',
  allergies jsonb DEFAULT '[]',
  smoking_status text,
  alcohol_use text,
  exercise_frequency text,
  diet_type text,
  sleep_hours_avg numeric,
  stress_level integer,
  pregnant boolean DEFAULT false,
  nursing boolean DEFAULT false,
  menstrual_status text,
  updated_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(patient_id)
);

ALTER TABLE public.clinic_health_histories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinicians manage own patient histories"
  ON public.clinic_health_histories FOR ALL
  USING (clinician_id = auth.uid());

CREATE INDEX idx_clinic_hh_patient ON public.clinic_health_histories(patient_id);
CREATE INDEX idx_clinic_hh_clinician ON public.clinic_health_histories(clinician_id);

CREATE TRIGGER set_clinic_hh_updated_at
  BEFORE UPDATE ON public.clinic_health_histories
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ============================================================
-- CLINIC LAB TESTS (reference data, shared across clinicians)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clinic_lab_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  category text,
  unit text NOT NULL,
  ref_range_low numeric,
  ref_range_high numeric,
  functional_range_low numeric,
  functional_range_high numeric,
  critical_low numeric,
  critical_high numeric,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.clinic_lab_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read lab tests"
  ON public.clinic_lab_tests FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage lab tests"
  ON public.clinic_lab_tests FOR ALL
  USING (public.is_admin());

CREATE INDEX idx_clinic_lab_tests_code ON public.clinic_lab_tests(code);
CREATE INDEX idx_clinic_lab_tests_category ON public.clinic_lab_tests(category);

-- ============================================================
-- CLINIC LAB DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clinic_lab_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.clinic_patients(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_type text NOT NULL CHECK (file_type IN ('pdf', 'jpg', 'png')),
  file_size_bytes integer NOT NULL,
  storage_path text NOT NULL,
  thumbnail_path text,
  lab_date text,
  lab_company text,
  ordering_provider text,
  panel_name text,
  processing_status text DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'parsed', 'manual_entry', 'error')),
  parsed_at timestamptz,
  uploaded_by text NOT NULL,
  uploaded_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.clinic_lab_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinicians manage own lab documents"
  ON public.clinic_lab_documents FOR ALL
  USING (clinician_id = auth.uid());

CREATE INDEX idx_clinic_lab_docs_patient ON public.clinic_lab_documents(patient_id);
CREATE INDEX idx_clinic_lab_docs_clinician ON public.clinic_lab_documents(clinician_id);
CREATE INDEX idx_clinic_lab_docs_status ON public.clinic_lab_documents(processing_status);

-- ============================================================
-- CLINIC LAB RESULTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clinic_lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.clinic_patients(id) ON DELETE CASCADE,
  lab_document_id uuid REFERENCES public.clinic_lab_documents(id) ON DELETE SET NULL,
  lab_test_id uuid NOT NULL REFERENCES public.clinic_lab_tests(id),
  value numeric NOT NULL,
  value_text text,
  unit text NOT NULL,
  ref_range_low numeric,
  ref_range_high numeric,
  status text NOT NULL CHECK (status IN ('normal', 'low', 'high', 'critical_low', 'critical_high')),
  result_date text NOT NULL,
  entered_by text NOT NULL,
  entry_method text DEFAULT 'manual' CHECK (entry_method IN ('manual', 'parsed', 'api')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.clinic_lab_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinicians manage own lab results"
  ON public.clinic_lab_results FOR ALL
  USING (clinician_id = auth.uid());

CREATE INDEX idx_clinic_lab_results_patient ON public.clinic_lab_results(patient_id);
CREATE INDEX idx_clinic_lab_results_clinician ON public.clinic_lab_results(clinician_id);
CREATE INDEX idx_clinic_lab_results_test ON public.clinic_lab_results(lab_test_id);
CREATE INDEX idx_clinic_lab_results_date ON public.clinic_lab_results(patient_id, result_date);

-- ============================================================
-- CLINIC BIOMETRIC TYPES (reference data, shared)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clinic_biometric_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  unit text NOT NULL,
  category text NOT NULL CHECK (category IN ('vital', 'metabolic', 'body_composition', 'sleep', 'activity')),
  normal_low numeric,
  normal_high numeric,
  warning_low numeric,
  warning_high numeric,
  critical_low numeric,
  critical_high numeric,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.clinic_biometric_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read biometric types"
  ON public.clinic_biometric_types FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage biometric types"
  ON public.clinic_biometric_types FOR ALL
  USING (public.is_admin());

CREATE INDEX idx_clinic_bio_types_code ON public.clinic_biometric_types(code);
CREATE INDEX idx_clinic_bio_types_category ON public.clinic_biometric_types(category);

-- ============================================================
-- CLINIC BIOMETRIC READINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clinic_biometric_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.clinic_patients(id) ON DELETE CASCADE,
  biometric_type_id uuid NOT NULL REFERENCES public.clinic_biometric_types(id),
  value numeric NOT NULL,
  unit text NOT NULL,
  reading_time timestamptz NOT NULL,
  context text CHECK (context IN ('fasting', 'post_meal', 'pre_exercise', 'post_exercise', 'bedtime', 'waking', 'random')),
  notes text,
  source text DEFAULT 'manual' CHECK (source IN ('manual', 'device_sync', 'cgm', 'app')),
  device_name text,
  status text NOT NULL CHECK (status IN ('normal', 'warning_low', 'warning_high', 'critical_low', 'critical_high')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.clinic_biometric_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinicians manage own biometric readings"
  ON public.clinic_biometric_readings FOR ALL
  USING (clinician_id = auth.uid());

CREATE INDEX idx_clinic_bio_readings_patient ON public.clinic_biometric_readings(patient_id);
CREATE INDEX idx_clinic_bio_readings_clinician ON public.clinic_biometric_readings(clinician_id);
CREATE INDEX idx_clinic_bio_readings_type ON public.clinic_biometric_readings(biometric_type_id);
CREATE INDEX idx_clinic_bio_readings_time ON public.clinic_biometric_readings(patient_id, reading_time);

-- ============================================================
-- CLINIC PATIENT THRESHOLDS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clinic_patient_thresholds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.clinic_patients(id) ON DELETE CASCADE,
  glucose_high numeric DEFAULT 180,
  glucose_low numeric DEFAULT 70,
  glucose_critical_high numeric DEFAULT 250,
  glucose_critical_low numeric DEFAULT 54,
  bp_systolic_high numeric DEFAULT 140,
  bp_systolic_low numeric DEFAULT 90,
  bp_diastolic_high numeric DEFAULT 90,
  bp_diastolic_low numeric DEFAULT 60,
  updated_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(patient_id)
);

ALTER TABLE public.clinic_patient_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinicians manage own patient thresholds"
  ON public.clinic_patient_thresholds FOR ALL
  USING (clinician_id = auth.uid());

CREATE INDEX idx_clinic_thresholds_patient ON public.clinic_patient_thresholds(patient_id);

CREATE TRIGGER set_clinic_thresholds_updated_at
  BEFORE UPDATE ON public.clinic_patient_thresholds
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ============================================================
-- CLINIC ALERT RULES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clinic_alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('global', 'patient')),
  patient_id uuid REFERENCES public.clinic_patients(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text NOT NULL CHECK (category IN ('lab', 'biometric', 'upload', 'adherence', 'symptom')),
  trigger_type text NOT NULL CHECK (trigger_type IN ('event', 'threshold', 'pattern', 'scheduled')),
  condition jsonb NOT NULL DEFAULT '{}',
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  notify_channels text[] DEFAULT '{in_app}',
  notify_roles text[] DEFAULT '{clinician}',
  dedupe_window_minutes integer DEFAULT 60,
  quiet_hours_start text,
  quiet_hours_end text,
  is_enabled boolean DEFAULT true,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.clinic_alert_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinicians manage own alert rules"
  ON public.clinic_alert_rules FOR ALL
  USING (clinician_id = auth.uid());

CREATE INDEX idx_clinic_alert_rules_clinician ON public.clinic_alert_rules(clinician_id);
CREATE INDEX idx_clinic_alert_rules_category ON public.clinic_alert_rules(category);
CREATE INDEX idx_clinic_alert_rules_severity ON public.clinic_alert_rules(severity);

CREATE TRIGGER set_clinic_alert_rules_updated_at
  BEFORE UPDATE ON public.clinic_alert_rules
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ============================================================
-- CLINIC ALERT EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clinic_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.clinic_alert_rules(id) ON DELETE SET NULL,
  patient_id uuid NOT NULL REFERENCES public.clinic_patients(id) ON DELETE CASCADE,
  trigger_type text NOT NULL CHECK (trigger_type IN ('event', 'threshold', 'pattern', 'scheduled')),
  trigger_data jsonb DEFAULT '{}',
  title text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
  status text DEFAULT 'new' CHECK (status IN ('new', 'viewed', 'acknowledged', 'snoozed', 'resolved', 'dismissed')),
  acknowledged_at timestamptz,
  acknowledged_by text,
  acknowledgment_notes text,
  snoozed_until timestamptz,
  resolved_at timestamptz,
  resolved_by text,
  resolution_notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.clinic_alert_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clinicians manage own alert events"
  ON public.clinic_alert_events FOR ALL
  USING (clinician_id = auth.uid());

CREATE INDEX idx_clinic_alert_events_clinician ON public.clinic_alert_events(clinician_id);
CREATE INDEX idx_clinic_alert_events_patient ON public.clinic_alert_events(patient_id);
CREATE INDEX idx_clinic_alert_events_status ON public.clinic_alert_events(clinician_id, status);
CREATE INDEX idx_clinic_alert_events_severity ON public.clinic_alert_events(severity, status);

-- ============================================================
-- SEED: Default Lab Tests
-- ============================================================
INSERT INTO public.clinic_lab_tests (code, name, category, unit, ref_range_low, ref_range_high, functional_range_low, functional_range_high, critical_low, critical_high) VALUES
  ('GLUCOSE', 'Glucose (Fasting)', 'metabolic', 'mg/dL', 70, 100, 75, 90, 50, 400),
  ('HBA1C', 'Hemoglobin A1c', 'metabolic', '%', 4.0, 5.6, 4.5, 5.3, NULL, 10),
  ('INSULIN', 'Insulin (Fasting)', 'metabolic', 'uIU/mL', 2.6, 24.9, 3, 8, NULL, NULL),
  ('CHOL_TOTAL', 'Total Cholesterol', 'lipid', 'mg/dL', NULL, 200, NULL, 180, NULL, 300),
  ('LDL', 'LDL Cholesterol', 'lipid', 'mg/dL', NULL, 100, NULL, 80, NULL, 190),
  ('HDL', 'HDL Cholesterol', 'lipid', 'mg/dL', 40, NULL, 60, NULL, NULL, NULL),
  ('TRIG', 'Triglycerides', 'lipid', 'mg/dL', NULL, 150, NULL, 100, NULL, 500),
  ('TSH', 'TSH', 'thyroid', 'mIU/L', 0.45, 4.5, 1.0, 2.5, NULL, NULL),
  ('FREE_T4', 'Free T4', 'thyroid', 'ng/dL', 0.82, 1.77, 1.0, 1.5, NULL, NULL),
  ('FREE_T3', 'Free T3', 'thyroid', 'pg/mL', 2.0, 4.4, 3.0, 4.0, NULL, NULL),
  ('VITD', 'Vitamin D, 25-Hydroxy', 'vitamin', 'ng/mL', 30, 100, 50, 80, 10, NULL),
  ('B12', 'Vitamin B12', 'vitamin', 'pg/mL', 211, 946, 500, 800, 150, NULL),
  ('FERRITIN', 'Ferritin', 'iron', 'ng/mL', 12, 150, 50, 100, NULL, NULL),
  ('IRON', 'Serum Iron', 'iron', 'mcg/dL', 60, 170, 85, 130, NULL, NULL),
  ('CREATININE', 'Creatinine', 'kidney', 'mg/dL', 0.7, 1.3, 0.8, 1.1, NULL, 4.0),
  ('BUN', 'Blood Urea Nitrogen', 'kidney', 'mg/dL', 6, 20, 10, 16, NULL, 100),
  ('EGFR', 'eGFR', 'kidney', 'mL/min/1.73m2', 90, NULL, NULL, NULL, 15, NULL),
  ('ALT', 'ALT (SGPT)', 'liver', 'U/L', NULL, 33, NULL, 25, NULL, 200),
  ('AST', 'AST (SGOT)', 'liver', 'U/L', NULL, 32, NULL, 25, NULL, 200),
  ('CRP', 'C-Reactive Protein (hs)', 'inflammation', 'mg/L', NULL, 3.0, NULL, 1.0, NULL, 10),
  ('HOMOCYSTEINE', 'Homocysteine', 'cardiovascular', 'umol/L', NULL, 15, NULL, 8, NULL, 50)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- SEED: Default Biometric Types
-- ============================================================
INSERT INTO public.clinic_biometric_types (code, name, unit, category, normal_low, normal_high, warning_low, warning_high, critical_low, critical_high) VALUES
  ('glucose', 'Blood Glucose', 'mg/dL', 'metabolic', 70, 140, 60, 180, 54, 250),
  ('bp_systolic', 'Blood Pressure (Systolic)', 'mmHg', 'vital', 90, 120, 80, 140, 70, 180),
  ('bp_diastolic', 'Blood Pressure (Diastolic)', 'mmHg', 'vital', 60, 80, 50, 90, 40, 120),
  ('heart_rate', 'Heart Rate', 'bpm', 'vital', 60, 100, 50, 110, 40, 150),
  ('weight', 'Weight', 'lbs', 'body_composition', NULL, NULL, NULL, NULL, NULL, NULL),
  ('body_fat', 'Body Fat Percentage', '%', 'body_composition', NULL, NULL, NULL, NULL, NULL, NULL),
  ('waist', 'Waist Circumference', 'inches', 'body_composition', NULL, NULL, NULL, NULL, NULL, NULL),
  ('temperature', 'Body Temperature', '°F', 'vital', 97.0, 99.0, 95.0, 100.4, 93.0, 104.0),
  ('oxygen_sat', 'Oxygen Saturation', '%', 'vital', 95, 100, 92, NULL, 88, NULL),
  ('hrv', 'Heart Rate Variability', 'ms', 'vital', 20, NULL, NULL, NULL, NULL, NULL),
  ('sleep_hours', 'Sleep Duration', 'hours', 'sleep', 7, 9, 5, 10, NULL, NULL),
  ('sleep_quality', 'Sleep Quality Score', 'score', 'sleep', 70, 100, 50, NULL, NULL, NULL),
  ('steps', 'Daily Steps', 'steps', 'activity', 7000, NULL, NULL, NULL, NULL, NULL),
  ('ketones', 'Blood Ketones', 'mmol/L', 'metabolic', 0.5, 3.0, NULL, 5.0, NULL, 10.0)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- SEED: Default Alert Rules (global, clinician_id = '00000000-0000-0000-0000-000000000000' placeholder)
-- These will be copied per-clinician on first access or via app logic
-- ============================================================
