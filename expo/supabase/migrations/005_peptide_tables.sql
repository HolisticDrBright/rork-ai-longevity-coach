-- ============================================================
-- AI Longevity Pro - Peptide Intelligence Platform Tables
-- Migration 005: Full peptide module schema
-- ============================================================

-- ============================================================
-- PEPTIDE LIBRARY (canonical reference data)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.peptide_library (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  aliases text[] DEFAULT '{}',
  category text NOT NULL CHECK (category IN (
    'gh_secretagogue', 'healing', 'immune', 'cognitive', 'sleep',
    'sexual_health', 'weight_management', 'longevity', 'skin',
    'mitochondrial', 'bioregulator', 'antimicrobial', 'hormone'
  )),
  description text,
  mechanism text,
  typical_dose_min numeric,
  typical_dose_max numeric,
  dose_unit text DEFAULT 'mcg' CHECK (dose_unit IN ('mcg', 'mg', 'IU')),
  half_life_hours numeric,
  routes text[] DEFAULT '{}',
  forms text[] DEFAULT '{}',
  goals text[] DEFAULT '{}',
  stacking_notes text,
  storage_notes text,
  research_references jsonb DEFAULT '[]',
  legal_note text,
  wada_caution boolean DEFAULT false,
  clinician_only boolean DEFAULT false,
  pregnancy_safe boolean DEFAULT false,
  lactation_safe boolean DEFAULT false,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- PEPTIDE PROTOCOLS (user's AI-generated or custom protocols)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.peptide_protocols (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  goal text NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  lab_snapshot_id uuid,
  wearable_snapshot jsonb,
  ai_reasoning text,
  suggested_retest_timeline text,
  start_date date,
  end_date date,
  practitioner_notes text,
  practitioner_approved boolean DEFAULT false,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- PROTOCOL PEPTIDES (individual peptides within a protocol)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.protocol_peptides (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  protocol_id uuid NOT NULL REFERENCES public.peptide_protocols(id) ON DELETE CASCADE,
  peptide_id uuid NOT NULL REFERENCES public.peptide_library(id) ON DELETE CASCADE,
  dose_amount numeric NOT NULL,
  dose_unit text DEFAULT 'mcg' CHECK (dose_unit IN ('mcg', 'mg', 'IU')),
  frequency text NOT NULL,
  timing text,
  duration_weeks integer,
  ai_rationale text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- PROTOCOL PHASES (multi-phase periodization)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.protocol_phases (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  protocol_id uuid NOT NULL REFERENCES public.peptide_protocols(id) ON DELETE CASCADE,
  phase_name text NOT NULL,
  phase_order integer NOT NULL,
  phase_type text DEFAULT 'active' CHECK (phase_type IN ('loading', 'active', 'maintenance', 'taper', 'off')),
  start_date date,
  end_date date,
  duration_days integer,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- PROTOCOL SCHEDULE (cycling patterns per peptide per phase)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.protocol_schedule (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  protocol_peptide_id uuid NOT NULL REFERENCES public.protocol_peptides(id) ON DELETE CASCADE,
  phase_id uuid REFERENCES public.protocol_phases(id) ON DELETE SET NULL,
  phase_name text,
  phase_order integer DEFAULT 0,
  dose_amount numeric NOT NULL,
  dose_unit text DEFAULT 'mcg',
  frequency text NOT NULL,
  duration_days integer NOT NULL,
  is_active_phase boolean DEFAULT true,
  taper_type text CHECK (taper_type IN ('none', 'linear', 'step')),
  taper_step_reduction numeric,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- DOSE LOGS (injection/dose tracking with site rotation)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.peptide_dose_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  protocol_id uuid NOT NULL REFERENCES public.peptide_protocols(id) ON DELETE CASCADE,
  protocol_peptide_id uuid NOT NULL REFERENCES public.protocol_peptides(id) ON DELETE CASCADE,
  logged_at timestamptz NOT NULL DEFAULT now(),
  dose_amount numeric NOT NULL,
  dose_unit text DEFAULT 'mcg',
  injection_site text,
  status text DEFAULT 'taken' CHECK (status IN ('taken', 'skipped', 'partial')),
  skip_reason text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- PEPTIDE INTERACTIONS (peptide-to-peptide safety rules)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.peptide_interactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  peptide_a_slug text NOT NULL,
  peptide_b_slug text NOT NULL,
  interaction_type text NOT NULL CHECK (interaction_type IN ('synergistic', 'antagonistic', 'caution', 'contraindicated')),
  severity text NOT NULL CHECK (severity IN ('info', 'caution', 'warning', 'critical')),
  description text NOT NULL,
  recommendation text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- PEPTIDE CONTRAINDICATIONS (condition-based)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.peptide_contraindications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  peptide_slug text NOT NULL,
  condition text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'caution', 'warning', 'critical')),
  description text NOT NULL,
  recommendation text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- PEPTIDE LAB THRESHOLDS (biomarker-based safety rules)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.peptide_lab_thresholds (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  peptide_slug text NOT NULL,
  biomarker_name text NOT NULL,
  threshold_value numeric NOT NULL,
  direction text NOT NULL CHECK (direction IN ('above', 'below')),
  severity text NOT NULL CHECK (severity IN ('info', 'caution', 'warning', 'critical')),
  message text NOT NULL,
  recommendation text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- LAB-TO-PEPTIDE MAPPINGS (functional medicine intelligence)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lab_peptide_mappings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  lab_type text NOT NULL CHECK (lab_type IN (
    'blood_panel', 'dutch', 'gi_map', 'oat', 'mycotoxin',
    'heavy_metal', 'viral', 'lyme', 'sibo', 'gut_zoomer'
  )),
  finding_pattern text NOT NULL,
  finding_description text NOT NULL,
  recommended_peptide_slugs text[] NOT NULL,
  priority_level integer DEFAULT 1 CHECK (priority_level BETWEEN 1 AND 5),
  reasoning text NOT NULL,
  prerequisite_note text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- CORRELATION INSIGHTS (AI-generated biomarker correlations)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.peptide_correlation_insights (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  protocol_id uuid NOT NULL REFERENCES public.peptide_protocols(id) ON DELETE CASCADE,
  insight_type text NOT NULL CHECK (insight_type IN ('biomarker', 'wearable', 'composite')),
  metric_name text NOT NULL,
  baseline_value numeric,
  current_value numeric,
  change_percent numeric,
  direction text CHECK (direction IN ('improved', 'declined', 'stable')),
  confidence text CHECK (confidence IN ('strong', 'moderate', 'weak')),
  ai_explanation text,
  generated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- WEARABLE SNAPSHOTS (baseline captures for protocols)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.peptide_wearable_snapshots (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  protocol_id uuid NOT NULL REFERENCES public.peptide_protocols(id) ON DELETE CASCADE,
  snapshot_type text DEFAULT 'baseline' CHECK (snapshot_type IN ('baseline', 'current', 'final')),
  hrv_avg numeric,
  resting_hr_avg numeric,
  deep_sleep_pct numeric,
  rem_sleep_pct numeric,
  total_sleep_min numeric,
  spo2_avg numeric,
  body_temp_avg numeric,
  steps_avg numeric,
  recovery_score_avg numeric,
  measurement_period_days integer DEFAULT 7,
  captured_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_peptide_library_slug ON public.peptide_library(slug);
CREATE INDEX IF NOT EXISTS idx_peptide_library_category ON public.peptide_library(category);
CREATE INDEX IF NOT EXISTS idx_peptide_library_goals ON public.peptide_library USING gin(goals);

CREATE INDEX IF NOT EXISTS idx_peptide_protocols_user ON public.peptide_protocols(user_id);
CREATE INDEX IF NOT EXISTS idx_peptide_protocols_status ON public.peptide_protocols(user_id, status);

CREATE INDEX IF NOT EXISTS idx_protocol_peptides_protocol ON public.protocol_peptides(protocol_id);
CREATE INDEX IF NOT EXISTS idx_protocol_peptides_peptide ON public.protocol_peptides(peptide_id);

CREATE INDEX IF NOT EXISTS idx_protocol_phases_protocol ON public.protocol_phases(protocol_id);
CREATE INDEX IF NOT EXISTS idx_protocol_schedule_peptide ON public.protocol_schedule(protocol_peptide_id);

CREATE INDEX IF NOT EXISTS idx_dose_logs_user ON public.peptide_dose_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_dose_logs_protocol ON public.peptide_dose_logs(protocol_id);
CREATE INDEX IF NOT EXISTS idx_dose_logs_logged_at ON public.peptide_dose_logs(logged_at);

CREATE INDEX IF NOT EXISTS idx_peptide_interactions_a ON public.peptide_interactions(peptide_a_slug);
CREATE INDEX IF NOT EXISTS idx_peptide_interactions_b ON public.peptide_interactions(peptide_b_slug);

CREATE INDEX IF NOT EXISTS idx_peptide_contraindications_slug ON public.peptide_contraindications(peptide_slug);
CREATE INDEX IF NOT EXISTS idx_peptide_lab_thresholds_slug ON public.peptide_lab_thresholds(peptide_slug);
CREATE INDEX IF NOT EXISTS idx_lab_peptide_mappings_type ON public.lab_peptide_mappings(lab_type);

CREATE INDEX IF NOT EXISTS idx_correlation_insights_user ON public.peptide_correlation_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_correlation_insights_protocol ON public.peptide_correlation_insights(protocol_id);

CREATE INDEX IF NOT EXISTS idx_wearable_snapshots_protocol ON public.peptide_wearable_snapshots(protocol_id);

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================

CREATE TRIGGER set_peptide_library_updated_at BEFORE UPDATE ON public.peptide_library FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_peptide_protocols_updated_at BEFORE UPDATE ON public.peptide_protocols FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_protocol_peptides_updated_at BEFORE UPDATE ON public.protocol_peptides FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_protocol_phases_updated_at BEFORE UPDATE ON public.protocol_phases FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.peptide_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peptide_protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocol_peptides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocol_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocol_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peptide_dose_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peptide_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peptide_contraindications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peptide_lab_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_peptide_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peptide_correlation_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peptide_wearable_snapshots ENABLE ROW LEVEL SECURITY;

-- Peptide library: readable by all authenticated users
CREATE POLICY "peptide_library_select" ON public.peptide_library FOR SELECT TO authenticated USING (true);
CREATE POLICY "peptide_library_admin_all" ON public.peptide_library FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Peptide protocols: user owns their protocols, practitioners can view assigned patients
CREATE POLICY "peptide_protocols_user_select" ON public.peptide_protocols FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_practitioner() OR public.is_admin());
CREATE POLICY "peptide_protocols_user_insert" ON public.peptide_protocols FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "peptide_protocols_user_update" ON public.peptide_protocols FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_practitioner() OR public.is_admin());
CREATE POLICY "peptide_protocols_user_delete" ON public.peptide_protocols FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- Protocol peptides: accessible via protocol ownership
CREATE POLICY "protocol_peptides_select" ON public.protocol_peptides FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.peptide_protocols pp WHERE pp.id = protocol_id AND (pp.user_id = auth.uid() OR public.is_practitioner() OR public.is_admin())));
CREATE POLICY "protocol_peptides_insert" ON public.protocol_peptides FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.peptide_protocols pp WHERE pp.id = protocol_id AND pp.user_id = auth.uid()));
CREATE POLICY "protocol_peptides_update" ON public.protocol_peptides FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.peptide_protocols pp WHERE pp.id = protocol_id AND (pp.user_id = auth.uid() OR public.is_practitioner())));
CREATE POLICY "protocol_peptides_delete" ON public.protocol_peptides FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.peptide_protocols pp WHERE pp.id = protocol_id AND pp.user_id = auth.uid()));

