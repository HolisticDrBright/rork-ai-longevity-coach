-- ============================================================
-- AI Longevity Pro - Month 6 Outcome Report Infrastructure
-- Migration 009: longevity_outcome_reports table + RLS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.longevity_outcome_reports (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  protocol_id uuid NOT NULL REFERENCES public.longevity_protocols(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report jsonb NOT NULL,
  narrative_summary text,
  narrative_generation_method text DEFAULT 'deterministic'
    CHECK (narrative_generation_method IN ('deterministic', 'claude', 'claude_fallback', 'practitioner_override')),
  narrative_system_prompt_version text,
  data_completeness_pct integer,
  generated_at timestamptz DEFAULT now(),
  shared_with_patient boolean DEFAULT false,
  shared_at timestamptz,
  practitioner_approved boolean DEFAULT false,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outcome_reports_user ON public.longevity_outcome_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_outcome_reports_protocol ON public.longevity_outcome_reports(protocol_id);
CREATE INDEX IF NOT EXISTS idx_outcome_reports_generated ON public.longevity_outcome_reports(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_reports_shared ON public.longevity_outcome_reports(user_id, shared_with_patient, practitioner_approved);

CREATE TRIGGER set_outcome_reports_updated_at BEFORE UPDATE ON public.longevity_outcome_reports
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.longevity_outcome_reports ENABLE ROW LEVEL SECURITY;

-- Patient can SELECT only when practitioner approved AND shared.
-- Practitioners and admins can read their assigned patients' reports unconditionally.
CREATE POLICY "outcome_reports_patient_select" ON public.longevity_outcome_reports
  FOR SELECT TO authenticated
  USING (
    (user_id = auth.uid() AND practitioner_approved = true AND shared_with_patient = true)
    OR public.is_practitioner()
    OR public.is_admin()
  );

-- Only practitioners/admins can write.
CREATE POLICY "outcome_reports_practitioner_write" ON public.longevity_outcome_reports
  FOR ALL TO authenticated
  USING (public.is_practitioner() OR public.is_admin())
  WITH CHECK (public.is_practitioner() OR public.is_admin());
