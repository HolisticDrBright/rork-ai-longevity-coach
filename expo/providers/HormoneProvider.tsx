import createContextHook from '@nkzw/create-context-hook';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { secureGetJSON, secureSetJSON } from '@/lib/secureStorage';
import { writeAuditLog } from '@/lib/auditLog';
import { recordAccessPattern } from '@/lib/breachDetection';
import { hormoneEntryService } from '@/lib/supabaseService';
import { supabase } from '@/lib/supabase';

import { HormoneEntry, HormoneSymptom, HormoneGuidance } from '@/types';

const STORAGE_KEY = 'longevity_hormone_entries';

export const hormoneSymptoms: HormoneSymptom[] = [
  { id: 'ht_1', name: 'Irritability', category: 'high_testosterone_dhea', description: 'Feeling easily annoyed or agitated' },
  { id: 'ht_2', name: 'Aggression', category: 'high_testosterone_dhea', description: 'Increased anger or aggressive feelings' },
  { id: 'ht_3', name: 'Acne', category: 'high_testosterone_dhea', description: 'Breakouts, especially on jaw/chin' },
  { id: 'ht_4', name: 'Oily Skin', category: 'high_testosterone_dhea', description: 'Excess oil production on face/scalp' },
  { id: 'ht_5', name: 'Facial Hair Growth', category: 'high_testosterone_dhea', description: 'Increased hair on face/chin' },
  { id: 'ht_6', name: 'Hair Loss', category: 'high_testosterone_dhea', description: 'Thinning hair or hair shedding' },
  
  { id: 'lp_1', name: 'Anxiety', category: 'low_progesterone', description: 'Feeling nervous or worried' },
  { id: 'lp_2', name: 'Insomnia', category: 'low_progesterone', description: 'Difficulty falling or staying asleep' },
  { id: 'lp_3', name: 'Mood Swings', category: 'low_progesterone', description: 'Rapid emotional changes' },
  { id: 'lp_4', name: 'PMS Symptoms', category: 'low_progesterone', description: 'Cramping, bloating before period' },
  { id: 'lp_5', name: 'Irregular Periods', category: 'low_progesterone', description: 'Unpredictable cycle timing' },
  { id: 'lp_6', name: 'Spotting', category: 'low_progesterone', description: 'Light bleeding between periods' },
  { id: 'lp_7', name: 'Short Luteal Phase', category: 'low_progesterone', description: 'Period comes early (less than 10 days after ovulation)' },
  
  { id: 'le_1', name: 'Hot Flashes', category: 'low_estrogen', description: 'Sudden warmth, especially upper body' },
  { id: 'le_2', name: 'Night Sweats', category: 'low_estrogen', description: 'Excessive sweating during sleep' },
  { id: 'le_3', name: 'Vaginal Dryness', category: 'low_estrogen', description: 'Discomfort or dryness' },
  { id: 'le_4', name: 'Brain Fog', category: 'low_estrogen', description: 'Difficulty concentrating or thinking clearly' },
  { id: 'le_5', name: 'Joint Pain', category: 'low_estrogen', description: 'Aches in joints without injury' },
  { id: 'le_6', name: 'Dry Skin', category: 'low_estrogen', description: 'Loss of skin elasticity and moisture' },
  { id: 'le_7', name: 'Low Libido', category: 'low_estrogen', description: 'Decreased interest in intimacy' },
  
  { id: 'he_1', name: 'Breast Tenderness', category: 'high_estrogen', description: 'Sore or swollen breasts' },
  { id: 'he_2', name: 'Bloating', category: 'high_estrogen', description: 'Water retention and puffiness' },
  { id: 'he_3', name: 'Heavy Periods', category: 'high_estrogen', description: 'Excessive menstrual bleeding' },
  { id: 'he_4', name: 'Weight Gain', category: 'high_estrogen', description: 'Especially in hips and thighs' },
  { id: 'he_5', name: 'Headaches/Migraines', category: 'high_estrogen', description: 'Hormonal headaches' },
  { id: 'he_6', name: 'Fibrocystic Breasts', category: 'high_estrogen', description: 'Lumpy or rope-like breast tissue' },
];

const categoryLabels: Record<string, string> = {
  high_testosterone_dhea: 'High Testosterone/DHEA',
  low_progesterone: 'Low Progesterone',
  low_estrogen: 'Low Estrogen',
  high_estrogen: 'High Estrogen',
};

