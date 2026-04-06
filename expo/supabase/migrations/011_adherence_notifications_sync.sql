-- ============================================================
-- Supplement Adherence, Notifications, Wearable Sync, Account Management
-- ============================================================

-- Supplement adherence tracking
CREATE TABLE IF NOT EXISTS public.supplement_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplement_name text NOT NULL,
  dosage text,
  scheduled_time text, -- 'morning', 'afternoon', 'evening', 'bedtime'
  taken_at timestamptz,
  skipped boolean DEFAULT false,
  notes text,
  date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.supplement_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own supplement logs"
  ON public.supplement_logs FOR ALL
  USING (user_id = auth.uid());

CREATE INDEX idx_supplement_logs_user_date ON public.supplement_logs(user_id, date);

-- Supplement schedules (what user should take daily)
CREATE TABLE IF NOT EXISTS public.supplement_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  supplement_name text NOT NULL,
  dosage text NOT NULL,
  frequency text DEFAULT 'daily' CHECK (frequency IN ('daily', 'twice_daily', 'weekly', 'as_needed')),
  time_of_day text DEFAULT 'morning' CHECK (time_of_day IN ('morning', 'afternoon', 'evening', 'bedtime')),
  is_active boolean DEFAULT true,
  start_date date DEFAULT CURRENT_DATE,
  end_date date,
  prescribed_by text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.supplement_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own supplement schedules"
  ON public.supplement_schedules FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Practitioners read patient schedules"
  ON public.supplement_schedules FOR SELECT
  USING (public.is_practitioner());

CREATE INDEX idx_supplement_schedules_user ON public.supplement_schedules(user_id, is_active);

CREATE TRIGGER set_supplement_schedules_updated_at
  BEFORE UPDATE ON public.supplement_schedules
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Push notification preferences & queue
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  push_enabled boolean DEFAULT true,
  alert_urgent boolean DEFAULT true,
  alert_attention boolean DEFAULT true,
  alert_informational boolean DEFAULT false,
  daily_insight boolean DEFAULT true,
  supplement_reminders boolean DEFAULT true,
  score_updates boolean DEFAULT false,
  quiet_hours_start text DEFAULT '22:00',
  quiet_hours_end text DEFAULT '07:00',
  timezone text DEFAULT 'UTC',
  expo_push_token text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own notification prefs"
  ON public.notification_preferences FOR ALL
  USING (user_id = auth.uid());

CREATE TRIGGER set_notification_prefs_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Wearable sync log (tracks last sync per provider)
CREATE TABLE IF NOT EXISTS public.wearable_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('apple_health', 'oura', 'whoop', 'fitbit', 'garmin')),
  records_synced integer DEFAULT 0,
  last_sync_at timestamptz DEFAULT now(),
  sync_status text DEFAULT 'success' CHECK (sync_status IN ('success', 'partial', 'failed')),
  error_message text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, provider)
);

ALTER TABLE public.wearable_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own sync log"
  ON public.wearable_sync_log FOR ALL
  USING (user_id = auth.uid());

-- Data export requests (GDPR/CCPA)
CREATE TABLE IF NOT EXISTS public.data_export_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('export', 'delete')),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  export_data jsonb,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.data_export_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own export requests"
  ON public.data_export_requests FOR ALL
  USING (user_id = auth.uid());

CREATE INDEX idx_export_requests_user ON public.data_export_requests(user_id, status);
