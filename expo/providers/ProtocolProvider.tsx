import createContextHook from '@nkzw/create-context-hook';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureGetJSON, secureSetJSON } from '@/lib/secureStorage';
import { writeAuditLog } from '@/lib/auditLog';
import { protocolService, adherenceService } from '@/lib/supabaseService';
import { supabase } from '@/lib/supabase';

import {
  Protocol,
  DailyAdherence,
  WeeklyCheckIn,
  TodayAction,
  DailySymptoms,
  PeptideData,
  DosingGuidance,
  PeptideEvidence,
  PeptideProtocolTemplate,
  UserPeptidePlan,
  PeptideRecommendation,
  PeptideGoal,
} from '@/types';
import { sampleProtocol } from '@/mocks/protocols';
import { CONDITION_PROTOCOLS } from '@/mocks/conditionProtocols';
import {
  PEPTIDES_DATABASE,
  DOSING_GUIDANCE,
  PEPTIDE_EVIDENCE,
  PEPTIDE_PROTOCOLS,
} from '@/mocks/peptides';

const STORAGE_KEYS = {
  PROTOCOLS: 'longevity_protocols',
  DAILY_ADHERENCE: 'longevity_daily_adherence',
  WEEKLY_CHECKINS: 'longevity_weekly_checkins',
  USER_PEPTIDE_PLANS: 'longevity_user_peptide_plans',
  PEPTIDE_ACKNOWLEDGMENT: 'longevity_peptide_acknowledged',
};

const getTodayDate = () => new Date().toISOString().split('T')[0];

