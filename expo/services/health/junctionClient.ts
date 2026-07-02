/**
 * Junction (Vital) SDK v6 wrapper.
 *
 * CURRENT STATE: The Vital native SDK packages are NOT installed.
 * All functions return safe defaults (empty arrays, false, void).
 * The app runs normally — wearable features show empty state.
 *
 * TO ENABLE WEARABLES:
 *   1. npm install @tryvital/vital-core-react-native @tryvital/vital-health-react-native expo-dev-client
 *   2. Re-add the @tryvital/vital-health-react-native config plugin to app.json
 *   3. npx expo prebuild
 *   4. eas build --profile development
 *   5. Uncomment the SDK imports below and remove the stubs
 */

import { Platform } from 'react-native';
import { trpcClient } from '@/lib/trpc';
import type { HealthSource } from './types';

const VITAL_ENVIRONMENT = (process.env.EXPO_PUBLIC_VITAL_ENVIRONMENT ?? 'sandbox') as string;
const VITAL_REGION = (process.env.EXPO_PUBLIC_VITAL_REGION ?? 'us') as string;

let initialized = false;

// ────────────────────────────────────────────────────────────
// SDK is not installed — all functions are safe stubs.
// When the native SDK is installed + prebuilt, replace these
// stubs with real SDK calls.
// ────────────────────────────────────────────────────────────

export async function initializeJunction(userId: string): Promise<void> {
  console.log('[Junction] SDK not installed — running in stub mode. Wearable features disabled.');
  initialized = true;
}

export async function requestHealthPermissions(): Promise<'success' | 'cancelled' | 'error'> {
  console.warn('[Junction] SDK not installed — cannot request permissions');
  return 'error';
}

export async function hasHealthPermissions(): Promise<boolean> {
  return false;
}

export async function connectOnDeviceHealth(): Promise<void> {
  // no-op without SDK
}

/**
 * Get a Vital Link URL for the current (authenticated) user.
 *
 * Link tokens are short-lived and generated server-side
 * (backend/trpc/routes/ai.ts → integrations.createVitalLinkToken); the Vital
 * API key never ships in the client bundle.
 */
export async function getLinkUrl(provider?: string): Promise<string> {
  const { linkToken, linkWebUrl } = await trpcClient.integrations.createVitalLinkToken.mutate({
    provider,
  });

  if (linkWebUrl) return linkWebUrl;

  if (linkToken) {
    const env = VITAL_ENVIRONMENT === 'production' ? '' : 'sandbox.';
    return `https://link.${env}tryvital.io/?token=${encodeURIComponent(linkToken)}`;
  }

  throw new Error('Could not start device connection: no link token returned by the server.');
}

export async function disconnectProvider(provider: string): Promise<void> {
  // no-op without SDK
}

export async function listConnectedProviders(): Promise<Array<{
  name: string;
  slug: string;
  status: string;
}>> {
  return [];
}

export async function triggerSync(): Promise<void> {
  // no-op without SDK
}

export async function enableBackgroundSync(): Promise<boolean> {
  return false;
}

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
