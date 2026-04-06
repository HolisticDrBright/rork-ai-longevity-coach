-- Doctor Report Generation & Tracking
CREATE TABLE IF NOT EXISTS public.doctor_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type text NOT NULL CHECK (report_type IN ('comprehensive', 'alert_specific', 'lab_summary', 'custom')),
  alert_id uuid,
  title text NOT NULL,
  date_range_start date,
  date_range_end date,
  sections_included text[] NOT NULL,
  report_data jsonb NOT NULL DEFAULT '{}',
  emailed_to text,
  emailed_at timestamptz,
  shared_via text CHECK (shared_via IN ('email', 'download', 'in_app_message', 'print')),
  status text DEFAULT 'generated' CHECK (status IN ('generating', 'generated', 'sent', 'failed')),
  generated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.doctor_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own reports"
  ON public.doctor_reports FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own reports"
  ON public.doctor_reports FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own reports"
  ON public.doctor_reports FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users delete own reports"
  ON public.doctor_reports FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Practitioners read patient reports"
  ON public.doctor_reports FOR SELECT
  USING (public.is_practitioner());

CREATE INDEX idx_doctor_reports_user ON public.doctor_reports(user_id);
CREATE INDEX idx_doctor_reports_type ON public.doctor_reports(user_id, report_type);
