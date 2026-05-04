-- ============================================================
-- AI Longevity Pro — Webhook Events Table
-- Migration 012: Store app webhook events in Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  processed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_type ON public.webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_user ON public.webhook_events(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON public.webhook_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_events_unprocessed ON public.webhook_events(processed) WHERE processed = false;

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Admins/practitioners can read all events
CREATE POLICY "webhook_events_practitioner_read" ON public.webhook_events
  FOR SELECT TO authenticated
  USING (public.is_practitioner() OR public.is_admin());

-- The edge function inserts with service role key (bypasses RLS)
-- Patients can read their own events
CREATE POLICY "webhook_events_own_read" ON public.webhook_events
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