-- Protocol phases: same as protocol peptides
CREATE POLICY "protocol_phases_select" ON public.protocol_phases FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.peptide_protocols pp WHERE pp.id = protocol_id AND (pp.user_id = auth.uid() OR public.is_practitioner() OR public.is_admin())));
CREATE POLICY "protocol_phases_insert" ON public.protocol_phases FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.peptide_protocols pp WHERE pp.id = protocol_id AND pp.user_id = auth.uid()));
CREATE POLICY "protocol_phases_update" ON public.protocol_phases FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.peptide_protocols pp WHERE pp.id = protocol_id AND (pp.user_id = auth.uid() OR public.is_practitioner())));
CREATE POLICY "protocol_phases_delete" ON public.protocol_phases FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.peptide_protocols pp WHERE pp.id = protocol_id AND pp.user_id = auth.uid()));

-- Protocol schedule: via protocol_peptides → protocol ownership
CREATE POLICY "protocol_schedule_select" ON public.protocol_schedule FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.protocol_peptides ppep
    JOIN public.peptide_protocols pp ON pp.id = ppep.protocol_id
    WHERE ppep.id = protocol_peptide_id AND (pp.user_id = auth.uid() OR public.is_practitioner() OR public.is_admin())
  ));
CREATE POLICY "protocol_schedule_insert" ON public.protocol_schedule FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.protocol_peptides ppep
    JOIN public.peptide_protocols pp ON pp.id = ppep.protocol_id
    WHERE ppep.id = protocol_peptide_id AND pp.user_id = auth.uid()
  ));

