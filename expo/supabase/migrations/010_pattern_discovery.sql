-- ============================================================
-- AI Longevity Pro - Pattern Discovery Engine
-- Migration 010: discovered_patterns, hypotheses, reviews,
--                exposures, paradigm prefs, symptom embeddings
-- ============================================================

-- pgvector is optional. If the extension isn't available we'll ship
-- without embeddings and the symptom_embeddings table will be empty.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension unavailable; symptom_embeddings will be skipped';
END $$;

-- Profile-level research cohort opt-in
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS research_cohort_opt_in boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS research_cohort_opted_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS surface_experimental_insights boolean DEFAULT false;

-- ============================================================
-- 1. Candidate correlations from the stats job
-- ============================================================

CREATE TABLE IF NOT EXISTS public.discovered_patterns (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind text NOT NULL CHECK (kind IN (
    'symptom_biomarker', 'biomarker_biomarker', 'protocol_outcome',
    'wearable_symptom', 'nutrient_symptom', 'peptide_outcome'
  )),
  left_entity jsonb NOT NULL,
  right_entity jsonb NOT NULL,
  method text NOT NULL CHECK (method IN (
    'spearman', 'kendall', 'chi_square', 'fisher',
    'point_biserial', 'mutual_info'
  )),
  time_lag_days integer NOT NULL DEFAULT 0,
  n_observations integer NOT NULL,
  n_patients integer NOT NULL,
  effect_size numeric NOT NULL,
  p_value numeric NOT NULL,
  q_value numeric NOT NULL,
  confidence_interval jsonb,
  data_window_start date NOT NULL,
  data_window_end date NOT NULL,
  cohort_filters jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN (
    'candidate', 'under_review', 'research_signal',
    'clinical_signal', 'rejected', 'retired'
  )),
  novelty_score numeric CHECK (novelty_score BETWEEN 0 AND 1),
  existing_rule_overlap jsonb DEFAULT '[]',
  patient_visible_statistics boolean DEFAULT false,
  miner_run_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dp_status ON public.discovered_patterns(status);
CREATE INDEX IF NOT EXISTS idx_dp_q_value ON public.discovered_patterns(q_value);
CREATE INDEX IF NOT EXISTS idx_dp_kind_status ON public.discovered_patterns(kind, status);
CREATE INDEX IF NOT EXISTS idx_dp_novelty ON public.discovered_patterns(novelty_score DESC) WHERE status IN ('candidate', 'under_review');

