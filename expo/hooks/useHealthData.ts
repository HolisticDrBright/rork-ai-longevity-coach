/**
 * React Query hook for health data.
 *
 * Provides { records, connections, loading, refresh, connect, disconnect }
 * sourced from Supabase via healthService. The app uses this instead of
 * directly querying the provider or local storage.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { Alert } from 'react-native';
import * as healthService from '@/services/health/healthService';
import type { ProviderConnection } from '@/services/health/types';
import type { DailyBiometricRecord } from '@/types/wearables';

/**
 * Shared react-query key namespaces for health data. WearablesProvider and
 * these hooks query the same underlying tables, so they MUST share key
 * prefixes — otherwise invalidations from one miss the other's cache.
 */
export const HEALTH_RECORDS_QUERY_KEY = 'health_daily_records';
export const HEALTH_CONNECTIONS_QUERY_KEY = 'health_connections';
export const HAS_HEALTH_CONNECTIONS_QUERY_KEY = 'has_health_connections';

const RECORDS_KEY = HEALTH_RECORDS_QUERY_KEY;
const CONNECTIONS_KEY = HEALTH_CONNECTIONS_QUERY_KEY;

/**
 * Fetch the last `days` days of daily biometric records from Supabase.
 */
export function useHealthRecords(days: number = 30) {
  const toDate = new Date().toISOString().substring(0, 10);
  const fromDate = new Date(Date.now() - days * 86400000).toISOString().substring(0, 10);

  return useQuery({
    queryKey: [RECORDS_KEY, fromDate, toDate],
    queryFn: () => healthService.getDailyRecords(fromDate, toDate),
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Fetch the user's active provider connections.
 */
export function useHealthConnections() {
  return useQuery({
    queryKey: [CONNECTIONS_KEY],
    queryFn: () => healthService.listConnections(),
  });
}

/**
 * Check if the user has any connected providers.
 */
export function useHasConnections() {
  return useQuery({
    queryKey: [HAS_HEALTH_CONNECTIONS_QUERY_KEY],
    queryFn: () => healthService.hasConnections(),
  });
}

/**
 * Connect a device (opens Junction Link).
 */
export function useConnectDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider?: string | void) => healthService.connectDevice(provider ?? undefined),
    onSuccess: (result) => {
      if (result.success) {
        void qc.invalidateQueries({ queryKey: [CONNECTIONS_KEY] });
        void qc.invalidateQueries({ queryKey: [HAS_HEALTH_CONNECTIONS_QUERY_KEY] });
      }
    },
  });
}

/**
 * Disconnect a provider.
 */
export function useDisconnectProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: string) => healthService.disconnectProvider(provider),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [CONNECTIONS_KEY] });
      void qc.invalidateQueries({ queryKey: [HAS_HEALTH_CONNECTIONS_QUERY_KEY] });
    },
  });
}

/**
 * Manual sync + refresh.
 */
export function useSyncHealth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => healthService.syncAll(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [RECORDS_KEY] });
      void qc.invalidateQueries({ queryKey: [CONNECTIONS_KEY] });
    },
  });
}
