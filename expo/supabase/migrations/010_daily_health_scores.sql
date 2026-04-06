-- Daily Health Score tracking
-- Tracks daily wellness composite score from biometrics, adherence, and lifestyle

CREATE TABLE IF NOT EXISTS public.daily_health_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  components jsonb NOT NULL DEFAULT '{}',
  component_count integer DEFAULT 0,
  calculated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE public.daily_health_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own health scores"
  ON public.daily_health_scores FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own health scores"
  ON public.daily_health_scores FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own health scores"
  ON public.daily_health_scores FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Practitioners read patient health scores"
  ON public.daily_health_scores FOR SELECT
  USING (public.is_practitioner());

CREATE INDEX idx_health_scores_user ON public.daily_health_scores(user_id);
CREATE INDEX idx_health_scores_date ON public.daily_health_scores(user_id, date);
