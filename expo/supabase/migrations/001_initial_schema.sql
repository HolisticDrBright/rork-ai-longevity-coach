-- ============================================================
-- AI Longevity Pro - Initial Schema Migration
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean AS $$
  SELECT public.has_role(auth.uid(), 'admin');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_practitioner()
RETURNS boolean AS $$
  SELECT public.has_role(auth.uid(), 'practitioner');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_assigned_patient(_practitioner_id uuid, _patient_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.practitioner_patient_assignments
    WHERE practitioner_id = _practitioner_id
      AND patient_id = _patient_id
      AND status = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- CORE IDENTITY TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  first_name text,
  last_name text,
  phone text,
  sex text,
  birth_date text,
  timezone text DEFAULT 'UTC',
  avatar_url text,
  height numeric,
  weight numeric,
  goals text[],
  onboarding_completed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'practitioner', 'admin')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, role)
);

CREATE TABLE IF NOT EXISTS public.practitioner_patient_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  practitioner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
  assigned_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(practitioner_id, patient_id)
);

-- ============================================================
-- HEALTH & LIFESTYLE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.health_goals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  primary_goal text,
  secondary_goals_json jsonb,
  target_weight numeric,
  target_body_fat numeric,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS public.lifestyle_profiles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sleep_hours numeric,
  sleep_quality numeric,
  stress_level numeric,
  diet_type text,
  cooking_skill text,
  shopping_cadence text,
  exercise_frequency numeric,
  exercise_types text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS public.contraindications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pregnant boolean DEFAULT false,
  nursing boolean DEFAULT false,
  medications text[] DEFAULT '{}',
  allergies text[] DEFAULT '{}',
  conditions text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS public.questionnaire_responses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id text NOT NULL,
  category_id text NOT NULL,
  severity integer NOT NULL DEFAULT 0,
  timestamp timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, question_id)
);

