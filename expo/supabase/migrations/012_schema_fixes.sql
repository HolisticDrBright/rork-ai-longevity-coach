-- ============================================================
-- Schema fixes from code audit
-- Adds missing indexes, audit log immutability, and FK safety
-- ============================================================

-- Missing performance indexes
CREATE INDEX IF NOT EXISTS idx_clinic_patients_email
  ON public.clinic_patients(clinician_id, email);

CREATE INDEX IF NOT EXISTS idx_clinic_alert_events_rule_id
  ON public.clinic_alert_events(rule_id);

CREATE INDEX IF NOT EXISTS idx_clinic_alert_rules_patient
  ON public.clinic_alert_rules(patient_id);

-- Audit log immutability enforcement
-- These policies explicitly deny UPDATE and DELETE on audit logs
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'clinic_audit_logs' AND policyname = 'Audit logs immutable no update'
  ) THEN
    CREATE POLICY "Audit logs immutable no update"
      ON public.clinic_audit_logs FOR UPDATE USING (false);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'clinic_audit_logs' AND policyname = 'Audit logs immutable no delete'
  ) THEN
    CREATE POLICY "Audit logs immutable no delete"
      ON public.clinic_audit_logs FOR DELETE USING (false);
  END IF;
END $$;
