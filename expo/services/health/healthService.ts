/**
 * Unified health service — public API.
 *
 * The app imports ONLY from this file. Never import junctionClient directly.
 * This keeps the provider adapter swappable if we ever move off Junction.
 */

import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import {
  initializeJunction,
  requestHealthPermissions,
  hasHealthPermissions,
  openProviderLink,
  disconnectProvider as junctionDisconnect,
  listConnectedProviders,
  triggerSync,
  isInitialized,
} from './junctionClient';
import type {
  ProviderConnection,
  SyncResult,
} from './types';
import type { DailyBiometricRecord } from '@/types/wearables';

/**
 * Map a Supabase row (snake_case) → DailyBiometricRecord (camelCase).
 * This is the typing boundary: nothing downstream sees `any`.
 */
function mapDbRowToDailyBiometricRecord(row: Record<string, unknown>): DailyBiometricRecord {
  return {
    id: String(row.id ?? ''),
    userId: String(row.user_id ?? ''),
    source: (row.primary_source ?? 'manual') as any,
    date: String(row.date ?? ''),
    sleepDurationMinutes: row.sleep_duration_minutes as number | null ?? null,
    sleepEfficiency: row.sleep_efficiency as number | null ?? null,
    deepSleepMinutes: row.deep_sleep_minutes as number | null ?? null,
    remSleepMinutes: row.rem_sleep_minutes as number | null ?? null,
    lightSleepMinutes: row.light_sleep_minutes as number | null ?? null,
    sleepLatencyMinutes: row.sleep_latency_minutes as number | null ?? null,
    wakeAfterSleepOnset: row.wake_after_sleep_onset_minutes as number | null ?? null,
    awakenings: row.awakenings as number | null ?? null,
    sleepScore: row.sleep_score as number | null ?? null,
    bedtime: row.bedtime as string | null ?? null,
    wakeTime: row.wake_time as string | null ?? null,
    hrv: row.hrv as number | null ?? null,
    restingHr: row.resting_hr as number | null ?? null,
    avgHr: row.avg_hr as number | null ?? null,
    nighttimeHr: null,
    respiratoryRate: row.respiratory_rate as number | null ?? null,
    tempDeviation: row.temp_deviation as number | null ?? null,
    skinTemp: null,
    readinessScore: row.readiness_score_vendor as number | null ?? null,
    stressScoreDevice: row.stress_score_vendor as number | null ?? null,
    steps: row.steps as number | null ?? null,
    distanceKm: row.distance_meters != null ? Number(row.distance_meters) / 1000 : null,
    caloriesBurned: row.calories_burned as number | null ?? null,
    activeMinutes: row.active_minutes as number | null ?? null,
    sedentaryMinutes: row.sedentary_minutes as number | null ?? null,
    vo2Max: row.vo2max as number | null ?? null,
    workoutMinutes: row.workout_minutes as number | null ?? null,
    workoutType: null,
    trainingLoad: row.training_load as number | null ?? null,
    strainScore: row.strain_score as number | null ?? null,
    weight: row.weight_kg as number | null ?? null,
    bodyFatPercent: row.body_fat_percent as number | null ?? null,
    spo2: row.spo2 as number | null ?? null,
    glucoseAvg: row.glucose_avg as number | null ?? null,
    bloodPressureSystolic: row.systolic_bp as number | null ?? null,
    bloodPressureDiastolic: row.diastolic_bp as number | null ?? null,
    cyclePhase: (row.cycle_phase ?? null) as any,
    cycleDayEstimate: null,
    hydrationMl: row.hydration_ml as number | null ?? null,
    alcoholUnits: row.alcohol_units as number | null ?? null,
    caffeineMg: row.caffeine_mg as number | null ?? null,
    caffeineLastTime: null,
    energyScore: row.energy_score_subjective as number | null ?? null,
    stressScoreSubjective: row.stress_score_subjective as number | null ?? null,
    sorenessScore: row.soreness_score_subjective as number | null ?? null,
    moodScore: row.mood_score_subjective as number | null ?? null,
    libidoScore: row.libido_score_subjective as number | null ?? null,
    bowelScore: row.bowel_score_subjective as number | null ?? null,
    cravingsScore: row.cravings_score_subjective as number | null ?? null,
    adherenceScore: row.adherence_score_raw as number | null ?? null,
    subjectiveReadiness: null,
    symptomFlags: Array.isArray(row.symptom_flags_json) ? row.symptom_flags_json : [],
    dataQualityScore: Number(row.data_quality_score ?? 0),
  };
}