export const [ProtocolProvider, useProtocol] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [protocols, setProtocols] = useState<Protocol[]>([sampleProtocol]);
  const [dailyAdherence, setDailyAdherence] = useState<DailyAdherence[]>([]);
  const [weeklyCheckIns, setWeeklyCheckIns] = useState<WeeklyCheckIn[]>([]);
  const [userPeptidePlans, setUserPeptidePlans] = useState<UserPeptidePlan[]>([]);
  const [peptideAcknowledged, setPeptideAcknowledged] = useState(false);

  const protocolsQuery = useQuery({
    queryKey: ['protocols'],
    queryFn: async () => {
      const stored = await secureGetJSON<Protocol[]>(STORAGE_KEYS.PROTOCOLS);
      return stored ?? [sampleProtocol];
    },
  });

  const adherenceQuery = useQuery({
    queryKey: ['dailyAdherence'],
    queryFn: async () => {
      const stored = await secureGetJSON<DailyAdherence[]>(STORAGE_KEYS.DAILY_ADHERENCE);
      return stored ?? [];
    },
  });

  const checkInsQuery = useQuery({
    queryKey: ['weeklyCheckIns'],
    queryFn: async () => {
      const stored = await secureGetJSON<WeeklyCheckIn[]>(STORAGE_KEYS.WEEKLY_CHECKINS);
      return stored ?? [];
    },
  });

  const peptidePlansQuery = useQuery({
    queryKey: ['userPeptidePlans'],
    queryFn: async () => {
      const stored = await secureGetJSON<UserPeptidePlan[]>(STORAGE_KEYS.USER_PEPTIDE_PLANS);
      return stored ?? [];
    },
  });

  const peptideAckQuery = useQuery({
    queryKey: ['peptideAcknowledgment'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.PEPTIDE_ACKNOWLEDGMENT);
      return stored === 'true';
    
    },
  });

  useEffect(() => {
    if (protocolsQuery.data) setProtocols(protocolsQuery.data);
  }, [protocolsQuery.data]);

  useEffect(() => {
    if (adherenceQuery.data) setDailyAdherence(adherenceQuery.data);
  }, [adherenceQuery.data]);

  useEffect(() => {
    if (checkInsQuery.data) setWeeklyCheckIns(checkInsQuery.data);
  }, [checkInsQuery.data]);

  useEffect(() => {
    if (peptidePlansQuery.data) setUserPeptidePlans(peptidePlansQuery.data);
  }, [peptidePlansQuery.data]);

  useEffect(() => {
    if (peptideAckQuery.data !== undefined) setPeptideAcknowledged(peptideAckQuery.data);
  }, [peptideAckQuery.data]);

  const _saveProtocolsMutation = useMutation({
    mutationFn: async (data: Protocol[]) => {
      await secureSetJSON(STORAGE_KEYS.PROTOCOLS, data);
      await writeAuditLog('PHI_UPDATE', 'protocols', 'user');

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          console.log('[ProtocolProvider] Syncing protocols to Supabase...');
          for (const protocol of data) {
            await protocolService.upsert({
              name: protocol.name,
              description: protocol.description || null,
              start_date: protocol.startDate,
              end_date: protocol.endDate || null,
              status: protocol.status,
              version: protocol.version || 1,
              supplements_json: protocol.supplements as unknown as Record<string, unknown>[],
              peptides_json: protocol.peptides as unknown as Record<string, unknown>[],
              fasting_plan_json: protocol.fastingPlan as unknown as Record<string, unknown> | null,
              lifestyle_tasks_json: protocol.lifestyleTasks as unknown as Record<string, unknown>[],
            });
          }
        }
      } catch (e) {
        console.log('[ProtocolProvider] Supabase sync failed (non-blocking):', e);
      }

      return data;
    },
    onSuccess: (data) => {
      setProtocols(data);
      void queryClient.invalidateQueries({ queryKey: ['protocols'] });
    },
  });

  const saveAdherenceMutation = useMutation({
    mutationFn: async (data: DailyAdherence[]) => {
      await secureSetJSON(STORAGE_KEYS.DAILY_ADHERENCE, data);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session && data.length > 0) {
          const latest = data[data.length - 1];
          console.log('[ProtocolProvider] Syncing adherence to Supabase...');
          await adherenceService.upsert({
            date: latest.date,
            protocol_id: latest.protocolId,
            completed_supplements: latest.completedSupplements,
            completed_peptides: latest.completedPeptides,
            completed_tasks: latest.completedTasks,
            fasting_completed: latest.fastingCompleted,
            symptoms_json: latest.symptoms as unknown as Record<string, unknown>,
          });
        }
      } catch (e) {
        console.log('[ProtocolProvider] Supabase adherence sync failed (non-blocking):', e);
      }

      return data;
    },
    onSuccess: (data) => {
      setDailyAdherence(data);
      void queryClient.invalidateQueries({ queryKey: ['dailyAdherence'] });
    },
  });

  const saveCheckInsMutation = useMutation({
    mutationFn: async (data: WeeklyCheckIn[]) => {
      await secureSetJSON(STORAGE_KEYS.WEEKLY_CHECKINS, data);
      return data;
    },
    onSuccess: (data) => {
      setWeeklyCheckIns(data);
      void queryClient.invalidateQueries({ queryKey: ['weeklyCheckIns'] });
    },
  });

  const savePeptidePlansMutation = useMutation({
    mutationFn: async (data: UserPeptidePlan[]) => {
      await secureSetJSON(STORAGE_KEYS.USER_PEPTIDE_PLANS, data);
      await writeAuditLog('PHI_UPDATE', 'peptide_plans', 'user');
      return data;
    },
    onSuccess: (data) => {
      setUserPeptidePlans(data);
      void queryClient.invalidateQueries({ queryKey: ['userPeptidePlans'] });
    },
  });

  const savePeptideAckMutation = useMutation({
    mutationFn: async (acknowledged: boolean) => {
      await AsyncStorage.setItem(STORAGE_KEYS.PEPTIDE_ACKNOWLEDGMENT, String(acknowledged));
      return acknowledged;
    },
    onSuccess: (data) => {
      setPeptideAcknowledged(data);
      void queryClient.invalidateQueries({ queryKey: ['peptideAcknowledgment'] });
    },
  });

  const activeProtocol = useMemo(() => {
    return protocols.find(p => p.status === 'active') || null;
  }, [protocols]);

  const todayActions = useMemo((): TodayAction[] => {
    if (!activeProtocol) return [];

    const actions: TodayAction[] = [];
    const today = getTodayDate();
    const todayAdherence = dailyAdherence.find(a => a.date === today);

    activeProtocol.supplements.forEach(sup => {
      actions.push({
        id: `action_sup_${sup.id}`,
        type: 'supplement',
        name: sup.name,
        details: `${sup.dose} - ${sup.brand || 'Generic'}`,
        timing: sup.timing.replace('_', ' '),
        completed: todayAdherence?.completedSupplements.includes(sup.id) || false,
        itemId: sup.id,
      });
    });

    activeProtocol.peptides.forEach(pep => {
      actions.push({
        id: `action_pep_${pep.id}`,
        type: 'peptide',
        name: pep.name,
        details: pep.dose,
        timing: pep.timing,
        completed: todayAdherence?.completedPeptides.includes(pep.id) || false,
        itemId: pep.id,
      });
    });

    if (activeProtocol.fastingPlan) {
      const fp = activeProtocol.fastingPlan;
      actions.push({
        id: `action_fast_${fp.id}`,
        type: 'fasting',
        name: 'Fasting Window',
        details: `Eating: ${fp.eatingWindow.start} - ${fp.eatingWindow.end}`,
        timing: fp.type === 'intermittent' ? '16:8' : fp.type,
        completed: todayAdherence?.fastingCompleted || false,
        itemId: fp.id,
      });
    }

    activeProtocol.lifestyleTasks.forEach(task => {
      actions.push({
        id: `action_task_${task.id}`,
        type: 'task',
        name: task.name,
        details: task.target ? `${task.target} ${task.unit}` : task.frequency,
        timing: task.timing || 'Anytime',
        completed: todayAdherence?.completedTasks.includes(task.id) || false,
        itemId: task.id,
      });
    });

    return actions;
  }, [activeProtocol, dailyAdherence]);

  const todayAdherence = useMemo(() => {
    const today = getTodayDate();
    return dailyAdherence.find(a => a.date === today) || null;
  }, [dailyAdherence]);

  const toggleActionComplete = useCallback((action: TodayAction) => {
    if (!activeProtocol) return;

    const today = getTodayDate();
    let currentAdherence = dailyAdherence.find(a => a.date === today);

    if (!currentAdherence) {
      currentAdherence = {
        id: `adh_${Date.now()}`,
        date: today,
        protocolId: activeProtocol.id,
        completedSupplements: [],
        completedPeptides: [],
        completedTasks: [],
        fastingCompleted: false,
        symptoms: { energy: 5, sleep: 5, mood: 5, digestion: 5, focus: 5 },
      };
    }

    const newAdherence = { ...currentAdherence };
    const isCompleted = action.completed;

    switch (action.type) {
      case 'supplement':
        newAdherence.completedSupplements = isCompleted
          ? newAdherence.completedSupplements.filter(id => id !== action.itemId)
          : [...newAdherence.completedSupplements, action.itemId];
        break;
      case 'peptide':
        newAdherence.completedPeptides = isCompleted
          ? newAdherence.completedPeptides.filter(id => id !== action.itemId)
          : [...newAdherence.completedPeptides, action.itemId];
        break;
      case 'task':
        newAdherence.completedTasks = isCompleted
          ? newAdherence.completedTasks.filter(id => id !== action.itemId)
          : [...newAdherence.completedTasks, action.itemId];
        break;
      case 'fasting':
        newAdherence.fastingCompleted = !isCompleted;
        break;
    }

    const otherAdherence = dailyAdherence.filter(a => a.date !== today);
    saveAdherenceMutation.mutate([...otherAdherence, newAdherence]);
  }, [activeProtocol, dailyAdherence, saveAdherenceMutation]);

  const updateDailySymptoms = useCallback((symptoms: DailySymptoms) => {
    if (!activeProtocol) return;

    const today = getTodayDate();
    let currentAdherence = dailyAdherence.find(a => a.date === today);

    if (!currentAdherence) {
      currentAdherence = {
        id: `adh_${Date.now()}`,
        date: today,
        protocolId: activeProtocol.id,
        completedSupplements: [],
        completedPeptides: [],
        completedTasks: [],
        fastingCompleted: false,
        symptoms,
      };
    } else {
      currentAdherence = { ...currentAdherence, symptoms };
    }

    const otherAdherence = dailyAdherence.filter(a => a.date !== today);
    saveAdherenceMutation.mutate([...otherAdherence, currentAdherence]);
  }, [activeProtocol, dailyAdherence, saveAdherenceMutation]);

  const saveWeeklyCheckIn = useCallback((checkIn: Omit<WeeklyCheckIn, 'id' | 'date'>) => {
    const today = getTodayDate();
    const newCheckIn: WeeklyCheckIn = {
      ...checkIn,
      id: `checkin_${Date.now()}`,
      date: today,
    };

    const otherCheckIns = weeklyCheckIns.filter(c => c.date !== today);
    saveCheckInsMutation.mutate([...otherCheckIns, newCheckIn]);
  }, [weeklyCheckIns, saveCheckInsMutation]);

  const adherencePercentage = useMemo(() => {
    if (todayActions.length === 0) return 0;
    const completed = todayActions.filter(a => a.completed).length;
    return Math.round((completed / todayActions.length) * 100);
  }, [todayActions]);

  const weeklyAdherenceStats = useMemo(() => {
    const last7Days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      last7Days.push(date.toISOString().split('T')[0]);
    }

    return last7Days.map(date => {
      const dayAdherence = dailyAdherence.find(a => a.date === date);
      if (!dayAdherence || !activeProtocol) return { date, percentage: 0 };

      const totalItems = 
        activeProtocol.supplements.length +
        activeProtocol.peptides.length +
        activeProtocol.lifestyleTasks.length +
        (activeProtocol.fastingPlan ? 1 : 0);

      const completedItems = 
        dayAdherence.completedSupplements.length +
        dayAdherence.completedPeptides.length +
        dayAdherence.completedTasks.length +
        (dayAdherence.fastingCompleted ? 1 : 0);

      return {
        date,
        percentage: totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0,
      };
    });
  }, [dailyAdherence, activeProtocol]);

  const isLoading = protocolsQuery.isLoading || adherenceQuery.isLoading || checkInsQuery.isLoading;

  const conditionProtocols = CONDITION_PROTOCOLS;

  const peptideDatabase = PEPTIDES_DATABASE;
  const dosingGuidance = DOSING_GUIDANCE;
  const peptideEvidence = PEPTIDE_EVIDENCE;
  const peptideProtocols = PEPTIDE_PROTOCOLS;

  const getPeptideRecommendations = useCallback((userGoals: PeptideGoal[], contraindications: string[] = []): PeptideRecommendation[] => {
    return peptideDatabase
      .map(peptide => {
        const matchedGoals = peptide.goals.filter(g => userGoals.includes(g));
        const matchScore = matchedGoals.length / userGoals.length;
        
        const hasContraindications = peptide.contraindications.some(
          c => contraindications.some(userC => 
            c.condition.toLowerCase().includes(userC.toLowerCase())
          )
        );

        const contraindicationNotes = hasContraindications
          ? peptide.contraindications
              .filter(c => contraindications.some(userC => 
                c.condition.toLowerCase().includes(userC.toLowerCase())
              ))
              .map(c => c.condition)
              .join(', ')
          : undefined;

        return {
          peptide,
          matchScore,
          matchedGoals,
          reasoning: `Matches ${matchedGoals.length} of your goals: ${matchedGoals.join(', ')}`,
          hasContraindications,
          contraindicationNotes,
        };
      })
      .filter(r => r.matchScore > 0)
      .sort((a, b) => {
        if (a.hasContraindications !== b.hasContraindications) {
          return a.hasContraindications ? 1 : -1;
        }
        return b.matchScore - a.matchScore;
      });
  }, [peptideDatabase]);

  const getPeptideById = useCallback((id: string): PeptideData | undefined => {
    return peptideDatabase.find(p => p.id === id);
  }, [peptideDatabase]);

  const getDosingForPeptide = useCallback((peptideId: string): DosingGuidance[] => {
    return dosingGuidance.filter(d => d.peptideId === peptideId);
  }, [dosingGuidance]);

  const getEvidenceForPeptide = useCallback((peptideId: string): PeptideEvidence[] => {
    return peptideEvidence.filter(e => e.peptideId === peptideId);
  }, [peptideEvidence]);

  const getProtocolsForPeptide = useCallback((peptideId: string): PeptideProtocolTemplate[] => {
    return peptideProtocols.filter(p => p.peptideIds.includes(peptideId));
  }, [peptideProtocols]);

  const addPeptideToPlan = useCallback((plan: Omit<UserPeptidePlan, 'id'>) => {
    const newPlan: UserPeptidePlan = {
      ...plan,
      id: `plan_${Date.now()}`,
    };
    savePeptidePlansMutation.mutate([...userPeptidePlans, newPlan]);
  }, [userPeptidePlans, savePeptidePlansMutation]);

  const removePeptideFromPlan = useCallback((planId: string) => {
    savePeptidePlansMutation.mutate(userPeptidePlans.filter(p => p.id !== planId));
  }, [userPeptidePlans, savePeptidePlansMutation]);

  const acknowledgePeptideDisclaimer = useCallback(() => {
    savePeptideAckMutation.mutate(true);
  }, [savePeptideAckMutation]);

  return useMemo(() => ({
    protocols,
    activeProtocol,
    todayActions,
    todayAdherence,
    dailyAdherence,
    weeklyCheckIns,
    adherencePercentage,
    weeklyAdherenceStats,
    conditionProtocols,
    isLoading,
    toggleActionComplete,
    updateDailySymptoms,
    saveWeeklyCheckIn,
    peptideDatabase,
    dosingGuidance,
    peptideEvidence,
    peptideProtocols,
    userPeptidePlans,
    peptideAcknowledged,
    getPeptideRecommendations,
    getPeptideById,
    getDosingForPeptide,
    getEvidenceForPeptide,
    getProtocolsForPeptide,
    addPeptideToPlan,
    removePeptideFromPlan,
    acknowledgePeptideDisclaimer,
  }), [
    protocols, activeProtocol, todayActions, todayAdherence, dailyAdherence,
    weeklyCheckIns, adherencePercentage, weeklyAdherenceStats, conditionProtocols,
    isLoading, toggleActionComplete, updateDailySymptoms, saveWeeklyCheckIn,
    peptideDatabase, dosingGuidance, peptideEvidence, peptideProtocols,
    userPeptidePlans, peptideAcknowledged, getPeptideRecommendations,
    getPeptideById, getDosingForPeptide, getEvidenceForPeptide,
    getProtocolsForPeptide, addPeptideToPlan, removePeptideFromPlan,
    acknowledgePeptideDisclaimer,
  ]);
});