CREATE TRIGGER set_discovered_patterns_updated_at BEFORE UPDATE ON public.discovered_patterns
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ============================================================
-- 2. Per-patient evidence
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pattern_observations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pattern_id uuid NOT NULL REFERENCES public.discovered_patterns(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  observation_window_start date NOT NULL,
  observation_window_end date NOT NULL,
  left_value numeric,
  right_value numeric,
  supporting_data jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_po_pattern ON public.pattern_observations(pattern_id);
CREATE INDEX IF NOT EXISTS idx_po_patient ON public.pattern_observations(patient_id);

-- ============================================================
-- 3. LLM hypotheses (one row per paradigm per pattern)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pattern_hypotheses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pattern_id uuid NOT NULL REFERENCES public.discovered_patterns(id) ON DELETE CASCADE,
  paradigm text NOT NULL CHECK (paradigm IN (
    'western', 'functional', 'naturopathic', 'tcm',
    'ayurvedic', 'biohacking', 'synergistic'
  )),
  mechanism text NOT NULL,
  rationale text NOT NULL,
  supporting_references text[] DEFAULT '{}',
  safety_concerns text[] DEFAULT '{}',
  referenced_paradigms text[] DEFAULT '{}',
  paradigm_conflicts text,
  recommended_lens_weighting jsonb,
  safety_override text,
  llm_confidence numeric CHECK (llm_confidence BETWEEN 0 AND 1),
  model text NOT NULL,
  system_prompt_version text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  generated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ph_pattern ON public.pattern_hypotheses(pattern_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ph_pattern_paradigm ON public.pattern_hypotheses(pattern_id, paradigm);

-- ============================================================
-- 4. Per-practitioner paradigm preferences
-- ============================================================

CREATE TABLE IF NOT EXISTS public.practitioner_paradigm_prefs (
  practitioner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  default_paradigms text[] NOT NULL DEFAULT ARRAY['western','functional','synergistic'],
  always_include_synergistic boolean DEFAULT true,
  patient_overrides jsonb DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);

CREATE TRIGGER set_prac_paradigm_prefs_updated_at BEFORE UPDATE ON public.practitioner_paradigm_prefs
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ============================================================
-- 5. Review trail
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pattern_reviews (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pattern_id uuid NOT NULL REFERENCES public.discovered_patterns(id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN (
    'promote_research', 'promote_clinical', 'reject', 'retire', 'comment',
    'request_regenerate', 'add_paradigm'
  )),
  from_status text,
  to_status text,
  notes text,
  paradigm_scores jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pr_pattern ON public.pattern_reviews(pattern_id);
CREATE INDEX IF NOT EXISTS idx_pr_reviewer ON public.pattern_reviews(reviewer_id, created_at DESC);

-- ============================================================
-- 6. Patient exposure tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS public.patient_pattern_exposures (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern_id uuid NOT NULL REFERENCES public.discovered_patterns(id) ON DELETE CASCADE,
  shown_at timestamptz DEFAULT now(),
  consent_version text NOT NULL,
  acknowledged_experimental boolean DEFAULT false,
  acknowledged_at timestamptz,
  hidden_paradigms text[] DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ppe_patient_pattern ON public.patient_pattern_exposures(patient_id, pattern_id);

-- ============================================================
-- 7. Miner run audit log
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pattern_miner_runs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  triggered_by uuid REFERENCES auth.users(id),
  cohort_size integer,
  candidates_considered integer,
  candidates_passed_filter integer,
  candidates_passed_fdr integer,
  candidates_upserted integer,
  duration_ms integer,
  error_message text,
  config jsonb
);

CREATE INDEX IF NOT EXISTS idx_miner_runs_started ON public.pattern_miner_runs(started_at DESC);

-- ============================================================
-- 8. Symptom embeddings (only if pgvector is available)
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS public.symptom_embeddings (
      symptom_id uuid PRIMARY KEY,
      patient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
      text_repr text NOT NULL,
      embedding vector(1536),
      created_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_symptom_embeddings_patient ON public.symptom_embeddings(patient_id);
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_symptom_embeddings_vector
        ON public.symptom_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not create ivfflat index; will fall back to sequential scan';
    END;
  END IF;
END $$;

-- ============================================================
-- 9. Feature flags seed
-- ============================================================

INSERT INTO public.feature_flags (key, description) VALUES
  ('pattern_discovery_engine',
   'Enable the statistical miner + LLM hypothesizer. Default off until validated.'),
  ('pattern_surface_to_patients',
   'Allow promoted patterns to surface to opted-in patients under the "experimental insights" screen.'),
  ('pattern_kill_switch',
   'Emergency pause for all new miner runs and LLM hypothesizer calls. Already-promoted patterns remain visible.'),
  ('effectiveness_personalization',
   'Use intervention_effectiveness data to rank protocol builder candidates and surface "what worked for you" lists.')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 10. Intervention effectiveness engine (Phase 7)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.intervention_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  intervention_type text NOT NULL CHECK (intervention_type IN (
    'supplement', 'peptide', 'protocol', 'lifestyle_task', 'diet_change'
  )),
  intervention_id uuid NOT NULL,
  intervention_label text NOT NULL,
  event text NOT NULL CHECK (event IN ('start', 'stop', 'dose_change', 'pause', 'resume')),
  dose_snapshot jsonb,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  concurrent_interventions jsonb DEFAULT '[]',
  notes text,
  source text DEFAULT 'user',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ie_patient_type ON public.intervention_events(patient_id, intervention_type);
CREATE INDEX IF NOT EXISTS idx_ie_intervention ON public.intervention_events(intervention_id);
CREATE INDEX IF NOT EXISTS idx_ie_started ON public.intervention_events(started_at);

CREATE TABLE IF NOT EXISTS public.intervention_outcomes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  intervention_event_id uuid NOT NULL REFERENCES public.intervention_events(id) ON DELETE CASCADE,
  outcome_type text NOT NULL CHECK (outcome_type IN ('biomarker', 'symptom', 'wearable_score', 'composite')),
  outcome_id text NOT NULL,
  baseline_window_days integer NOT NULL,
  response_window_days integer NOT NULL,
  baseline_value numeric,
  response_value numeric,
  delta numeric,
  delta_pct numeric,
  direction text CHECK (direction IN ('improved', 'worsened', 'unchanged', 'inconclusive')),
  effect_size numeric,
  n_baseline_datapoints integer,
  n_response_datapoints integer,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'insufficient_data')),
  confound_flags text[] DEFAULT '{}',
  computed_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_io_event ON public.intervention_outcomes(intervention_event_id);
CREATE INDEX IF NOT EXISTS idx_io_outcome ON public.intervention_outcomes(outcome_type, outcome_id);
CREATE INDEX IF NOT EXISTS idx_io_confidence ON public.intervention_outcomes(confidence, direction);

CREATE TABLE IF NOT EXISTS public.intervention_effectiveness (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  intervention_type text NOT NULL,
  intervention_id uuid NOT NULL,
  outcome_type text NOT NULL,
  outcome_id text NOT NULL,
  cohort_filters jsonb DEFAULT '{}',
  n_patients integer NOT NULL,
  mean_effect_size numeric,
  ci_lower numeric,
  ci_upper numeric,
  response_rate numeric,
  adverse_rate numeric,
  median_time_to_response_days integer,
  paradigm_tag text,
  last_refreshed_at timestamptz DEFAULT now()
);

-- Unique by full combo including cohort_filters so we can store
-- multiple cohort breakdowns for the same intervention × outcome pair.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ief_unique
  ON public.intervention_effectiveness(intervention_type, intervention_id, outcome_type, outcome_id, (cohort_filters::text));
CREATE INDEX IF NOT EXISTS idx_ief_intervention ON public.intervention_effectiveness(intervention_id);
CREATE INDEX IF NOT EXISTS idx_ief_outcome_rank ON public.intervention_effectiveness(outcome_type, outcome_id, response_rate DESC);

-- Effectiveness-specific LLM interpretations (mirrors pattern_hypotheses shape)
CREATE TABLE IF NOT EXISTS public.intervention_outcome_hypotheses (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_type text NOT NULL CHECK (source_type IN ('patient_outcome', 'cohort_effectiveness')),
  source_id uuid NOT NULL,
  paradigm text NOT NULL CHECK (paradigm IN (
    'western', 'functional', 'naturopathic', 'tcm',
    'ayurvedic', 'biohacking', 'synergistic'
  )),
  plausibility text CHECK (plausibility IN ('plausible', 'unlikely', 'needs_investigation')),
  mechanism text NOT NULL,
  rationale text NOT NULL,
  responder_hypothesis text,
  suggested_validation text,
  llm_confidence numeric,
  model text NOT NULL,
  system_prompt_version text NOT NULL,
  generated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ioh_source ON public.intervention_outcome_hypotheses(source_type, source_id);

-- ============================================================
-- 11. Row Level Security
-- ============================================================

ALTER TABLE public.discovered_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pattern_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pattern_hypotheses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pattern_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_pattern_exposures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pattern_miner_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practitioner_paradigm_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intervention_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intervention_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intervention_effectiveness ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intervention_outcome_hypotheses ENABLE ROW LEVEL SECURITY;

-- Patterns: practitioners/admins see all; patients see only promoted
-- rows they've been exposed to.
CREATE POLICY dp_practitioner_all ON public.discovered_patterns FOR ALL TO authenticated
  USING (public.is_practitioner() OR public.is_admin())
  WITH CHECK (public.is_practitioner() OR public.is_admin());
CREATE POLICY dp_patient_exposed ON public.discovered_patterns FOR SELECT TO authenticated
  USING (
    status IN ('research_signal', 'clinical_signal')
    AND EXISTS (SELECT 1 FROM public.patient_pattern_exposures e
                WHERE e.patient_id = auth.uid() AND e.pattern_id = discovered_patterns.id)
  );

-- Observations: practitioners see all; patients see only their own.
CREATE POLICY po_practitioner ON public.pattern_observations FOR ALL TO authenticated
  USING (public.is_practitioner() OR public.is_admin())
  WITH CHECK (public.is_practitioner() OR public.is_admin());
CREATE POLICY po_own ON public.pattern_observations FOR SELECT TO authenticated
  USING (patient_id = auth.uid());

-- Hypotheses: practitioners unconditional; patients see only hypotheses
-- tied to a pattern they're exposed to AND not in their hidden_paradigms list.
CREATE POLICY ph_practitioner ON public.pattern_hypotheses FOR ALL TO authenticated
  USING (public.is_practitioner() OR public.is_admin())
  WITH CHECK (public.is_practitioner() OR public.is_admin());
CREATE POLICY ph_patient ON public.pattern_hypotheses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.discovered_patterns p
      JOIN public.patient_pattern_exposures e ON e.pattern_id = p.id
      WHERE p.id = pattern_id
        AND p.status IN ('research_signal', 'clinical_signal')
        AND e.patient_id = auth.uid()
        AND NOT (paradigm = ANY (COALESCE(e.hidden_paradigms, ARRAY[]::text[])))
    )
  );

-- Reviews: practitioners only.
CREATE POLICY pr_practitioner ON public.pattern_reviews FOR ALL TO authenticated
  USING (public.is_practitioner() OR public.is_admin())
  WITH CHECK (public.is_practitioner() OR public.is_admin());

-- Exposures: patient manages own; practitioner reads all.
CREATE POLICY ppe_own ON public.patient_pattern_exposures FOR ALL TO authenticated
  USING (patient_id = auth.uid())
  WITH CHECK (patient_id = auth.uid());
CREATE POLICY ppe_practitioner_read ON public.patient_pattern_exposures FOR SELECT TO authenticated
  USING (public.is_practitioner() OR public.is_admin());

-- Miner runs: practitioner/admin only.
CREATE POLICY pmr_practitioner ON public.pattern_miner_runs FOR ALL TO authenticated
  USING (public.is_practitioner() OR public.is_admin())
  WITH CHECK (public.is_practitioner() OR public.is_admin());

-- Paradigm prefs: owner or admin.
CREATE POLICY ppp_own ON public.practitioner_paradigm_prefs FOR ALL TO authenticated
  USING (practitioner_id = auth.uid() OR public.is_admin())
  WITH CHECK (practitioner_id = auth.uid() OR public.is_admin());

-- Intervention events: patient owns own, practitioner reads all.
CREATE POLICY ie_own ON public.intervention_events FOR ALL TO authenticated
  USING (patient_id = auth.uid())
  WITH CHECK (patient_id = auth.uid());
CREATE POLICY ie_practitioner_read ON public.intervention_events FOR SELECT TO authenticated
  USING (public.is_practitioner() OR public.is_admin());

-- Intervention outcomes: computed server-side. Patient reads own
-- (via event join), practitioner reads all.
CREATE POLICY io_practitioner ON public.intervention_outcomes FOR ALL TO authenticated
  USING (public.is_practitioner() OR public.is_admin())
  WITH CHECK (public.is_practitioner() OR public.is_admin());
CREATE POLICY io_own_read ON public.intervention_outcomes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.intervention_events ie
    WHERE ie.id = intervention_event_id AND ie.patient_id = auth.uid()
  ));

