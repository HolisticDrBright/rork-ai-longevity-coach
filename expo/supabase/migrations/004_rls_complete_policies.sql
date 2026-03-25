-- ============================================================
-- AI Longevity Pro - Complete RLS Policies
-- Run this AFTER 002_rls_policies.sql and 003_clinic_tables.sql
--
-- 002 already created most policies but left gaps:
--   - Several tables missing DELETE policies
--   - raw_health_events missing UPDATE/DELETE
--   - Some rollup tables missing DELETE
--
-- This migration adds the MISSING policies only.
-- Uses IF NOT EXISTS pattern via DO blocks to be idempotent.
-- ============================================================

-- ============================================================
-- raw_health_events: add UPDATE + DELETE
-- (002 only gave SELECT + INSERT)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'raw_health_events' AND policyname = 'Own data update'
  ) THEN
    CREATE POLICY "Own data update" ON public.raw_health_events
      FOR UPDATE USING (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'raw_health_events' AND policyname = 'Own data delete'
  ) THEN
    CREATE POLICY "Own data delete" ON public.raw_health_events
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- daily_nutrition_rollups: add DELETE
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'daily_nutrition_rollups' AND policyname = 'Own data delete'
  ) THEN
    CREATE POLICY "Own data delete" ON public.daily_nutrition_rollups
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- daily_supplement_rollups: add DELETE
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'daily_supplement_rollups' AND policyname = 'Own data delete'
  ) THEN
    CREATE POLICY "Own data delete" ON public.daily_supplement_rollups
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- daily_subjective_rollups: add DELETE
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'daily_subjective_rollups' AND policyname = 'Own data delete'
  ) THEN
    CREATE POLICY "Own data delete" ON public.daily_subjective_rollups
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- daily_baselines: add DELETE
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'daily_baselines' AND policyname = 'Own data delete'
  ) THEN
    CREATE POLICY "Own data delete" ON public.daily_baselines
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- daily_scores: add DELETE
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'daily_scores' AND policyname = 'Own data delete'
  ) THEN
    CREATE POLICY "Own data delete" ON public.daily_scores
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- detected_patterns: add UPDATE + DELETE
-- (002 only gave SELECT + INSERT)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'detected_patterns' AND policyname = 'Own data update'
  ) THEN
    CREATE POLICY "Own data update" ON public.detected_patterns
      FOR UPDATE USING (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'detected_patterns' AND policyname = 'Own data delete'
  ) THEN
    CREATE POLICY "Own data delete" ON public.detected_patterns
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- correlations: add UPDATE + DELETE
-- (002 only gave SELECT + INSERT)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'correlations' AND policyname = 'Own data update'
  ) THEN
    CREATE POLICY "Own data update" ON public.correlations
      FOR UPDATE USING (user_id = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'correlations' AND policyname = 'Own data delete'
  ) THEN
    CREATE POLICY "Own data delete" ON public.correlations
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- daily_recommendations: add DELETE
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'daily_recommendations' AND policyname = 'Own data delete'
  ) THEN
    CREATE POLICY "Own data delete" ON public.daily_recommendations
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- practitioner_flags: add DELETE
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'practitioner_flags' AND policyname = 'Own data delete'
  ) THEN
    CREATE POLICY "Own data delete" ON public.practitioner_flags
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- notification_queue: add DELETE
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'notification_queue' AND policyname = 'Own data delete'
  ) THEN
    CREATE POLICY "Own data delete" ON public.notification_queue
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- app_settings: add DELETE
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'app_settings' AND policyname = 'Own data delete'
  ) THEN
    CREATE POLICY "Own data delete" ON public.app_settings
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- subscriptions: add DELETE
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'Own data delete'
  ) THEN
    CREATE POLICY "Own data delete" ON public.subscriptions
      FOR DELETE USING (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- VERIFICATION QUERY (run after migration to confirm coverage)
-- Uncomment and run manually to verify all tables have
-- SELECT, INSERT, UPDATE, DELETE policies.
-- ============================================================
-- SELECT
--   schemaname,
--   tablename,
--   policyname,
--   cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, cmd;
