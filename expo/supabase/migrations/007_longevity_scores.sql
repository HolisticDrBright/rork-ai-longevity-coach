-- Longevity Score & Biological Age tracking
CREATE TABLE IF NOT EXISTS public.longevity_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  biological_age integer,
  chronological_age integer,
  component_scores jsonb NOT NULL DEFAULT '{}',
  lab_count integer DEFAULT 0,
  biometric_count integer DEFAULT 0,
  calculated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, (calculated_at::date))
);

ALTER TABLE public.longevity_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own longevity scores"
  ON public.longevity_scores FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own longevity scores"
  ON public.longevity_scores FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Practitioners read patient scores"
  ON public.longevity_scores FOR SELECT
  USING (public.is_practitioner());

CREATE INDEX idx_longevity_scores_user ON public.longevity_scores(user_id);
CREATE INDEX idx_longevity_scores_date ON public.longevity_scores(user_id, calculated_at);
