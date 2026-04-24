-- ============================================================
-- AI Longevity Pro — Wearable Data Ingestion (Junction/Vital)
-- Migration 011: ALTER existing tables only — no new tables
-- ============================================================

-- 1. Extend wearable_connections for Junction source tracking
ALTER TABLE public.wearable_connections
  ADD COLUMN IF NOT EXISTS source_system text DEFAULT 'direct'
    CHECK (source_system IN ('direct', 'junction'));

-- 2. Extend raw_health_events for source discrimination + idempotent upserts
--    source column distinguishes 'junction:healthkit', 'junction:oura', 'junction:fitbit', etc.
ALTER TABLE public.raw_health_events
  ADD COLUMN IF NOT EXISTS source text;

-- Default existing rows to provider value
UPDATE public.raw_health_events
  SET source = provider
  WHERE source IS NULL;

-- 3. Unique partial index for idempotent webhook/sync upserts.
--    Only applies when provider_record_id is present (some local entries may not have one).
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_health_events_dedup
  ON public.raw_health_events(user_id, provider, record_type, recorded_at, provider_record_id)
  WHERE provider_record_id IS NOT NULL;

-- 4. Add an index on source for faster filtered queries by data path
CREATE INDEX IF NOT EXISTS idx_raw_health_events_source
  ON public.raw_health_events(source);

-- 5. Profile column for onboarding "Connect a device" skip state
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS wearable_onboarding_completed boolean DEFAULT false;
