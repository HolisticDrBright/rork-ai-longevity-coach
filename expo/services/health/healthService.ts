/**
 * Unified health service — public API.
 *
 * The app imports ONLY from this file. Never import junctionClient directly.
 */

import { supabase } from '@/lib/supabase';
import { trpcClient } from '@/lib/trpc';
import {
  buildLinkUrl,
  disconnectProvider as junctionDisconnect,
  listConnectedProviders,
  triggerSync,
  isInitialized,
} from './junctionClient';
import type { ProviderConnection, SyncResult } from './types';
import type { DailyBiometricRecord } from '@/types/wearables';

const APP_SCHEME = 'rork-app';

// ────────────────────────────────────────────────────────────
// DB row → typed record mapper (typing boundary)
// ────────────────────────────────────────────────────────────

function mapDbRowToDailyBiometricRecord(row: Record<string, unknown>): DailyBiometricRecord {
  return {
    id: String(row.id ?? ''),
    userId: String(row.user_id ?? ''),
    source: (row.primary_source ?? 'manual') as DailyBiometricRecord['source'],
    date: String(row.date ?? ''),
    sleepDurationMinutes: (row.sleep_duration_minutes as number) ?? null,
    sleepEfficiency: (row.sleep_efficiency as number) ?? null,
    deepSleepMinutes: (row.deep_sleep_minutes as number) ?? null,
    remSleepMinutes: (row.rem_sleep_minutes as number) ?? null,
    lightSleepMinutes: (row.light_sleep_minutes as number) ?? null,
    sleepLatencyMinutes: (row.sleep_latency_minutes as number) ?? null,
    wakeAfterSleepOnset: (row.wake_after_sleep_onset_minutes as number) ?? null,
    awakenings: (row.awakenings as number) ?? null,
    sleepScore: (row.sleep_score as number) ?? null,
    bedtime: (row.bedtime as string) ?? null,
    wakeTime: (row.wake_time as string) ?? null,
    hrv: (row.hrv as number) ?? null,
    restingHr: (row.resting_hr as number) ?? null,
    avgHr: (row.avg_hr as number) ?? null,
    nighttimeHr: null,
    respiratoryRate: (row.respiratory_rate as number) ?? null,
    tempDeviation: (row.temp_deviation as number) ?? null,
    skinTemp: null,
    readinessScore: (row.readiness_score_vendor as number) ?? null,
    stressScoreDevice: (row.stress_score_vendor as number) ?? null,
    steps: (row.steps as number) ?? null,
    distanceKm: row.distance_meters != null ? Number(row.distance_meters) / 1000 : null,
    caloriesBurned: (row.calories_burned as number) ?? null,
    activeMinutes: (row.active_minutes as number) ?? null,
    sedentaryMinutes: (row.sedentary_minutes as number) ?? null,
    vo2Max: (row.vo2max as number) ?? null,
    workoutMinutes: (row.workout_minutes as number) ?? null,
    workoutType: null,
    trainingLoad: (row.training_load as number) ?? null,
    strainScore: (row.strain_score as number) ?? null,
    weight: (row.weight_kg as number) ?? null,
    bodyFatPercent: (row.body_fat_percent as number) ?? null,
    spo2: (row.spo2 as number) ?? null,
    glucoseAvg: (row.glucose_avg as number) ?? null,
    bloodPressureSystolic: (row.systolic_bp as number) ?? null,
    bloodPressureDiastolic: (row.diastolic_bp as number) ?? null,
    cyclePhase: (row.cycle_phase ?? null) as DailyBiometricRecord['cyclePhase'],
    cycleDayEstimate: null,
    hydrationMl: (row.hydration_ml as number) ?? null,
    alcoholUnits: (row.alcohol_units as number) ?? null,
    caffeineMg: (row.caffeine_mg as number) ?? null,
    caffeineLastTime: null,
    energyScore: (row.energy_score_subjective as number) ?? null,
    stressScoreSubjective: (row.stress_score_subjective as number) ?? null,
    sorenessScore: (row.soreness_score_subjective as number) ?? null,
    moodScore: (row.mood_score_subjective as number) ?? null,
    libidoScore: (row.libido_score_subjective as number) ?? null,
    bowelScore: (row.bowel_score_subjective as number) ?? null,
    cravingsScore: (row.cravings_score_subjective as number) ?? null,
    adherenceScore: (row.adherence_score_raw as number) ?? null,
    subjectiveReadiness: null,
    symptomFlags: Array.isArray(row.symptom_flags_json) ? row.symptom_flags_json : [],
    dataQualityScore: Number(row.data_quality_score ?? 0),
  };
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

export async function initialize(userId: string): Promise<void> {
  // no-op until native SDK is installed
}

export async function getOrCreateJunctionUser(): Promise<string | null> {
  try {
    const result = await trpcClient.junction.getOrCreateUser.mutate();
    return result.junctionUserId;
  } catch (err) {
    console.error('[Health] getOrCreateJunctionUser failed', err);
    return null;
  }
}

export async function getLinkUrl(provider: string): Promise<string | null> {
  try {
    const junctionUserId = await getOrCreateJunctionUser();
    if (!junctionUserId) {
      console.error('[Health] getLinkUrl: could not get or create Junction user');
      return null;
    }
    return await buildLinkUrl(provider);
  } catch (err) {
    console.error('[Health] getLinkUrl failed', err);
    return null;
  }
}

/**
 * Called after the WebView confirms a provider was connected.
 * Writes the connection to Supabase and refreshes the list.
 */
export async function recordConnection(providerSlug: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;
  await supabase
    .from('wearable_connections')
    .upsert({
      user_id: userId,
      provider: providerSlug,
      source_system: 'junction',
      status: 'active',
    }, { onConflict: 'user_id,provider' });
  await refreshConnectionList();
}

export async function disconnectProvider(provider: string): Promise<void> {
  await junctionDisconnect(provider);
  await supabase
    .from('wearable_connections')
    .update({ status: 'revoked' })
    .eq('provider', provider);
}

export async function listConnections(): Promise<ProviderConnection[]> {
  const { data } = await supabase
    .from('wearable_connections')
    .select('*')
    .order('created_at', { ascending: false });

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.id ?? ''),
    userId: String(row.user_id ?? ''),
    provider: String(row.provider ?? ''),
    providerUserId: (row.provider_user_id as string) ?? null,
    sourceSystem: (row.source_system as 'direct' | 'junction') ?? 'junction',
    status: (row.status as ProviderConnection['status']) ?? 'inactive',
    lastSyncAt: (row.last_sync_at as string) ?? null,
    lastSuccessfulSyncAt: (row.last_successful_sync_at as string) ?? null,
    connectedAt: String(row.created_at ?? ''),
  }));
}