-- Dose logs: user owns their logs
CREATE POLICY "dose_logs_user_select" ON public.peptide_dose_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_practitioner() OR public.is_admin());
CREATE POLICY "dose_logs_user_insert" ON public.peptide_dose_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Reference tables: readable by all authenticated
CREATE POLICY "peptide_interactions_select" ON public.peptide_interactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "peptide_interactions_admin" ON public.peptide_interactions FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "peptide_contraindications_select" ON public.peptide_contraindications FOR SELECT TO authenticated USING (true);
CREATE POLICY "peptide_contraindications_admin" ON public.peptide_contraindications FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "peptide_lab_thresholds_select" ON public.peptide_lab_thresholds FOR SELECT TO authenticated USING (true);
CREATE POLICY "peptide_lab_thresholds_admin" ON public.peptide_lab_thresholds FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "lab_peptide_mappings_select" ON public.lab_peptide_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY "lab_peptide_mappings_admin" ON public.lab_peptide_mappings FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Correlation insights: user owns theirs
CREATE POLICY "correlation_insights_select" ON public.peptide_correlation_insights FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_practitioner() OR public.is_admin());
CREATE POLICY "correlation_insights_insert" ON public.peptide_correlation_insights FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Wearable snapshots: user owns theirs
CREATE POLICY "wearable_snapshots_select" ON public.peptide_wearable_snapshots FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_practitioner() OR public.is_admin());
CREATE POLICY "wearable_snapshots_insert" ON public.peptide_wearable_snapshots FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