CREATE TABLE IF NOT EXISTS public.clinical_intakes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chief_complaint_json jsonb DEFAULT '{}',
  associated_symptoms_json jsonb DEFAULT '[]',
  energy_level numeric,
  sleep_quality numeric,
  digestive_function numeric,
  stress_perception numeric,
  temperature_sensitivity text,
  pain_quality text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- WEARABLE & BIOMETRIC TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.wearable_connections (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_user_id text,
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  scopes_json jsonb,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'expired', 'revoked')),
  last_sync_at timestamptz,
  last_successful_sync_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS public.raw_health_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_record_id text,
  record_type text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}',
  recorded_at timestamptz NOT NULL,
  imported_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_biometric_records (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  primary_source text,
  sleep_duration_minutes numeric,
  time_in_bed_minutes numeric,
  sleep_efficiency numeric,
  sleep_latency_minutes numeric,
  wake_after_sleep_onset_minutes numeric,
  awakenings integer,
  rem_sleep_minutes numeric,
  deep_sleep_minutes numeric,
  light_sleep_minutes numeric,
  sleep_score numeric,
  bedtime text,
  wake_time text,
  bedtime_variability_minutes numeric,
  hrv numeric,
  resting_hr numeric,
  avg_hr numeric,
  respiratory_rate numeric,
  temp_deviation numeric,
  readiness_score_vendor numeric,
  stress_score_vendor numeric,
  steps integer,
  distance_meters numeric,
  calories_burned numeric,
  active_minutes numeric,
  sedentary_minutes numeric,
  workout_minutes numeric,
  training_load numeric,
  strain_score numeric,
  vo2max numeric,
  weight_kg numeric,
  body_fat_percent numeric,
  spo2 numeric,
  glucose_avg numeric,
  systolic_bp numeric,
  diastolic_bp numeric,
  hydration_ml numeric,
  alcohol_units numeric,
  caffeine_mg numeric,
  cycle_phase text,
  energy_score_subjective numeric,
  stress_score_subjective numeric,
  soreness_score_subjective numeric,
  mood_score_subjective numeric,
  cravings_score_subjective numeric,
  libido_score_subjective numeric,
  bowel_score_subjective numeric,
  adherence_score_raw numeric,
  symptom_flags_json jsonb,
  data_quality_score numeric,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

-- ============================================================
-- NUTRITION TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.meal_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  meal_time timestamptz NOT NULL,
  meal_type text NOT NULL,
  calories numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  fiber_g numeric,
  glycemic_load_estimate numeric,
  inflammatory_load_estimate numeric,
  food_quality_score numeric,
  tags_json jsonb,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_nutrition_rollups (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  total_calories numeric,
  total_protein_g numeric,
  total_carbs_g numeric,
  total_fat_g numeric,
  total_fiber_g numeric,
  meal_count integer,
  first_meal_time timestamptz,
  last_meal_time timestamptz,
  eating_window_minutes numeric,
  protein_distribution_score numeric,
  meal_timing_score numeric,
  inflammatory_load_total numeric,
  glycemic_load_total numeric,
  alcohol_units numeric,
  caffeine_mg numeric,
  hydration_ml numeric,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

-- ============================================================
-- SUPPLEMENT TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.supplement_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplement_name text NOT NULL,
  category text,
  dose text,
  unit text,
  timing text,
  logged_at timestamptz NOT NULL DEFAULT now(),
  associated_goal text,
  adherence_event boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_supplement_rollups (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  supplements_taken_count integer,
  expected_supplements_count integer,
  supplement_adherence_percent numeric,
  core_stack_adherence_percent numeric,
  sleep_support_taken boolean,
  metabolic_support_taken boolean,
  recovery_support_taken boolean,
  mitochondrial_support_taken boolean,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

-- ============================================================
-- SYMPTOM & SUBJECTIVE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.symptom_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symptom_name text NOT NULL,
  severity numeric,
  logged_at timestamptz NOT NULL DEFAULT now(),
  duration_minutes numeric,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_subjective_rollups (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  energy_avg numeric,
  stress_avg numeric,
  soreness_avg numeric,
  mood_avg numeric,
  cravings_avg numeric,
  libido_avg numeric,
  bowel_avg numeric,
  checkin_completion_score numeric,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

-- ============================================================
-- LAB TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lab_markers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  marker_name text NOT NULL,
  marker_value numeric NOT NULL,
  unit text NOT NULL,
  reference_range_low numeric,
  reference_range_high numeric,
  optimal_range_low numeric,
  optimal_range_high numeric,
  collected_at timestamptz NOT NULL,
  source text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lab_panels (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  date date NOT NULL,
  source text,
  file_url text,
  biomarkers_json jsonb DEFAULT '[]',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- ANALYTICS & SCORING TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.daily_baselines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  baseline_window_days integer NOT NULL DEFAULT 14,
  sleep_duration_baseline numeric,
  sleep_efficiency_baseline numeric,
  sleep_score_baseline numeric,
  hrv_baseline numeric,
  resting_hr_baseline numeric,
  respiratory_rate_baseline numeric,
  temp_deviation_baseline numeric,
  steps_baseline numeric,
  active_minutes_baseline numeric,
  readiness_baseline numeric,
  energy_baseline numeric,
  stress_baseline numeric,
  soreness_baseline numeric,
  bedtime_baseline text,
  hydration_baseline numeric,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS public.daily_scores (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  recovery_score numeric,
  recovery_status text,
  sleep_score_computed numeric,
  stress_load_score numeric,
  metabolic_resilience_score numeric,
  adherence_score numeric,
  nervous_system_balance_score numeric,
  inflammation_strain_score numeric,
  confidence_score numeric,
  scoring_inputs_json jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS public.detected_patterns (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  pattern_type text NOT NULL,
  severity text NOT NULL,
  confidence text NOT NULL,
  title text NOT NULL,
  summary text,
  evidence_json jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.correlations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  computed_at timestamptz NOT NULL DEFAULT now(),
  variable_a text NOT NULL,
  variable_b text NOT NULL,
  time_window_days integer NOT NULL,
  direction text NOT NULL,
  strength text NOT NULL,
  confidence text NOT NULL,
  sample_size integer NOT NULL,
  summary text,
  evidence_json jsonb
);

CREATE TABLE IF NOT EXISTS public.daily_recommendations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  recovery_status text,
  training_guidance text,
  nutrition_guidance text,
  supplement_guidance text,
  sleep_guidance text,
  stress_guidance text,
  escalation_flag text,
  top_actions_json jsonb,
  explanation_short text,
  explanation_long text,
  recommendation_payload_json jsonb,
  ai_summary_json jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

-- ============================================================
-- PRACTITIONER & NOTIFICATION TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.practitioner_flags (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  flag_type text NOT NULL,
  severity text NOT NULL,
  summary text,
  evidence_json jsonb,
  resolved boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_queue (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  notification_type text NOT NULL,
  payload_json jsonb,
  send_at timestamptz,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- PROTOCOL & ADHERENCE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.protocols (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  start_date date NOT NULL,
  end_date date,
  status text DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  version integer DEFAULT 1,
  supplements_json jsonb DEFAULT '[]',
  peptides_json jsonb DEFAULT '[]',
  fasting_plan_json jsonb,
  lifestyle_tasks_json jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_adherence (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  protocol_id uuid NOT NULL REFERENCES public.protocols(id) ON DELETE CASCADE,
  completed_supplements text[] DEFAULT '{}',
  completed_peptides text[] DEFAULT '{}',
  completed_tasks text[] DEFAULT '{}',
  fasting_completed boolean DEFAULT false,
  notes text,
  symptoms_json jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date, protocol_id)
);

-- ============================================================
-- HORMONE TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hormone_entries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  cycle_day integer,
  symptoms_json jsonb DEFAULT '[]',
  notes text,
  current_supplements_json jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- APP SETTINGS & SUBSCRIPTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  settings_json jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_name text,
  status text DEFAULT 'active',
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_assignments_practitioner ON public.practitioner_patient_assignments(practitioner_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_assignments_patient ON public.practitioner_patient_assignments(patient_id);
CREATE INDEX IF NOT EXISTS idx_health_goals_user ON public.health_goals(user_id);
CREATE INDEX IF NOT EXISTS idx_lifestyle_profiles_user ON public.lifestyle_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_contraindications_user ON public.contraindications(user_id);
CREATE INDEX IF NOT EXISTS idx_questionnaire_responses_user ON public.questionnaire_responses(user_id);
CREATE INDEX IF NOT EXISTS idx_clinical_intakes_user ON public.clinical_intakes(user_id);
CREATE INDEX IF NOT EXISTS idx_wearable_connections_user_provider ON public.wearable_connections(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_raw_health_events_user_type ON public.raw_health_events(user_id, record_type);
CREATE INDEX IF NOT EXISTS idx_raw_health_events_recorded ON public.raw_health_events(recorded_at);
CREATE INDEX IF NOT EXISTS idx_biometric_records_user_date ON public.daily_biometric_records(user_id, date);
CREATE INDEX IF NOT EXISTS idx_meal_logs_user_time ON public.meal_logs(user_id, meal_time);
CREATE INDEX IF NOT EXISTS idx_nutrition_rollups_user_date ON public.daily_nutrition_rollups(user_id, date);
CREATE INDEX IF NOT EXISTS idx_supplement_logs_user_time ON public.supplement_logs(user_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_supplement_rollups_user_date ON public.daily_supplement_rollups(user_id, date);
CREATE INDEX IF NOT EXISTS idx_symptom_logs_user_time ON public.symptom_logs(user_id, logged_at);
CREATE INDEX IF NOT EXISTS idx_subjective_rollups_user_date ON public.daily_subjective_rollups(user_id, date);
CREATE INDEX IF NOT EXISTS idx_lab_markers_user_collected ON public.lab_markers(user_id, collected_at);
CREATE INDEX IF NOT EXISTS idx_lab_panels_user_date ON public.lab_panels(user_id, date);
CREATE INDEX IF NOT EXISTS idx_baselines_user_date ON public.daily_baselines(user_id, date);
CREATE INDEX IF NOT EXISTS idx_scores_user_date ON public.daily_scores(user_id, date);
CREATE INDEX IF NOT EXISTS idx_patterns_user_date ON public.detected_patterns(user_id, date);
CREATE INDEX IF NOT EXISTS idx_correlations_user ON public.correlations(user_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_user_date ON public.daily_recommendations(user_id, date);
CREATE INDEX IF NOT EXISTS idx_practitioner_flags_user_date ON public.practitioner_flags(user_id, date);
CREATE INDEX IF NOT EXISTS idx_practitioner_flags_unresolved ON public.practitioner_flags(user_id, resolved);
CREATE INDEX IF NOT EXISTS idx_notification_queue_user_status ON public.notification_queue(user_id, status);
CREATE INDEX IF NOT EXISTS idx_protocols_user ON public.protocols(user_id);
CREATE INDEX IF NOT EXISTS idx_adherence_user_date ON public.daily_adherence(user_id, date);
CREATE INDEX IF NOT EXISTS idx_hormone_entries_user_date ON public.hormone_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_app_settings_user ON public.app_settings(user_id);

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_health_goals_updated_at BEFORE UPDATE ON public.health_goals FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_lifestyle_profiles_updated_at BEFORE UPDATE ON public.lifestyle_profiles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_contraindications_updated_at BEFORE UPDATE ON public.contraindications FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_clinical_intakes_updated_at BEFORE UPDATE ON public.clinical_intakes FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_wearable_connections_updated_at BEFORE UPDATE ON public.wearable_connections FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_biometric_records_updated_at BEFORE UPDATE ON public.daily_biometric_records FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_meal_logs_updated_at BEFORE UPDATE ON public.meal_logs FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_nutrition_rollups_updated_at BEFORE UPDATE ON public.daily_nutrition_rollups FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_supplement_logs_updated_at BEFORE UPDATE ON public.supplement_logs FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_supplement_rollups_updated_at BEFORE UPDATE ON public.daily_supplement_rollups FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_symptom_logs_updated_at BEFORE UPDATE ON public.symptom_logs FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_subjective_rollups_updated_at BEFORE UPDATE ON public.daily_subjective_rollups FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_scores_updated_at BEFORE UPDATE ON public.daily_scores FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_recommendations_updated_at BEFORE UPDATE ON public.daily_recommendations FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_practitioner_flags_updated_at BEFORE UPDATE ON public.practitioner_flags FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_notification_queue_updated_at BEFORE UPDATE ON public.notification_queue FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_protocols_updated_at BEFORE UPDATE ON public.protocols FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_adherence_updated_at BEFORE UPDATE ON public.daily_adherence FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_hormone_entries_updated_at BEFORE UPDATE ON public.hormone_entries FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_practitioner_assignments_updated_at BEFORE UPDATE ON public.practitioner_patient_assignments FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_lab_panels_updated_at BEFORE UPDATE ON public.lab_panels FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, onboarding_completed)
  VALUES (NEW.id, NEW.email, false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
