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

  // Open Junction Link for cloud providers
  try {
    await openProviderLink();
  } catch (err) {
    console.log('[Health] Link flow completed or cancelled', err);
  }

  // Refresh the connection list in Supabase
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
): Promise<any[]> {
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
  return data ?? [];
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
