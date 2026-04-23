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
  TrendDataPoint,
  TrendDirection,
} from '@/types/wearables';

import { generateDailyRecommendation } from '@/utils/wearables/recommendationEngine';
import { generateBaseline, computeDataCompleteness, computeAllDeviations, DataCompletenessResult, BaselineDeviation } from '@/utils/wearables/baselineEngine';
import { computeTrendAnalysis, TrendAnalysis, detectWeekdayWeekendEffect, computeCycleLinkedTrends, CycleLinkedTrend } from '@/utils/wearables/trendEngine';
import { generateNotifications, generatePractitionerFlags, NotificationItem, PractitionerFlag } from '@/utils/wearables/notificationEngine';
import { composeAIInsight, AIInsightOutput } from '@/utils/wearables/aiInsightComposer';

const STORAGE_KEYS = {
  CONNECTIONS: 'wearables_connections',
  RECORDS: 'wearables_records',
  BASELINE: 'wearables_baseline',
  AI_INSIGHT: 'wearables_ai_insight',
};

function computeTrendDirection(data: (number | null)[]): TrendDirection {
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
  const [connections, setConnections] = useState<WearableConnection[]>([]);
  const [records, setRecords] = useState<DailyBiometricRecord[]>([]);
  const [baseline, setBaseline] = useState<UserBaseline | null>(null);
  const [mealLogs, setMealLogs] = useState<MealLogEntry[]>([]);
  const [supplementLogs, setSupplementLogs] = useState<SupplementLogEntry[]>([]);
  const [symptomLogs, setSymptomLogs] = useState<SymptomLogEntry[]>([]);
  const [aiInsight, setAiInsight] = useState<AIInsightOutput | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [practitionerFlags, setPractitionerFlags] = useState<PractitionerFlag[]>([]);

  const recordsQuery = useQuery({
    queryKey: ['wearables_records'],
    queryFn: async () => {
      const stored = await secureGetJSON<DailyBiometricRecord[]>(STORAGE_KEYS.RECORDS);
      return stored ?? [];
    },
  });

  const connectionsQuery = useQuery({
    queryKey: ['wearables_connections'],
    queryFn: async () => {
      const stored = await secureGetJSON<WearableConnection[]>(STORAGE_KEYS.CONNECTIONS);
      return stored ?? [];
    },
  });

  useEffect(() => {
    if (recordsQuery.data) {
      setRecords(recordsQuery.data);
      if (recordsQuery.data.length > 0) {
        const bl = generateBaseline(recordsQuery.data);
        setBaseline(bl);
      }
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
    return [];
  }, [records]);

  const scores = useMemo((): AllScores | null => {
    return recommendation?.scores ?? null;
  }, [recommendation]);

  const todayRecord = useMemo(() => records.length > 0 ? records[0] : null, [records]);

  const dataCompleteness = useMemo((): DataCompletenessResult | null => {
    if (!todayRecord) return null;
    return computeDataCompleteness(todayRecord);
  }, [todayRecord]);

  const baselineDeviations = useMemo((): BaselineDeviation[] => {
    if (!todayRecord || !baseline) return [];
    return computeAllDeviations(todayRecord, baseline);
  }, [todayRecord, baseline]);

  useEffect(() => {
    if (todayRecord && scores && recommendation && baseline) {
      const notifs = generateNotifications(
        todayRecord, records, scores, recommendation.patterns, baseline
      );
      setNotifications(notifs);

      const flags = generatePractitionerFlags(records, recommendation.patterns, baseline);
      setPractitionerFlags(flags);
    }
  }, [todayRecord, scores, recommendation, records, baseline]);

  const generateAIInsightMutation = useMutation({
    mutationFn: async () => {
      if (!todayRecord || !scores || !baseline) {
        throw new Error('Missing data for AI insight');
      }
      console.log('[WearablesProvider] Generating AI insight...');
      const result = await composeAIInsight({
        record: todayRecord,
        scores,
        deviations: baselineDeviations,
        patterns: recommendation?.patterns ?? [],
        correlations: recommendation?.correlations ?? [],
        meals: mealLogs,
        supplements: supplementLogs,
        baseline,
      });
      await secureSetJSON(STORAGE_KEYS.AI_INSIGHT, result);
      return result;
    },
    onSuccess: (data) => {
      setAiInsight(data);
      console.log('[WearablesProvider] AI insight generated successfully');
    },
    onError: (error) => {
      console.error('[WearablesProvider] AI insight generation failed:', error);
    },
  });

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
      // Real wearable sync will pull from connected device APIs.
      // For now, invalidate the cache so the query re-fetches stored data.
      await writeAuditLog('PHI_UPDATE', 'wearables_sync', 'user');
      const stored = await secureGetJSON<DailyBiometricRecord[]>(STORAGE_KEYS.RECORDS);
      return stored ?? [];
    },
    onSuccess: (data) => {
      setRecords(data);
      if (data.length > 0) {
        const bl = generateBaseline(data);
        setBaseline(bl);
      }
      setAiInsight(null);
      void queryClient.invalidateQueries({ queryKey: ['wearables_records'] });
    },
  });

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, dismissed: true } : n));
  }, []);

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

    const data: TrendDataPoint[] = slice.map(r => ({ date: r.date, value: getData(r) })).reverse();
    const values = data.map(d => d.value);

    return {
      label: metric,
      color: colorMap[metric] ?? '#6B7280',
      data,
      direction: computeTrendDirection(values),
      changePercent: computeChangePercent(values),
    };
  }, [records]);

  const getTrendAnalysis = useCallback((metric: string, days: number = 14, higherIsBetter: boolean = true): TrendAnalysis => {
    const slice = records.slice(0, days);
    const getData = (r: DailyBiometricRecord): number | null => {
      switch (metric) {
        case 'hrv': return r.hrv;
        case 'restingHr': return r.restingHr;
        case 'sleepScore': return r.sleepScore;
        case 'sleepDuration': return r.sleepDurationMinutes ? Math.round(r.sleepDurationMinutes / 60 * 10) / 10 : null;
        case 'steps': return r.steps;
        case 'readinessScore': return r.readinessScore;
        case 'adherenceScore': return r.adherenceScore;
        case 'energyScore': return r.energyScore;
        default: return null;
      }
    };
    const data = slice.map(r => ({ date: r.date, value: getData(r) })).reverse();
    return computeTrendAnalysis(data, higherIsBetter);
  }, [records]);

  const getWeekdayWeekendEffect = useCallback((metric: keyof DailyBiometricRecord) => {
    return detectWeekdayWeekendEffect(records.slice(0, 30), metric);
  }, [records]);

  const getCycleLinkedTrends = useCallback((metric: keyof DailyBiometricRecord): CycleLinkedTrend[] => {
    return computeCycleLinkedTrends(records.slice(0, 30), metric);
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
    getTrendAnalysis,
    getWeekdayWeekendEffect,
    getCycleLinkedTrends,
    dataCompleteness,
    baselineDeviations,
    aiInsight,
    isGeneratingAI: generateAIInsightMutation.isPending,
    generateAIInsight: generateAIInsightMutation.mutate,
    notifications: notifications.filter(n => !n.dismissed),
    practitionerFlags,
    dismissNotification,
  }), [
    connections, records, todayRecord, baseline, recommendation,
    insights, scores, mealLogs, supplementLogs, symptomLogs,
    isLoading, refreshData.isPending, toggleConnection.mutate,
    refreshData.mutate, getTrendSeries, getTrendAnalysis,
    getWeekdayWeekendEffect, getCycleLinkedTrends,
    dataCompleteness, baselineDeviations,
    aiInsight, generateAIInsightMutation.isPending,
    generateAIInsightMutation.mutate,
    notifications, practitionerFlags, dismissNotification,
  ]);
});
