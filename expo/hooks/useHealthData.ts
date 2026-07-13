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
import { trpcClient } from '@/lib/trpc';
import type { ProviderConnection } from '@/services/health/types';
import type { DailyBiometricRecord } from '@/types/wearables';

const RECORDS_KEY = 'health_daily_records';
const CONNECTIONS_KEY = 'health_connections';

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
    queryKey: ['has_health_connections'],
    queryFn: () => healthService.hasConnections(),
  });
}

/**
 * Fetch all available providers from Junction.
 */
export function useJunctionProviders() {
  return useQuery({
    queryKey: ['junction_providers'],
    queryFn: () => trpcClient.junction.getAllProviders.query(),
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Get the Junction Link URL for a given provider.
 * Automatically creates the Junction user if one doesn't exist yet.
 */
export function useGetLinkUrl() {
  return useMutation({
    mutationFn: (provider: string) => healthService.getLinkUrl(provider),
  });
}

/**
 * Sync connected sources from Junction into Supabase and refresh.
 */
export function useSyncConnectedSources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => trpcClient.junction.syncConnectedSources.mutate(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wearables_connections'] });
      void qc.invalidateQueries({ queryKey: ['has_health_connections'] });
    },
  });
}

/**
 * Record a completed provider connection in Supabase.
 */
export function useRecordConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (providerSlug: string) => healthService.recordConnection(providerSlug),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [CONNECTIONS_KEY] });
      void qc.invalidateQueries({ queryKey: ['has_health_connections'] });
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
      void qc.invalidateQueries({ queryKey: ['has_health_connections'] });
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