export const [HormoneProvider, useHormones] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<HormoneEntry[]>([]);

  const entriesQuery = useQuery({
    queryKey: ['hormoneEntries'],
    queryFn: async () => {
      const stored = await secureGetJSON<HormoneEntry[]>(STORAGE_KEY);
      await recordAccessPattern('hormone_entries', 'read');
      return stored ?? [];
    },
  });

  useEffect(() => {
    if (entriesQuery.data) {
      setEntries(entriesQuery.data);
    }
  }, [entriesQuery.data]);

  const saveEntriesMutation = useMutation({
    mutationFn: async (newEntries: HormoneEntry[]) => {
      await secureSetJSON(STORAGE_KEY, newEntries);
      await writeAuditLog('PHI_UPDATE', 'hormone_entries', 'user');

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && newEntries.length > 0) {
          const latest = newEntries[0];
          console.log('[HormoneProvider] Syncing hormone entry to Supabase...');
          await hormoneEntryService.upsert({
            date: latest.date,
            cycle_day: latest.cycleDay ?? null,
            symptoms_json: latest.symptoms as unknown as Record<string, unknown>[],
            notes: latest.notes ?? null,
            current_supplements_json: latest.currentSupplements as unknown as Record<string, unknown>[] ?? null,
          });
        }
      } catch (e) {
        console.log('[HormoneProvider] Supabase sync failed (non-blocking):', e);
      }

      return newEntries;
    },
    onSuccess: (data) => {
      setEntries(data);
      void queryClient.invalidateQueries({ queryKey: ['hormoneEntries'] });
    },
  });

  const addEntry = useCallback((entry: Omit<HormoneEntry, 'id'>) => {
    const newEntry: HormoneEntry = {
      ...entry,
      id: `hormone_${Date.now()}`,
    };
    const updated = [newEntry, ...entries];
    saveEntriesMutation.mutate(updated);
  }, [entries, saveEntriesMutation]);

  const updateEntry = useCallback((id: string, updates: Partial<HormoneEntry>) => {
    const updated = entries.map(e => e.id === id ? { ...e, ...updates } : e);
    saveEntriesMutation.mutate(updated);
  }, [entries, saveEntriesMutation]);

  const deleteEntry = useCallback((id: string) => {
    const updated = entries.filter(e => e.id !== id);
    saveEntriesMutation.mutate(updated);
  }, [entries, saveEntriesMutation]);

  const getGuidance = useCallback((entry: HormoneEntry): HormoneGuidance[] => {
    const categoryScores: Record<string, number> = {
      high_testosterone_dhea: 0,
      low_progesterone: 0,
      low_estrogen: 0,
      high_estrogen: 0,
    };

    const categoryCounts: Record<string, number> = {
      high_testosterone_dhea: 0,
      low_progesterone: 0,
      low_estrogen: 0,
      high_estrogen: 0,
    };

    entry.symptoms.forEach(s => {
      const symptom = hormoneSymptoms.find(hs => hs.id === s.symptomId);
      if (symptom && s.severity > 0) {
        categoryScores[symptom.category] += s.severity;
        categoryCounts[symptom.category]++;
      }
    });

    const guidance: HormoneGuidance[] = [];

    if (categoryScores.high_testosterone_dhea > 0) {
      const _avgScore = categoryScores.high_testosterone_dhea / Math.max(categoryCounts.high_testosterone_dhea, 1);
      const maxPossible = categoryCounts.high_testosterone_dhea * 4;
      const normalizedScore = maxPossible > 0 ? (categoryScores.high_testosterone_dhea / maxPossible) * 100 : 0;
      
      let status: 'high' | 'low' | 'normal' = 'normal';
      let dosageAction: 'increase' | 'decrease' | 'maintain' | 'consult' = 'maintain';
      let recommendation = '';

      if (normalizedScore >= 60) {
        status = 'high';
        dosageAction = 'decrease';
        recommendation = 'Consider reducing DHEA or Testosterone supplementation. These symptoms suggest androgen levels may be elevated.';
      } else if (normalizedScore >= 30) {
        status = 'normal';
        dosageAction = 'maintain';
        recommendation = 'Monitor symptoms. Current DHEA/Testosterone dose may be appropriate but watch for increases.';
      } else {
        status = 'normal';
        dosageAction = 'maintain';
        recommendation = 'Androgen-related symptoms are minimal. Continue current protocol.';
      }

      guidance.push({
        hormone: 'Testosterone/DHEA',
        status,
        score: Math.round(normalizedScore),
        recommendation,
        dosageAction,
        supplements: ['DHEA', 'Testosterone cream', '7-Keto DHEA'],
      });
    }

    if (categoryScores.low_progesterone > 0) {
      const maxPossible = categoryCounts.low_progesterone * 4;
      const normalizedScore = maxPossible > 0 ? (categoryScores.low_progesterone / maxPossible) * 100 : 0;
      
      let status: 'high' | 'low' | 'normal' = 'normal';
      let dosageAction: 'increase' | 'decrease' | 'maintain' | 'consult' = 'maintain';
      let recommendation = '';

      if (normalizedScore >= 60) {
        status = 'low';
        dosageAction = 'increase';
        recommendation = 'Symptoms suggest progesterone may be low. Consider increasing progesterone supplementation, especially during luteal phase (days 14-28).';
      } else if (normalizedScore >= 30) {
        status = 'low';
        dosageAction = 'consult';
        recommendation = 'Moderate low-progesterone symptoms present. Consider slight dosage adjustment or timing changes.';
      } else {
        status = 'normal';
        dosageAction = 'maintain';
        recommendation = 'Progesterone-related symptoms are well controlled. Maintain current protocol.';
      }

      guidance.push({
        hormone: 'Progesterone',
        status,
        score: Math.round(normalizedScore),
        recommendation,
        dosageAction,
        supplements: ['Progesterone cream', 'Oral progesterone', 'Vitex (Chasteberry)'],
      });
    }

    if (categoryScores.low_estrogen > 0) {
      const maxPossible = categoryCounts.low_estrogen * 4;
      const normalizedScore = maxPossible > 0 ? (categoryScores.low_estrogen / maxPossible) * 100 : 0;
      
      let status: 'high' | 'low' | 'normal' = 'normal';
      let dosageAction: 'increase' | 'decrease' | 'maintain' | 'consult' = 'maintain';
      let recommendation = '';

      if (normalizedScore >= 60) {
        status = 'low';
        dosageAction = 'increase';
        recommendation = 'Significant low estrogen symptoms. Consider increasing estrogen support or adding phytoestrogens.';
      } else if (normalizedScore >= 30) {
        status = 'low';
        dosageAction = 'consult';
        recommendation = 'Some low estrogen symptoms present. Evaluate if estrogen support is needed.';
      } else {
        status = 'normal';
        dosageAction = 'maintain';
        recommendation = 'Estrogen-related symptoms are minimal. Continue current protocol.';
      }

      guidance.push({
        hormone: 'Estrogen',
        status,
        score: Math.round(normalizedScore),
        recommendation,
        dosageAction,
        supplements: ['Estradiol', 'Estriol', 'DIM', 'Maca'],
      });
    }

    if (categoryScores.high_estrogen > 0) {
      const maxPossible = categoryCounts.high_estrogen * 4;
      const normalizedScore = maxPossible > 0 ? (categoryScores.high_estrogen / maxPossible) * 100 : 0;
      
      let status: 'high' | 'low' | 'normal' = 'normal';
      let dosageAction: 'increase' | 'decrease' | 'maintain' | 'consult' = 'maintain';
      let recommendation = '';

      if (normalizedScore >= 60) {
        status = 'high';
        dosageAction = 'decrease';
        recommendation = 'Estrogen dominance symptoms are significant. Consider reducing estrogen supplementation and adding DIM or calcium d-glucarate for estrogen metabolism support.';
      } else if (normalizedScore >= 30) {
        status = 'high';
        dosageAction = 'consult';
        recommendation = 'Some estrogen dominance symptoms present. Monitor and consider DIM supplementation.';
      } else {
        status = 'normal';
        dosageAction = 'maintain';
        recommendation = 'Estrogen levels appear balanced. Continue current protocol.';
      }

      guidance.push({
        hormone: 'Estrogen (Dominance)',
        status,
        score: Math.round(normalizedScore),
        recommendation,
        dosageAction,
        supplements: ['DIM', 'Calcium D-Glucarate', 'I3C'],
      });
    }

    return guidance;
  }, []);

  const todayEntry = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    return entries.find(e => e.date === today);
  }, [entries]);

  const recentEntries = useMemo(() => {
    return entries.slice(0, 14);
  }, [entries]);

  const currentGuidance = useMemo(() => {
    if (!todayEntry) return [];
    return getGuidance(todayEntry);
  }, [todayEntry, getGuidance]);

  return useMemo(() => ({
    entries,
    todayEntry,
    recentEntries,
    currentGuidance,
    hormoneSymptoms,
    categoryLabels,
    isLoading: entriesQuery.isLoading,
    addEntry,
    updateEntry,
    deleteEntry,
    getGuidance,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    entries, todayEntry, recentEntries, currentGuidance,
    entriesQuery.isLoading,
    addEntry, updateEntry, deleteEntry, getGuidance,
  ]);
});
