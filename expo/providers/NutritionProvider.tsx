import createContextHook from '@nkzw/create-context-hook';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { secureGetJSON, secureSetJSON, secureRemoveItem } from '@/lib/secureStorage';
import { writeAuditLog } from '@/lib/auditLog';
import { mealLogService } from '@/lib/supabaseService';
import { supabase } from '@/lib/supabase';

import {
  DietProfile,
  FoodLog,
  TherapeuticDiet,
  MealType,
  NutritionTotals,
  DietCompliance,
  DetectedFoodItem,
  DaySummary,
} from '@/types';

const STORAGE_KEYS = {
  DIET_PROFILE: 'nutrition_diet_profile',
  FOOD_LOGS: 'nutrition_food_logs',
  PENDING_ANALYSIS: 'nutrition_pending_analysis',
};

const defaultDietProfile: DietProfile = {
  id: '',
  userId: '',
  activeDiets: [],
  allergies: '',
  notes: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const _defaultTotals: NutritionTotals = {
  calories: 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
  fiber_g: 0,
  sugar_g: 0,
  sodium_mg: 0,
};

export const [NutritionProvider, useNutrition] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [dietProfile, setDietProfile] = useState<DietProfile>(defaultDietProfile);
  const [foodLogs, setFoodLogs] = useState<FoodLog[]>([]);
  // Mirrors the latest food logs synchronously so rapid successive writes
  // don't build on stale state (state only updates in onSuccess).
  const foodLogsRef = useRef<FoodLog[]>([]);
  const [pendingAnalysis, setPendingAnalysis] = useState<{
    foodLogId: string;
    detectedItems: DetectedFoodItem[];
    mealType: MealType;
    photoBase64: string | null;
  } | null>(null);

  const dietProfileQuery = useQuery({
    queryKey: ['dietProfile'],
    queryFn: async () => {
      const stored = await secureGetJSON<DietProfile>(STORAGE_KEYS.DIET_PROFILE);
      return stored ?? defaultDietProfile;
    },
  });

  const foodLogsQuery = useQuery({
    queryKey: ['foodLogs'],
    queryFn: async () => {
      const stored = await secureGetJSON<FoodLog[]>(STORAGE_KEYS.FOOD_LOGS);
      return stored ?? [];
    },
  });

  const pendingAnalysisQuery = useQuery({
    queryKey: ['pendingAnalysis'],
    queryFn: async () => {
      const stored = await secureGetJSON<typeof pendingAnalysis>(STORAGE_KEYS.PENDING_ANALYSIS);
      return stored ?? null;
    },
  });

  useEffect(() => {
    if (dietProfileQuery.data) setDietProfile(dietProfileQuery.data);
  }, [dietProfileQuery.data]);

  useEffect(() => {
    if (foodLogsQuery.data) {
      foodLogsRef.current = foodLogsQuery.data;
      setFoodLogs(foodLogsQuery.data);
    }
  }, [foodLogsQuery.data]);

  useEffect(() => {
    if (pendingAnalysisQuery.data) setPendingAnalysis(pendingAnalysisQuery.data);
  }, [pendingAnalysisQuery.data]);

  const saveDietProfileMutation = useMutation({
    mutationFn: async (profile: DietProfile) => {
      const updated = { ...profile, updatedAt: new Date().toISOString() };
      await secureSetJSON(STORAGE_KEYS.DIET_PROFILE, updated);
      await writeAuditLog('PHI_UPDATE', 'diet_profile', 'user');
      return updated;
    },
    onSuccess: (data) => {
      setDietProfile(data);
      void queryClient.invalidateQueries({ queryKey: ['dietProfile'] });
    },
  });

  const saveFoodLogsMutation = useMutation({
    mutationFn: async ({ logs, changed, deletedId }: {
      logs: FoodLog[];
      /** The log that was added/updated in this save, for remote sync. */
      changed?: FoodLog;
      /** The id of a log deleted in this save, for remote delete propagation. */
      deletedId?: string;
    }) => {
      await secureSetJSON(STORAGE_KEYS.FOOD_LOGS, logs);
      await writeAuditLog('PHI_UPDATE', 'food_logs', 'user');

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          if (changed) {
            console.log('[NutritionProvider] Syncing meal log to Supabase...');
            await mealLogService.upsert({
              id: changed.id,
              meal_time: changed.createdAt,
              meal_type: changed.mealType || 'other',
              calories: changed.totals?.calories ?? null,
              protein_g: changed.totals?.protein_g ?? null,
              carbs_g: changed.totals?.carbs_g ?? null,
              fat_g: changed.totals?.fat_g ?? null,
              fiber_g: changed.totals?.fiber_g ?? null,
              glycemic_load_estimate: null,
              inflammatory_load_estimate: null,
              food_quality_score: null,
              tags_json: null,
              notes: changed.notes ?? null,
            });
          }
          if (deletedId) {
            await mealLogService.deleteById(deletedId);
          }
        }
      } catch (e) {
        console.log('[NutritionProvider] Supabase sync failed (non-blocking):', e instanceof Error ? e.message : 'unknown error');
      }

      return logs;
    },
    onSuccess: (data) => {
      setFoodLogs(data);
      void queryClient.invalidateQueries({ queryKey: ['foodLogs'] });
    },
  });

  const savePendingAnalysisMutation = useMutation({
    mutationFn: async (analysis: typeof pendingAnalysis) => {
      if (analysis) {
        await secureSetJSON(STORAGE_KEYS.PENDING_ANALYSIS, analysis);
      } else {
        await secureRemoveItem(STORAGE_KEYS.PENDING_ANALYSIS);
      }
      return analysis;
    },
    onSuccess: (data) => {
      setPendingAnalysis(data);
      void queryClient.invalidateQueries({ queryKey: ['pendingAnalysis'] });
    },
  });

  const updateDietProfile = useCallback((updates: Partial<DietProfile>) => {
    const updated = { ...dietProfile, ...updates };
    if (!updated.id) {
      updated.id = `diet_${Date.now()}`;
    }
    saveDietProfileMutation.mutate(updated);
  }, [dietProfile, saveDietProfileMutation]);

  const toggleDiet = useCallback((diet: TherapeuticDiet) => {
    const currentDiets = dietProfile.activeDiets || [];
    const newDiets = currentDiets.includes(diet)
      ? currentDiets.filter(d => d !== diet)
      : [...currentDiets, diet];
    updateDietProfile({ activeDiets: newDiets });
  }, [dietProfile.activeDiets, updateDietProfile]);

  const setPendingMealAnalysis = useCallback((analysis: {
    foodLogId: string;
    detectedItems: DetectedFoodItem[];
    mealType: MealType;
    photoBase64: string | null;
  } | null) => {
    savePendingAnalysisMutation.mutate(analysis);
  }, [savePendingAnalysisMutation]);

  const addFoodLog = useCallback((log: FoodLog) => {
    const updated = [log, ...foodLogsRef.current];
    foodLogsRef.current = updated;
    saveFoodLogsMutation.mutate({ logs: updated, changed: log });
    savePendingAnalysisMutation.mutate(null);
  }, [saveFoodLogsMutation, savePendingAnalysisMutation]);

  const updateFoodLog = useCallback((logId: string, updates: Partial<FoodLog>) => {
    let changed: FoodLog | undefined;
    const updated = foodLogsRef.current.map(log => {
      if (log.id === logId) {
        changed = { ...log, ...updates };
        return changed;
      }
      return log;
    });
    foodLogsRef.current = updated;
    saveFoodLogsMutation.mutate({ logs: updated, changed });
  }, [saveFoodLogsMutation]);

  const deleteFoodLog = useCallback((logId: string) => {
    const updated = foodLogsRef.current.filter(log => log.id !== logId);
    foodLogsRef.current = updated;
    saveFoodLogsMutation.mutate({ logs: updated, deletedId: logId });
  }, [saveFoodLogsMutation]);

  const getTodayLogs = useCallback(() => {
    const today = new Date().toISOString().split('T')[0];
    return foodLogs.filter(log => log.createdAt.startsWith(today));
  }, [foodLogs]);

  const todaySummary = useMemo((): DaySummary => {
    const todayLogs = getTodayLogs();
    const today = new Date().toISOString().split('T')[0];

    if (todayLogs.length === 0) {
      return {
        date: today,
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        mealsLogged: 0,
        overallCompliance: {},
      };
    }

    const totals = todayLogs.reduce(
      (acc, log) => ({
        calories: acc.calories + (log.totals?.calories || 0),
        protein: acc.protein + (log.totals?.protein_g || 0),
        carbs: acc.carbs + (log.totals?.carbs_g || 0),
        fat: acc.fat + (log.totals?.fat_g || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    const overallCompliance: Record<string, DietCompliance> = {};
    const activeDiets = dietProfile.activeDiets || [];

    for (const diet of activeDiets) {
      const allViolations: string[] = [];
      const allCautions: string[] = [];
      let totalScore = 0;
      let logCount = 0;

      for (const log of todayLogs) {
        if (log.compliance && log.compliance[diet]) {
          totalScore += log.compliance[diet].score;
          allViolations.push(...log.compliance[diet].violations);
          allCautions.push(...log.compliance[diet].cautions);
          logCount++;
        }
      }

      overallCompliance[diet] = {
        score: logCount > 0 ? Math.round(totalScore / logCount) : 100,
        violations: [...new Set(allViolations)],
        cautions: [...new Set(allCautions)],
      };
    }

    return {
      date: today,
      totalCalories: Math.round(totals.calories),
      totalProtein: Math.round(totals.protein),
      totalCarbs: Math.round(totals.carbs),
      totalFat: Math.round(totals.fat),
      mealsLogged: todayLogs.length,
      overallCompliance,
    };
  }, [getTodayLogs, dietProfile.activeDiets]);

  const getLogById = useCallback((logId: string): FoodLog | undefined => {
    return foodLogs.find(log => log.id === logId);
  }, [foodLogs]);

  const getRecentLogs = useCallback((limit: number = 10): FoodLog[] => {
    return foodLogs.slice(0, limit);
  }, [foodLogs]);

  const isLoading = dietProfileQuery.isLoading || foodLogsQuery.isLoading;

  return useMemo(() => ({
    dietProfile,
    foodLogs,
    pendingAnalysis,
    todaySummary,
    isLoading,
    updateDietProfile,
    toggleDiet,
    setPendingMealAnalysis,
    addFoodLog,
    updateFoodLog,
    deleteFoodLog,
    getTodayLogs,
    getLogById,
    getRecentLogs,
  }), [
    dietProfile, foodLogs, pendingAnalysis, todaySummary, isLoading,
    updateDietProfile, toggleDiet, setPendingMealAnalysis,
    addFoodLog, updateFoodLog, deleteFoodLog, getTodayLogs,
    getLogById, getRecentLogs,
  ]);
});
