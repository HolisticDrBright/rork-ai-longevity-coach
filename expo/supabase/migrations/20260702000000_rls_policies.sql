-- ============================================================================
-- RLS policies for all application tables.
--
-- IMPORTANT: review against the live schema before deploy. The repo's schema
-- migration is empty, so every block below is guarded with to_regclass() and
-- only runs when the table actually exists. Policies are dropped and
-- re-created, so this migration is idempotent and safe to re-run.
--
-- NOTE: the service-role key BYPASSES RLS entirely (edge functions using
-- SUPABASE_SERVICE_ROLE_KEY are unaffected). These policies protect access
-- through the anon/authenticated keys, i.e. the mobile app and the tRPC
-- backend which forward user JWTs.
--
-- Ownership model:
--   * clinic_* data tables ......... clinician_id = auth.uid()
--   * profiles ..................... id = auth.uid()
--   * user-scoped tables ........... user_id = auth.uid()
--   * clinic reference tables ...... read-only for authenticated users
-- ============================================================================

-- ─────────────────────────────────────────────────────────────
-- Clinic tables keyed on clinician_id
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'clinic_patients',
    'clinic_lab_documents',
    'clinic_lab_results',
    'clinic_biometric_readings',
    'clinic_patient_thresholds',
    'clinic_alert_rules',
    'clinic_alert_events',
    -- both spellings guarded; the backend code writes to clinic_health_histories
    'clinic_health_history',
    'clinic_health_histories'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_select_own', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (clinician_id = auth.uid())',
        tbl || '_select_own', tbl);

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_insert_own', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (clinician_id = auth.uid())',
        tbl || '_insert_own', tbl);

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_update_own', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (clinician_id = auth.uid()) WITH CHECK (clinician_id = auth.uid())',
        tbl || '_update_own', tbl);

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_delete_own', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (clinician_id = auth.uid())',
        tbl || '_delete_own', tbl);
    END IF;
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────
-- profiles: keyed on id = auth.uid()
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
    CREATE POLICY profiles_select_own ON public.profiles
      FOR SELECT TO authenticated USING (id = auth.uid());

    DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
    CREATE POLICY profiles_insert_own ON public.profiles
      FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

    DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
    CREATE POLICY profiles_update_own ON public.profiles
      FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

    DROP POLICY IF EXISTS profiles_delete_own ON public.profiles;
    CREATE POLICY profiles_delete_own ON public.profiles
      FOR DELETE TO authenticated USING (id = auth.uid());
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────
-- User-scoped tables keyed on user_id = auth.uid()
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'wearable_connections',
    'daily_biometric_records',
    'raw_health_events',
    'meal_logs',
    'symptom_logs',
    'lab_panels',
    'protocols',
    'hormone_entries',
    'webhook_events'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_select_own', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = auth.uid())',
        tbl || '_select_own', tbl);

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_insert_own', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid())',
        tbl || '_insert_own', tbl);

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_update_own', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())',
        tbl || '_update_own', tbl);

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_delete_own', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (user_id = auth.uid())',
        tbl || '_delete_own', tbl);
    END IF;
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────
-- Reference tables: read-only for authenticated users
-- (no INSERT/UPDATE/DELETE policies — writes only via service role)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'clinic_biometric_types',
    'clinic_lab_tests'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_read_authenticated', tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
        tbl || '_read_authenticated', tbl);
    END IF;
  END LOOP;
END
$$;
