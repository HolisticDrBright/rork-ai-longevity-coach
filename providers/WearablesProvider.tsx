import createContextHook from '@nkzw/create-context-hook';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { secureGetJSON, secureSetJSON } from '@/lib/secureStorage';
import { writeAuditLog } from '@/lib/auditLog';

import {
  DailyBiometricRecord,
  UserBaseline,
  DailyRecommendation,
  InsightMessage,
  MealLogEntry,
  SupplementLogEntry,
  SymptomLogEntry,
  WearableConnection,
  WearableSource,
  AllScores,
  TrendSeries,
} from '@/types/wearables';

import {
  generateMockRecords,
  generateMockBaseline,
  generateMockMealLogs,
  generateMockSupplementLogs,
  generateMockSymptomLogs,
  mockConnections,
  generateMockInsights,
} from '@/mocks/wearables';

import { generateDailyRecommendation } from '@/utils/wearables/recommendationEngine';

const STORAGE_KEYS = {
  CONNECTIONS: 'wearables_connections',
  RECORDS: 'wearables_records',
  BASELINE: 'wearables_baseline',
};

function computeTrendDirection(data: (number | null)[]): 'improving' | 'stable' | 'declining' | 'insufficient_data' {
  const valid = data.filter((v): v is number => v !== null);
  if (valid.length < 3) return 'insufficient_data';
  const firstHalf = valid.slice(0, Math.floor(valid.length / 2));
  const secondHalf = valid.slice(Math.floor(valid.length / 2));
  const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const changePct = ((avgSecond - avgFirst) / Math.max(avgFirst, 1)) * 100;
  if (changePct > 3) return 'improving';
  if (changePct < -3) return 'declining';
  return 'stable';
}

function computeChangePercent(data: (number | null)[]): number {
  const valid = data.filter((v): v is number => v !== null);
  if (valid.length < 2) return 0;
  const first = valid[valid.length - 1];
  const last = valid[0];
  return Math.round(((last - first) / Math.max(first, 1)) * 100);
}