/** Sync Junction SDK state → Supabase. BUG #2 FIX: explicit user_id. */
export async function refreshConnectionList(): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;

  const junctionProviders = await listConnectedProviders();
  for (const p of junctionProviders) {
    await supabase
      .from('wearable_connections')
      .upsert({
        user_id: userId,
        provider: p.slug,
        source_system: 'junction',
        status: 'active',
        last_sync_at: new Date().toISOString(),
      }, { onConflict: 'user_id,provider' });
  }
}

/**
 * Re-triggers Junction SDK sync. On first connect, pulls 180 days of
 * history (via HealthConfig.numberOfDaysToBackFill). Subsequent calls
 * fetch whatever the SDK hasn't yet synced. Data flows through the
 * webhook → raw_health_events → rollup → daily_biometric_records.
 * Idempotent upserts make re-runs safe.
 */
export async function syncAll(): Promise<SyncResult> {
  if (!isInitialized()) return { inserted: 0, skipped: 0, errors: ['SDK not initialized'] };
  try {
    await triggerSync();
    await refreshConnectionList();
    return { inserted: 0, skipped: 0, errors: [] };
  } catch (err) {
    return { inserted: 0, skipped: 0, errors: [(err as Error).message] };
  }
}

export async function getDailyRecords(
  fromDate: string,
  toDate: string,
): Promise<DailyBiometricRecord[]> {
  const { data, error } = await supabase
    .from('daily_biometric_records')
    .select('*')
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: false });

  if (error) {
    console.error('[Health] Failed to fetch daily records', error);
    return [];
  }
  return (data ?? []).map(row => mapDbRowToDailyBiometricRecord(row as Record<string, unknown>));
}

export async function hasConnections(): Promise<boolean> {
  const { count } = await supabase
    .from('wearable_connections')
    .select('*', { count: 'exact', head: true })
    .in('status', ['active', 'connecting']);
  return (count ?? 0) > 0;
}

export function isReady(): boolean {
  return isInitialized();
}
