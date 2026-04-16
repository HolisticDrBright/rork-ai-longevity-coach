-- ============================================================
-- AI Longevity Pro - Longevity Protocol Module
-- Migration 007: 6-month hallmarks-of-aging protocol system
-- ============================================================

CREATE TABLE IF NOT EXISTS public.longevity_intakes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  biological_age numeric,
  chronological_age integer,
  weight_current numeric,
  weight_ideal numeric,
  height numeric,
  sex text CHECK (sex IN ('female', 'male', 'other')),
  menstrual_status text CHECK (menstrual_status IN ('pre_menopause', 'peri_menopause', 'post_menopause', 'na')),
  body_composition jsonb,
  fitness_level text CHECK (fitness_level IN ('sedentary', 'recreational', 'athletic', 'elite')),
  diet_type text CHECK (diet_type IN ('carnivore', 'paleo', 'keto', 'mediterranean', 'vegan', 'standard', 'other')),
  conditions text[] DEFAULT '{}',
  sensitivities text[] DEFAULT '{}',
  oppositions text[] DEFAULT '{}',
  longevity_goals text[] DEFAULT '{}',
  preferred_brands text[] DEFAULT '{}',
  modalities text[] DEFAULT '{}',
  top_complaints text[] DEFAULT '{}',
  lifestyle_factors text[] DEFAULT '{}',
  labs jsonb DEFAULT '{}',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.longevity_protocols (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  intake_id uuid NOT NULL REFERENCES public.longevity_intakes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version integer DEFAULT 1,
  generated_at timestamptz DEFAULT now(),
  months jsonb NOT NULL,
  summary jsonb NOT NULL,
  pulsing_calendar jsonb DEFAULT '[]',
  safety_notes text[] DEFAULT '{}',
  practitioner_review_required text[] DEFAULT '{}',
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'approved', 'active', 'completed', 'archived')),
  practitioner_notes text,
  practitioner_approved boolean DEFAULT false,
  approved_at timestamptz,
  approved_by uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.longevity_protocol_progress (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  protocol_id uuid NOT NULL REFERENCES public.longevity_protocols(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 6),
  day integer,
  item_key text NOT NULL,
  item_category text CHECK (item_category IN ('supplement', 'peptide', 'fasting', 'exercise', 'modality', 'lifestyle', 'lab')),
  taken boolean DEFAULT false,
  notes text,
  logged_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_longevity_intakes_user ON public.longevity_intakes(user_id);
CREATE INDEX IF NOT EXISTS idx_longevity_protocols_user ON public.longevity_protocols(user_id);
CREATE INDEX IF NOT EXISTS idx_longevity_protocols_intake ON public.longevity_protocols(intake_id);
CREATE INDEX IF NOT EXISTS idx_longevity_protocols_status ON public.longevity_protocols(user_id, status);
CREATE INDEX IF NOT EXISTS idx_longevity_progress_protocol ON public.longevity_protocol_progress(protocol_id);
CREATE INDEX IF NOT EXISTS idx_longevity_progress_user_month ON public.longevity_protocol_progress(user_id, month);

-- Updated_at triggers
CREATE TRIGGER set_longevity_intakes_updated_at BEFORE UPDATE ON public.longevity_intakes FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER set_longevity_protocols_updated_at BEFORE UPDATE ON public.longevity_protocols FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Row Level Security
ALTER TABLE public.longevity_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.longevity_protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.longevity_protocol_progress ENABLE ROW LEVEL SECURITY;

-- Intake policies
CREATE POLICY "longevity_intakes_select" ON public.longevity_intakes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_practitioner() OR public.is_admin());
CREATE POLICY "longevity_intakes_insert" ON public.longevity_intakes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "longevity_intakes_update" ON public.longevity_intakes FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_practitioner() OR public.is_admin());
CREATE POLICY "longevity_intakes_delete" ON public.longevity_intakes FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- Protocol policies
CREATE POLICY "longevity_protocols_select" ON public.longevity_protocols FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_practitioner() OR public.is_admin());
CREATE POLICY "longevity_protocols_insert" ON public.longevity_protocols FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "longevity_protocols_update" ON public.longevity_protocols FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_practitioner() OR public.is_admin());
CREATE POLICY "longevity_protocols_delete" ON public.longevity_protocols FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- Progress policies
CREATE POLICY "longevity_progress_select" ON public.longevity_protocol_progress FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_practitioner() OR public.is_admin());
CREATE POLICY "longevity_progress_insert" ON public.longevity_protocol_progress FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "longevity_progress_update" ON public.longevity_protocol_progress FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
