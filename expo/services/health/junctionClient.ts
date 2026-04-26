/**
 * Junction (Vital) SDK v6 wrapper.
 *
 * Single adapter for all wearable data. Handles:
 *   - SDK initialization (VitalCore.configure → VitalCore.setUserId → VitalHealth.configure)
 *   - HealthKit / Health Connect permission requests via VitalHealth.askForResources()
 *   - On-device data sync via VitalHealth.syncData()
 *   - Provider listing via VitalCore.userConnections()
 *   - Provider disconnect via VitalCore.deregisterProvider()
 *
 * Cloud provider connections (Oura, Fitbit, Garmin, WHOOP) are handled via
 * the Vital Link widget, which is opened from the connection UX screen using
 * the Vital Link URL. The mobile SDK itself does NOT expose createConnectedSource()
 * in v6 — Link is a web-based flow that redirects back to the app.
 *
 * The app only ever imports from healthService.ts; this file is internal.
 */

import { Platform } from 'react-native';
import type { HealthSource } from './types';

// Vital SDK is a native module — imports fail in managed Expo builds
// where the packages aren't installed. Lazy-load to prevent crash.
let VitalHealth: any = null;
let VitalCore: any = null;
let VitalResource: any = {};
let HealthConfig: any = null;

try {
  const healthMod = require('@tryvital/vital-health-react-native');
  VitalHealth = healthMod.VitalHealth;
  VitalResource = healthMod.VitalResource;
  HealthConfig = healthMod.HealthConfig;
  const coreMod = require('@tryvital/vital-core-react-native');
  VitalCore = coreMod.VitalCore;
} catch {
  console.warn('[Junction] Vital SDK not installed — wearable features disabled. Run npm install + expo prebuild to enable.');
}

const SDK_AVAILABLE = VitalHealth !== null && VitalCore !== null;

const VITAL_ENVIRONMENT = (process.env.EXPO_PUBLIC_VITAL_ENVIRONMENT ?? 'sandbox') as string;
const VITAL_REGION = (process.env.EXPO_PUBLIC_VITAL_REGION ?? 'us') as string;
const VITAL_API_KEY = process.env.EXPO_PUBLIC_VITAL_API_KEY ?? '';

let initialized = false;

/**
 * Initialize the Vital SDK (v6 API).
 * VitalCore.configure() takes (apiKey, environment, region, enableLogs).
 * VitalHealth.configure() takes a HealthConfig object.
 */
export async function initializeJunction(userId: string): Promise<void> {
  if (initialized) return;

  if (!SDK_AVAILABLE) {
    console.warn('[Junction] Vital SDK not available — skipping init');
    return;
  }

  if (!VITAL_API_KEY) {
    console.warn('[Junction] EXPO_PUBLIC_VITAL_API_KEY not set — wearable features disabled');
    return;
  }

  try {
    // v6: configure(apiKey, environment, region, enableLogs)
    await VitalCore.configure(VITAL_API_KEY, VITAL_ENVIRONMENT, VITAL_REGION, __DEV__);
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
    console.log('[Junction] SDK v6 initialized');
  } catch (err) {
    console.error('[Junction] Initialization failed', err);
    throw err;
  }
}

/**
 * The resources we request permissions for.
 * Trimmed to only what our analytical engines actually consume.
 */
// Trimmed to exactly what daily_biometric_records consumes + what we have
// Android Health Connect permissions for. 13 resources, 13 permissions.
const REQUESTED_RESOURCES: VitalResource[] = [
  VitalResource.Sleep,            // READ_SLEEP
  VitalResource.Activity,         // (derived from steps/calories/exercise)
  VitalResource.Steps,            // READ_STEPS
  VitalResource.Distance,         // READ_DISTANCE
  VitalResource.ActiveEnergyBurned, // READ_ACTIVE_CALORIES_BURNED
  VitalResource.Workout,          // READ_EXERCISE
  VitalResource.HeartRate,        // READ_HEART_RATE
  VitalResource.HeartRateVariability, // READ_HEART_RATE_VARIABILITY
  VitalResource.BloodOxygen,      // READ_OXYGEN_SATURATION
  VitalResource.RespiratoryRate,  // READ_RESPIRATORY_RATE
  VitalResource.Temperature,      // READ_BODY_TEMPERATURE
  VitalResource.Body,             // READ_WEIGHT + READ_BODY_FAT
  VitalResource.VO2Max,           // (derived from workout data on Android)
];

