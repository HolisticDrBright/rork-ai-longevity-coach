/**
 * Junction (Vital) SDK wrapper.
 *
 * Single adapter for all wearable data. Handles:
 *   - SDK initialization
 *   - Provider connection via Vital Link
 *   - HealthKit / Health Connect permission requests (via Vital Health SDK)
 *   - On-device data sync (data flows to Junction's servers, then to our
 *     webhook — we never pull from the device directly)
 *
 * The app only ever imports from healthService.ts; this file is internal.
 */

import { Platform } from 'react-native';
import { VitalHealth, VitalResource, HealthConfig } from '@tryvital/vital-health-react-native';
import { VitalCore } from '@tryvital/vital-core-react-native';
import type { HealthSource } from './types';

const VITAL_ENVIRONMENT = (process.env.EXPO_PUBLIC_VITAL_ENVIRONMENT ?? 'sandbox') as 'sandbox' | 'production';
const VITAL_API_KEY = process.env.EXPO_PUBLIC_VITAL_API_KEY ?? '';

let initialized = false;

/**
 * Initialize the Vital SDK. Call once at app startup (after auth).
 * Must be called before any other Junction function.
 */
export async function initializeJunction(userId: string): Promise<void> {
  if (initialized) return;

  if (!VITAL_API_KEY) {
    console.warn('[Junction] EXPO_PUBLIC_VITAL_API_KEY not set — wearable features disabled');
    return;
  }

  try {
    await VitalCore.configure(VITAL_API_KEY, VITAL_ENVIRONMENT);
    await VitalCore.setUserId(userId);

    const config = new HealthConfig();
    config.numberOfDaysToBackFill = 180;
    config.logsEnabled = __DEV__;

    if (Platform.OS === 'ios') {
      config.iOSConfig.backgroundDeliveryEnabled = true;
      config.iOSConfig.dataPushMode = 'automatic';
    } else {
      config.androidConfig.syncOnAppStart = true;
    }

    await VitalHealth.configure(config);
    initialized = true;
    console.log('[Junction] SDK initialized');
  } catch (err) {
    console.error('[Junction] Initialization failed', err);
    throw err;
  }
}

/**
 * The resources we request permissions for.
 * Maps to the metrics our analytical engines consume.
 */
const REQUESTED_RESOURCES: VitalResource[] = [
  VitalResource.Sleep,
  VitalResource.Activity,
  VitalResource.Steps,
  VitalResource.HeartRate,
  VitalResource.HeartRateVariability,
  VitalResource.BloodOxygen,
  VitalResource.BloodPressure,
  VitalResource.Glucose,
  VitalResource.RespiratoryRate,
  VitalResource.Temperature,
  VitalResource.Body,
  VitalResource.Workout,
  VitalResource.VO2Max,
  VitalResource.Water,
  VitalResource.Caffeine,
  VitalResource.MenstrualCycle,
  VitalResource.ActiveEnergyBurned,
  VitalResource.Profile,
];

/**
 * Request HealthKit / Health Connect permissions through the Vital SDK.
 * On iOS this shows the system HealthKit permission sheet.
 * On Android this opens the Health Connect permission dialog.
 *
 * Call this after the user taps "Connect a device" — Junction Link
 * handles cloud provider OAuth, but on-device data still needs explicit
 * OS-level permission.
 */
export async function requestHealthPermissions(): Promise<'success' | 'cancelled' | 'error'> {
  try {
    const outcome = await VitalHealth.askForResources(REQUESTED_RESOURCES);
    return outcome === 'success' ? 'success' : 'cancelled';
  } catch (err) {
    console.error('[Junction] Permission request failed', err);
    return 'error';
  }
}

/**
 * Check whether we have the needed health permissions.
 */
export async function hasHealthPermissions(): Promise<boolean> {
  try {
    const status = await VitalHealth.status();
    return status === 'connected' || status === 'autoConnect';
  } catch {
    return false;
  }
}

/**
 * Open the Junction Link provider picker.
 * This is the single "Connect a device" flow — Junction shows the user
 * Oura, Fitbit, Garmin, WHOOP, etc. and handles the OAuth.
 *
 * For HealthKit/Health Connect: the user doesn't go through Link — instead
 * we call requestHealthPermissions() above, and Junction's Health SDK
 * handles the data sync automatically.
 */
export async function openProviderLink(): Promise<void> {
  // VitalCore.createConnectedSource() opens the link widget.
  // On completion, the provider is connected server-side and data
  // starts flowing through the webhook.
  await VitalCore.createConnectedSource();
}

/**
 * Disconnect a provider.
 */
export async function disconnectProvider(provider: string): Promise<void> {
  await VitalCore.deregisterProvider(provider);
}

/**
 * List all connected providers for the current user.
 */
export async function listConnectedProviders(): Promise<Array<{
  name: string;
  slug: string;
  status: string;
}>> {
  try {
    const providers = await VitalCore.getConnectedSources();
    return (providers ?? []).map((p: any) => ({
      name: p.name ?? p.slug ?? 'Unknown',
      slug: p.slug ?? p.name?.toLowerCase() ?? 'unknown',
      status: 'active',
    }));
  } catch {
    return [];
  }
}

/**
 * Trigger a manual sync. Junction's Health SDK will push any pending
 * on-device data to Junction's servers, which in turn fires our webhook.
 */
export async function triggerSync(): Promise<void> {
  await VitalHealth.syncData();
}

/**
 * Map a Vital provider slug to our HealthSource format.
 */
export function toHealthSource(providerSlug: string): HealthSource {
  const slug = providerSlug.toLowerCase();
  if (slug === 'apple_health_kit' || slug === 'apple_health') return 'junction:healthkit';
  if (slug === 'health_connect') return 'junction:health_connect';
  if (slug.includes('oura')) return 'junction:oura';
  if (slug.includes('fitbit')) return 'junction:fitbit';
  if (slug.includes('whoop')) return 'junction:whoop';
  if (slug.includes('garmin')) return 'junction:garmin';
  if (slug.includes('withings')) return 'junction:withings';
  if (slug.includes('polar')) return 'junction:polar';
  return `junction:${slug}` as HealthSource;
}

/**
 * Whether the SDK has been initialized.
 */
export function isInitialized(): boolean {
  return initialized;
}