-- Effectiveness aggregate: readable by all authenticated users (it's
-- anonymized by design), writable only by practitioner/admin.
CREATE POLICY ief_read_all ON public.intervention_effectiveness FOR SELECT TO authenticated USING (true);
CREATE POLICY ief_practitioner_write ON public.intervention_effectiveness FOR INSERT TO authenticated
  WITH CHECK (public.is_practitioner() OR public.is_admin());
CREATE POLICY ief_practitioner_update ON public.intervention_effectiveness FOR UPDATE TO authenticated
  USING (public.is_practitioner() OR public.is_admin())
  WITH CHECK (public.is_practitioner() OR public.is_admin());

-- Outcome hypotheses: practitioner only for writes, same for reads
-- (patients shouldn't see raw LLM interpretations of effectiveness data).
CREATE POLICY ioh_practitioner ON public.intervention_outcome_hypotheses FOR ALL TO authenticated
  USING (public.is_practitioner() OR public.is_admin())
  WITH CHECK (public.is_practitioner() OR public.is_admin());

-- Symptom embeddings RLS if table exists.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'symptom_embeddings') THEN
    EXECUTE 'ALTER TABLE public.symptom_embeddings ENABLE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY se_own ON public.symptom_embeddings FOR ALL TO authenticated
             USING (patient_id = auth.uid()) WITH CHECK (patient_id = auth.uid())';
    EXECUTE 'CREATE POLICY se_practitioner ON public.symptom_embeddings FOR SELECT TO authenticated
             USING (public.is_practitioner() OR public.is_admin())';
  END IF;
END $$;