/**
 * Initialize the wearable data layer. Call once after the user is authenticated.
 */
export async function initialize(userId: string): Promise<void> {
  await initializeJunction(userId);
}

/**
 * Connect a wearable device or cloud provider.
 *
 * For cloud providers (Oura, Fitbit, WHOOP, Garmin): opens Junction Link's
 * provider picker. The user selects their provider and authenticates via OAuth.
 *
 * For on-device (HealthKit / Health Connect): requests OS-level health
 * permissions through the Junction Health SDK. Data sync starts automatically.
 *
 * Both paths converge at the webhook — all data lands in raw_health_events.
 */
export async function connectDevice(): Promise<{
  success: boolean;
  permissionResult?: 'success' | 'cancelled' | 'error';
}> {
  if (!isInitialized()) {
    return { success: false };
  }

  // Always request on-device health permissions first (if not already granted)
  const hasPerms = await hasHealthPermissions();
  let permResult: 'success' | 'cancelled' | 'error' = 'success';
  if (!hasPerms) {
    permResult = await requestHealthPermissions();
    if (permResult !== 'success') {
      return { success: false, permissionResult: permResult };
    }
  }

  // Open Junction Link for cloud providers.
  // v6 Link is web-based and doesn't return which provider was connected.
  // We use write-ahead: insert a 'connecting' placeholder, then the webhook
  // updates it to 'active' when first data arrives. The UI polls
  // refreshConnectionList() to pick up the change.
  try {
    await openProviderLink();
  } catch (err) {
    console.log('[Health] Link flow completed or cancelled', err);
  }

  // Refresh immediately to pick up any new connections Junction knows about
  await refreshConnectionList();

  return { success: true, permissionResult: permResult };
}

/**
 * Disconnect a provider and update Supabase.
 */
export async function disconnectProvider(provider: string): Promise<void> {
  await junctionDisconnect(provider);
  await supabase
    .from('wearable_connections')
    .update({ status: 'revoked' })
    .eq('provider', provider);
}

/**
 * List the user's active connections from Supabase (source of truth).
 */
export async function listConnections(): Promise<ProviderConnection[]> {
  const { data } = await supabase
    .from('wearable_connections')
    .select('*')
    .order('created_at', { ascending: false });

  return (data ?? []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    sourceSystem: row.source_system ?? 'junction',
    status: row.status,
    lastSyncAt: row.last_sync_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    connectedAt: row.created_at,
  }));
}

/**
 * Sync latest connections from Junction SDK → Supabase.
 * Called after connecting / on app launch.
 */
export async function refreshConnectionList(): Promise<void> {
  const junctionProviders = await listConnectedProviders();

  for (const p of junctionProviders) {
    await supabase
      .from('wearable_connections')
      .upsert({
        provider: p.slug,
        provider_user_id: null,
        source_system: 'junction',
        status: 'active',
        last_sync_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,provider',
      });
  }
}

/**
 * Trigger a manual sync of on-device health data.
 * Junction's Health SDK pushes pending data to their servers, which
 * fires our webhook → raw_health_events → rollup → daily_biometric_records.
 */
export async function syncAll(): Promise<SyncResult> {
  if (!isInitialized()) {
    return { inserted: 0, skipped: 0, errors: ['SDK not initialized'] };
  }

  try {
    await triggerSync();
    await refreshConnectionList();
    return { inserted: 0, skipped: 0, errors: [] };
  } catch (err) {
    return { inserted: 0, skipped: 0, errors: [(err as Error).message] };
  }
}

/**
 * Get readings from Supabase (daily_biometric_records) for a date range.
 * This is the downstream-facing query — engines call this.
 */
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

/**
 * Check if user has any connected providers.
 */
export async function hasConnections(): Promise<boolean> {
  const { count } = await supabase
    .from('wearable_connections')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');
  return (count ?? 0) > 0;
}

/**
 * Whether the underlying SDK is ready.
 */
export function isReady(): boolean {
  return isInitialized();
}