export const [WearablesProvider, useWearables] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [connections, setConnections] = useState<WearableConnection[]>(mockConnections);
  const [records, setRecords] = useState<DailyBiometricRecord[]>([]);
  const [baseline, setBaseline] = useState<UserBaseline | null>(null);
  const [mealLogs, setMealLogs] = useState<MealLogEntry[]>([]);
  const [supplementLogs, setSupplementLogs] = useState<SupplementLogEntry[]>([]);
  const [symptomLogs, setSymptomLogs] = useState<SymptomLogEntry[]>([]);

  const recordsQuery = useQuery({
    queryKey: ['wearables_records'],
    queryFn: async () => {
      const stored = await secureGetJSON<DailyBiometricRecord[]>(STORAGE_KEYS.RECORDS);
      if (stored && stored.length > 0) return stored;
      const mock = generateMockRecords(30);
      await secureSetJSON(STORAGE_KEYS.RECORDS, mock);
      return mock;
    },
  });

  const connectionsQuery = useQuery({
    queryKey: ['wearables_connections'],
    queryFn: async () => {
      const stored = await secureGetJSON<WearableConnection[]>(STORAGE_KEYS.CONNECTIONS);
      return stored ?? mockConnections;
    },
  });

  useEffect(() => {
    if (recordsQuery.data) {
      setRecords(recordsQuery.data);
      const bl = generateMockBaseline(recordsQuery.data);
      setBaseline(bl);
      setMealLogs(generateMockMealLogs(7));
      setSupplementLogs(generateMockSupplementLogs(7));
      setSymptomLogs(generateMockSymptomLogs(14));
    }
  }, [recordsQuery.data]);

  useEffect(() => {
    if (connectionsQuery.data) setConnections(connectionsQuery.data);
  }, [connectionsQuery.data]);

  const recommendation = useMemo((): DailyRecommendation | null => {
    if (records.length === 0 || !baseline) return null;
    return generateDailyRecommendation(records, baseline, mealLogs, supplementLogs);
  }, [records, baseline, mealLogs, supplementLogs]);

  const insights = useMemo((): InsightMessage[] => {
    if (records.length === 0) return [];
    return generateMockInsights(records);
  }, [records]);

  const scores = useMemo((): AllScores | null => {
    return recommendation?.scores ?? null;
  }, [recommendation]);

  const todayRecord = useMemo(() => records.length > 0 ? records[0] : null, [records]);

  const toggleConnection = useMutation({
    mutationFn: async (source: WearableSource) => {
      const updated = connections.map(c =>
        c.source === source
          ? { ...c, connected: !c.connected, lastSync: !c.connected ? new Date().toISOString() : null }
          : c
      );
      await secureSetJSON(STORAGE_KEYS.CONNECTIONS, updated);
      await writeAuditLog('PHI_UPDATE', 'wearable_connection', source);
      return updated;
    },
    onSuccess: (data) => {
      setConnections(data);
      void queryClient.invalidateQueries({ queryKey: ['wearables_connections'] });
    },
  });

  const refreshData = useMutation({
    mutationFn: async () => {
      const mock = generateMockRecords(30);
      await secureSetJSON(STORAGE_KEYS.RECORDS, mock);
      await writeAuditLog('PHI_UPDATE', 'wearables_sync', 'user');
      return mock;
    },
    onSuccess: (data) => {
      setRecords(data);
      const bl = generateMockBaseline(data);
      setBaseline(bl);
      setMealLogs(generateMockMealLogs(7));
      setSupplementLogs(generateMockSupplementLogs(7));
      void queryClient.invalidateQueries({ queryKey: ['wearables_records'] });
    },
  });

  const getTrendSeries = useCallback((metric: string, days: number = 14): TrendSeries => {
    const slice = records.slice(0, days);
    const colorMap: Record<string, string> = {
      hrv: '#4A90D9',
      restingHr: '#E76F51',
      sleepScore: '#7C3AED',
      sleepDuration: '#2563EB',
      steps: '#16A34A',
      readinessScore: '#0D9488',
      adherenceScore: '#F59E0B',
      stressScore: '#EF4444',
    };

    const getData = (r: DailyBiometricRecord): number | null => {
      switch (metric) {
        case 'hrv': return r.hrv;
        case 'restingHr': return r.restingHr;
        case 'sleepScore': return r.sleepScore;
        case 'sleepDuration': return r.sleepDurationMinutes ? Math.round(r.sleepDurationMinutes / 60 * 10) / 10 : null;
        case 'steps': return r.steps;
        case 'readinessScore': return r.readinessScore;
        case 'adherenceScore': return r.adherenceScore;
        case 'stressScore': return r.stressScoreSubjective;
        case 'weight': return r.weight;
        case 'energyScore': return r.energyScore;
        case 'sorenessScore': return r.sorenessScore;
        case 'moodScore': return r.moodScore;
        default: return null;
      }
    };

    const data = slice.map(r => ({ date: r.date, value: getData(r) })).reverse();
    const values = data.map(d => d.value);

    return {
      label: metric,
      color: colorMap[metric] ?? '#6B7280',
      data,
      direction: computeTrendDirection(values),
      changePercent: computeChangePercent(values),
    };
  }, [records]);

  const isLoading = recordsQuery.isLoading || connectionsQuery.isLoading;

  return useMemo(() => ({
    connections,
    records,
    todayRecord,
    baseline,
    recommendation,
    insights,
    scores,
    mealLogs,
    supplementLogs,
    symptomLogs,
    isLoading,
    isRefreshing: refreshData.isPending,
    toggleConnection: toggleConnection.mutate,
    refreshData: refreshData.mutate,
    getTrendSeries,
  }), [
    connections, records, todayRecord, baseline, recommendation,
    insights, scores, mealLogs, supplementLogs, symptomLogs,
    isLoading, refreshData.isPending, toggleConnection.mutate,
    refreshData.mutate, getTrendSeries,
  ]);
});