/**
 * Request HealthKit / Health Connect permissions through the Vital SDK.
 * v6: askForResources(resources, provider?) returns PermissionOutcome.
 */
export async function requestHealthPermissions(): Promise<'success' | 'cancelled' | 'error'> {
  if (!SDK_AVAILABLE) return 'error';
  try {
    const outcome = await VitalHealth.askForResources(REQUESTED_RESOURCES);
    if (outcome === 'success') return 'success';
    if (outcome === 'cancelled' || outcome === 'notPrompted') return 'cancelled';
    return 'error';
  } catch (err) {
    console.error('[Junction] Permission request failed', err);
    return 'error';
  }
}

/**
 * Check whether on-device health data sync is active.
 * v6: getConnectionStatus(provider?) returns ConnectionStatus.
 */
export async function hasHealthPermissions(): Promise<boolean> {
  if (!SDK_AVAILABLE) return false;
  try {
    const status = await VitalHealth.getConnectionStatus();
    return status === 'connected' || status === 'autoConnect';
  } catch {
    return false;
  }
}

/**
 * Connect on-device health data (HealthKit / Health Connect).
 * v6: VitalHealth.connect(provider?) activates background sync.
 */
export async function connectOnDeviceHealth(): Promise<void> {
  if (!SDK_AVAILABLE) return;
  await VitalHealth.connect();
}

/**
 * Build the Vital Link URL for cloud provider connections.
 * The app opens this in an in-app browser. When the user completes
 * the OAuth flow, the provider is connected server-side and data
 * starts flowing through the webhook.
 *
 * Note: v6 does NOT expose createConnectedSource() on the mobile SDK.
 * Link is a web-based flow.
 */
export function buildLinkUrl(vitalUserId: string): string {
  const env = VITAL_ENVIRONMENT === 'production' ? '' : 'sandbox.';
  return `https://link.${env}tryvital.io/?token=${VITAL_API_KEY}&user_id=${vitalUserId}`;
}

/**
 * Disconnect a provider.
 * v6: VitalCore.deregisterProvider(provider) — takes a ProviderSlug string.
 */
export async function disconnectProvider(provider: string): Promise<void> {
  if (!SDK_AVAILABLE) return;
  await VitalCore.deregisterProvider(provider as any);
}

/**
 * List all connected providers for the current user.
 * v6: VitalCore.userConnections() returns UserConnection[].
 */
export async function listConnectedProviders(): Promise<Array<{
  name: string;
  slug: string;
  status: string;
}>> {
  if (!SDK_AVAILABLE) return [];
  try {
    const connections = await VitalCore.userConnections();
    return (connections ?? []).map((c: any) => ({
      name: c.provider?.name ?? c.name ?? 'Unknown',
      slug: c.provider?.slug ?? c.slug ?? 'unknown',
      status: c.status ?? 'active',
    }));
  } catch {
    return [];
  }
}

/**
 * Trigger a manual sync of on-device health data.
 * v6: VitalHealth.syncData(resources?, provider?)
 */
export async function triggerSync(): Promise<void> {
  if (!SDK_AVAILABLE) return;
  await VitalHealth.syncData();
}

/**
 * Enable background sync (Android-specific; iOS uses background delivery
 * which is configured via HealthConfig).
 */
export async function enableBackgroundSync(): Promise<boolean> {
  if (!SDK_AVAILABLE) return false;
  if (Platform.OS === 'android') {
    return await VitalHealth.enableBackgroundSync();
  }
  return true;
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

export function isInitialized(): boolean {
  return initialized;
}
