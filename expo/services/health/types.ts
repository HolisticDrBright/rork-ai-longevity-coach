export type HealthSource =
  | 'junction:healthkit'
  | 'junction:health_connect'
  | 'junction:oura'
  | 'junction:fitbit'
  | 'junction:whoop'
  | 'junction:garmin'
  | 'junction:withings'
  | 'junction:eight_sleep'
  | 'junction:polar'
  | 'junction:strava'
  | 'manual';

export type HealthMetric =
  | 'sleep' | 'activity' | 'body' | 'workout'
  | 'heart_rate' | 'hrv' | 'blood_oxygen'
  | 'respiratory_rate' | 'temperature' | 'vo2_max'
  | 'steps' | 'water' | 'caffeine' | 'menstrual_cycle';

export type ConnectionStatus = 'active' | 'inactive' | 'expired' | 'revoked' | 'connecting';

export interface ProviderConnection {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string | null;
  sourceSystem: 'direct' | 'junction';
  status: ConnectionStatus;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  connectedAt: string;
}

export interface SyncResult {
  inserted: number;
  skipped: number;
  errors: string[];
}
