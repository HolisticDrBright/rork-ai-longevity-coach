-- ============================================================
-- AI Longevity Pro - Longevity Claude A/B Infrastructure
-- Migration 008: feature flags, generation metadata, A/B eval table
-- ============================================================

-- Extend protocol rows with generation provenance ------------

ALTER TABLE public.longevity_protocols
  ADD COLUMN IF NOT EXISTS generation_method text DEFAULT 'deterministic'
    CHECK (generation_method IN ('deterministic', 'claude', 'claude_fallback')),
  ADD COLUMN IF NOT EXISTS generation_ms integer,
  ADD COLUMN IF NOT EXISTS system_prompt_version text,
  ADD COLUMN IF NOT EXISTS model text;

-- Feature flags ----------------------------------------------

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY,
  enabled_user_ids uuid[] DEFAULT '{}',
  enabled_roles text[] DEFAULT '{}',
  rollout_pct integer DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  description text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid
);

CREATE TRIGGER set_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Seed initial flags (safe default: off for everyone) --------

INSERT INTO public.feature_flags (key, description)
VALUES ('longevity_claude_generation',
  'Route longevity protocol generation through Claude via @rork-ai/toolkit-sdk instead of the deterministic engine. Falls back to deterministic on failure.')
ON CONFLICT (key) DO NOTHING;

-- A/B evaluation table ---------------------------------------

CREATE TABLE IF NOT EXISTS public.longevity_ab_evaluations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_fixture_id text NOT NULL,
  deterministic jsonb NOT NULL,
  claude jsonb NOT NULL,
  deterministic_generation_ms integer,
  claude_generation_ms integer,
  claude_model text,
  claude_system_prompt_version text,
  reviewer_id uuid,
  reviewer_notes text,
  reviewer_score integer CHECK (reviewer_score BETWEEN 1 AND 5),
  reviewer_winner text CHECK (reviewer_winner IN ('deterministic', 'claude', 'tie', 'neither')),
  generated_at timestamptz DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ab_evaluations_fixture ON public.longevity_ab_evaluations(patient_fixture_id);
CREATE INDEX IF NOT EXISTS idx_ab_evaluations_generated ON public.longevity_ab_evaluations(generated_at DESC);

-- Row Level Security -----------------------------------------

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.longevity_ab_evaluations ENABLE ROW LEVEL SECURITY;

-- Flags: any authenticated user can read (needed for flag checks),
-- only admins can write.
CREATE POLICY "feature_flags_select" ON public.feature_flags
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "feature_flags_admin_write" ON public.feature_flags
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- A/B evaluations: practitioners/admins only
CREATE POLICY "ab_evaluations_practitioner_select" ON public.longevity_ab_evaluations
  FOR SELECT TO authenticated
  USING (public.is_practitioner() OR public.is_admin());
CREATE POLICY "ab_evaluations_practitioner_write" ON public.longevity_ab_evaluations
  FOR ALL TO authenticated
  USING (public.is_practitioner() OR public.is_admin())
  WITH CHECK (public.is_practitioner() OR public.is_admin());
