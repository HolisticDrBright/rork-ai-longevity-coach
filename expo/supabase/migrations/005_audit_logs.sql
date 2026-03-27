-- ============================================================
-- AI Longevity Pro - Server-Side Audit Logs
-- Immutable audit trail for PHI access and mutations.
-- Run AFTER 004_rls_complete_policies.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.clinic_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'PHI_ACCESS', 'PHI_UPDATE', 'DATA_EXPORT',
    'AUTH_LOGIN', 'AUTH_LOGOUT', 'AUTH_FAILED'
  )),
  resource text NOT NULL,
  patient_id uuid,
  http_method text,
  http_status integer,
  duration_ms integer,
  ip_address text,
  user_agent text,
  details jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Audit logs are append-only: no UPDATE or DELETE allowed via RLS.
ALTER TABLE public.clinic_audit_logs ENABLE ROW LEVEL SECURITY;

-- Clinicians can INSERT their own audit entries
CREATE POLICY "Clinicians insert own audit logs"
  ON public.clinic_audit_logs FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Clinicians can read their own audit logs
CREATE POLICY "Clinicians read own audit logs"
  ON public.clinic_audit_logs FOR SELECT
  USING (user_id = auth.uid());

-- Admins can read all audit logs
CREATE POLICY "Admins read all audit logs"
  ON public.clinic_audit_logs FOR SELECT
  USING (public.is_admin());

-- NO UPDATE or DELETE policies — audit logs are immutable

-- Performance indexes
CREATE INDEX idx_audit_logs_user ON public.clinic_audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON public.clinic_audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON public.clinic_audit_logs(resource);
CREATE INDEX idx_audit_logs_created ON public.clinic_audit_logs(created_at);
CREATE INDEX idx_audit_logs_patient ON public.clinic_audit_logs(patient_id) WHERE patient_id IS NOT NULL;

-- Partition hint: For production with high write volume, consider
-- partitioning this table by created_at (monthly or weekly).
-- ALTER TABLE public.clinic_audit_logs SET (autovacuum_vacuum_scale_factor = 0.01);
