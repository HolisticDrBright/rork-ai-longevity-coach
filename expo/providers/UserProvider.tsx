import createContextHook from '@nkzw/create-context-hook';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureGetJSON, secureSetJSON, secureMultiRemove } from '@/lib/secureStorage';
import { writeAuditLog } from '@/lib/auditLog';
import { recordAccessPattern } from '@/lib/breachDetection';
import { sendAssessmentComplete, AssessmentScore } from '@/lib/webhooks';
import { profileService, lifestyleService, contraindicationService } from '@/lib/supabaseService';
import { supabase } from '@/lib/supabase';

import {
  UserProfile,
  LifestyleProfile,
  Contraindication,
  QuestionnaireResponse,
  CategoryScore,
  AppUserRole,
  ChiefComplaint,
  AssociatedSymptom,
  ClinicalIntake,
} from '@/types';
import { questionnaireCategories } from '@/mocks/questionnaire';

const STORAGE_KEYS = {
  USER_PROFILE: 'longevity_user_profile',
  LIFESTYLE_PROFILE: 'longevity_lifestyle_profile',
  CONTRAINDICATIONS: 'longevity_contraindications',
  QUESTIONNAIRE_RESPONSES: 'longevity_questionnaire_responses',
  CLINICAL_INTAKE: 'longevity_clinical_intake',
};

const PENDING_ROLE_KEY = 'longevity_pending_role';

const defaultUserProfile: UserProfile = {
  id: '',
  firstName: '',
  lastName: '',
  email: '',
  dateOfBirth: '',
  sex: 'male',
  height: 0,
  weight: 0,
  goals: [],
  onboardingCompleted: false,
  createdAt: new Date().toISOString(),
  role: 'patient',
};

const defaultLifestyleProfile: LifestyleProfile = {
  sleepHours: 7,
  sleepQuality: 5,
  stressLevel: 5,
  dietType: 'omnivore',
  cookingSkill: 'basic',
  shoppingCadence: 'weekly',
  exerciseFrequency: 3,
  exerciseTypes: [],
};

const defaultContraindications: Contraindication = {
  pregnant: false,
  nursing: false,
  medications: [],
  allergies: [],
  conditions: [],
};

export const [UserProvider, useUser] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [userProfile, setUserProfile] = useState<UserProfile>(defaultUserProfile);
  const [lifestyleProfile, setLifestyleProfile] = useState<LifestyleProfile>(defaultLifestyleProfile);
  const [contraindications, setContraindications] = useState<Contraindication>(defaultContraindications);
  const [questionnaireResponses, setQuestionnaireResponses] = useState<QuestionnaireResponse[]>([]);
  const [clinicalIntake, setClinicalIntake] = useState<ClinicalIntake | null>(null);

  const userQuery = useQuery({
    queryKey: ['userProfile'],
    queryFn: async () => {
      const stored = await secureGetJSON<UserProfile>(STORAGE_KEYS.USER_PROFILE);
      await recordAccessPattern('user_profile', 'read');
      return stored ?? defaultUserProfile;
    },
  });

  const lifestyleQuery = useQuery({
    queryKey: ['lifestyleProfile'],
    queryFn: async () => {
      const stored = await secureGetJSON<LifestyleProfile>(STORAGE_KEYS.LIFESTYLE_PROFILE);
      return stored ?? defaultLifestyleProfile;
    },
  });

  const contraindicationsQuery = useQuery({
    queryKey: ['contraindications'],
    queryFn: async () => {
      const stored = await secureGetJSON<Contraindication>(STORAGE_KEYS.CONTRAINDICATIONS);
      return stored ?? defaultContraindications;
    },
  });

  const responsesQuery = useQuery({
    queryKey: ['questionnaireResponses'],
    queryFn: async () => {
      const stored = await secureGetJSON<QuestionnaireResponse[]>(STORAGE_KEYS.QUESTIONNAIRE_RESPONSES);
      return stored ?? [];
    },
  });

  const clinicalIntakeQuery = useQuery({
    queryKey: ['clinicalIntake'],
    queryFn: async () => {
      const stored = await secureGetJSON<ClinicalIntake>(STORAGE_KEYS.CLINICAL_INTAKE);
      return stored ?? null;
    },
  });

  const pendingRoleAppliedRef = useRef<boolean>(false);

  useEffect(() => {
    if (userQuery.data) setUserProfile(userQuery.data);
  }, [userQuery.data]);

  const supabaseProfileQuery = useQuery({
    queryKey: ['supabaseProfile'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;
      console.log('[UserProvider] Hydrating profile from Supabase...');
      const [profileRes, lifestyleRes, contraRes, questionnaireRes] = await Promise.all([
        profileService.get(),
        lifestyleService.get(),
        contraindicationService.get(),
        supabase.from('questionnaire_responses').select('*').eq('user_id', session.user.id),
      ]);
      return {
        profile: profileRes.data,
        lifestyle: lifestyleRes.data,
        contraindications: contraRes.data,
        questionnaire: questionnaireRes.data,
      };
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
        void queryClient.invalidateQueries({ queryKey: ['supabaseProfile'] });
      }
      if (event === 'SIGNED_OUT') {
        void queryClient.invalidateQueries({ queryKey: ['supabaseProfile'] });
      }
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  useEffect(() => {
    const remote = supabaseProfileQuery.data;
    if (!remote) return;

    if (remote.profile) {
      const r = remote.profile;
      const merged: UserProfile = {
        ...defaultUserProfile,
        ...userProfile,
        id: r.id || userProfile.id,
        email: r.email ?? userProfile.email,
        firstName: r.first_name ?? userProfile.firstName,
        lastName: r.last_name ?? userProfile.lastName,
        sex: (r.sex as UserProfile['sex']) ?? userProfile.sex,
        dateOfBirth: r.birth_date ?? userProfile.dateOfBirth,
        height: r.height ?? userProfile.height,
        weight: r.weight ?? userProfile.weight,
        goals: r.goals ?? userProfile.goals,
        onboardingCompleted: r.onboarding_completed || userProfile.onboardingCompleted,
      };
      const changed =
        merged.onboardingCompleted !== userProfile.onboardingCompleted ||
        merged.id !== userProfile.id ||
        merged.email !== userProfile.email ||
        merged.firstName !== userProfile.firstName;
      if (changed) {
        console.log('[UserProvider] Applying remote profile (onboardingCompleted=' + merged.onboardingCompleted + ')');
        setUserProfile(merged);
        void secureSetJSON(STORAGE_KEYS.USER_PROFILE, merged);
      }
    }

    if (remote.lifestyle) {
      const l = remote.lifestyle;
      const mergedLifestyle: LifestyleProfile = {
        sleepHours: l.sleep_hours ?? defaultLifestyleProfile.sleepHours,
        sleepQuality: l.sleep_quality ?? defaultLifestyleProfile.sleepQuality,
        stressLevel: l.stress_level ?? defaultLifestyleProfile.stressLevel,
        dietType: (l.diet_type as LifestyleProfile['dietType']) ?? defaultLifestyleProfile.dietType,
        cookingSkill: (l.cooking_skill as LifestyleProfile['cookingSkill']) ?? defaultLifestyleProfile.cookingSkill,
        shoppingCadence: (l.shopping_cadence as LifestyleProfile['shoppingCadence']) ?? defaultLifestyleProfile.shoppingCadence,
        exerciseFrequency: l.exercise_frequency ?? defaultLifestyleProfile.exerciseFrequency,
        exerciseTypes: l.exercise_types ?? [],
      };
      setLifestyleProfile(mergedLifestyle);
      void secureSetJSON(STORAGE_KEYS.LIFESTYLE_PROFILE, mergedLifestyle);
    }

    if (remote.contraindications) {
      const c = remote.contraindications;
      const mergedContra: Contraindication = {
        pregnant: c.pregnant ?? false,
        nursing: c.nursing ?? false,
        medications: c.medications ?? [],
        allergies: c.allergies ?? [],
        conditions: c.conditions ?? [],
      };
      setContraindications(mergedContra);
      void secureSetJSON(STORAGE_KEYS.CONTRAINDICATIONS, mergedContra);
    }

    if (remote.questionnaire && remote.questionnaire.length > 0) {
      const responses: QuestionnaireResponse[] = remote.questionnaire.map((row: { question_id: string; category_id: string; severity: number; timestamp: string }) => ({
        questionId: row.question_id,
        categoryId: row.category_id,
        severity: row.severity as 0 | 1 | 2 | 3 | 4,
        timestamp: row.timestamp,
      }));
      setQuestionnaireResponses(responses);
      void secureSetJSON(STORAGE_KEYS.QUESTIONNAIRE_RESPONSES, responses);
    }
  }, [supabaseProfileQuery.data]);

  useEffect(() => {
    if (userQuery.isLoading || pendingRoleAppliedRef.current) return;
    (async () => {
      try {
        const pendingRole = await AsyncStorage.getItem(PENDING_ROLE_KEY);
        if (!pendingRole) return;
        pendingRoleAppliedRef.current = true;
        const current = userQuery.data ?? defaultUserProfile;
        if (pendingRole === 'clinician') {
          if (current.role !== 'clinician' || !current.onboardingCompleted) {
            const id = current.id || `clinician_${Date.now()}`;
            const updated: UserProfile = {
              ...current,
              id,
              role: 'clinician',
              onboardingCompleted: true,
            };
            await secureSetJSON(STORAGE_KEYS.USER_PROFILE, updated);
            setUserProfile(updated);
            void queryClient.invalidateQueries({ queryKey: ['userProfile'] });
            console.log('[UserProvider] Applied pending clinician role');
          }
        } else if (pendingRole === 'patient' && current.role !== 'patient') {
          const updated: UserProfile = { ...current, role: 'patient' };
          await secureSetJSON(STORAGE_KEYS.USER_PROFILE, updated);
          setUserProfile(updated);
          void queryClient.invalidateQueries({ queryKey: ['userProfile'] });
        }
        await AsyncStorage.removeItem(PENDING_ROLE_KEY);
      } catch (e) {
        console.log('[UserProvider] pending role apply failed', e);
      }
    })();
  }, [userQuery.isLoading, userQuery.data, queryClient]);

  useEffect(() => {
    if (lifestyleQuery.data) setLifestyleProfile(lifestyleQuery.data);
  }, [lifestyleQuery.data]);

  useEffect(() => {
    if (contraindicationsQuery.data) setContraindications(contraindicationsQuery.data);
  }, [contraindicationsQuery.data]);

  useEffect(() => {
    if (responsesQuery.data) setQuestionnaireResponses(responsesQuery.data);
  }, [responsesQuery.data]);

  useEffect(() => {
    if (clinicalIntakeQuery.data) setClinicalIntake(clinicalIntakeQuery.data);
  }, [clinicalIntakeQuery.data]);

  const saveUserMutation = useMutation({
    mutationFn: async (profile: UserProfile) => {
      await secureSetJSON(STORAGE_KEYS.USER_PROFILE, profile);
      await writeAuditLog('PHI_UPDATE', 'user_profile', profile.id || 'unknown');

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          console.log('[UserProvider] Syncing profile to Supabase...');
          await profileService.upsert({
            id: session.user.id,
            email: profile.email || null,
            first_name: profile.firstName || null,
            last_name: profile.lastName || null,
            full_name: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || null,
            sex: profile.sex || null,
            birth_date: profile.dateOfBirth || null,
            height: profile.height || null,
            weight: profile.weight || null,
            goals: profile.goals.length > 0 ? profile.goals : null,
            onboarding_completed: profile.onboardingCompleted,
          });
        }
      } catch (e) {
        console.log('[UserProvider] Supabase sync failed (non-blocking):', e);
      }

      return profile;
    },
    onSuccess: (data) => {
      setUserProfile(data);
      void queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    },
  });

  const saveLifestyleMutation = useMutation({
    mutationFn: async (profile: LifestyleProfile) => {
      await secureSetJSON(STORAGE_KEYS.LIFESTYLE_PROFILE, profile);
      await writeAuditLog('PHI_UPDATE', 'lifestyle_profile', 'user');

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          console.log('[UserProvider] Syncing lifestyle to Supabase...');
          await lifestyleService.upsert({
            user_id: session.user.id,
            sleep_hours: profile.sleepHours,
            sleep_quality: profile.sleepQuality,
            stress_level: profile.stressLevel,
            diet_type: profile.dietType,
            cooking_skill: profile.cookingSkill,
            shopping_cadence: profile.shoppingCadence,
            exercise_frequency: profile.exerciseFrequency,
            exercise_types: profile.exerciseTypes,
          });
        }
      } catch (e) {
        console.log('[UserProvider] Supabase lifestyle sync failed (non-blocking):', e);
      }

      return profile;
    },
    onSuccess: (data) => {
      setLifestyleProfile(data);
      void queryClient.invalidateQueries({ queryKey: ['lifestyleProfile'] });
    },
  });

  const saveContraindicationsMutation = useMutation({
    mutationFn: async (data: Contraindication) => {
      await secureSetJSON(STORAGE_KEYS.CONTRAINDICATIONS, data);
      await writeAuditLog('PHI_UPDATE', 'contraindications', 'user');

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          console.log('[UserProvider] Syncing contraindications to Supabase...');
          await contraindicationService.upsert({
            user_id: session.user.id,
            pregnant: data.pregnant,
            nursing: data.nursing,
            medications: data.medications,
            allergies: data.allergies,
            conditions: data.conditions,
          });
        }
      } catch (e) {
        console.log('[UserProvider] Supabase contraindications sync failed (non-blocking):', e);
      }

      return data;
    },
    onSuccess: (data) => {
      setContraindications(data);
      void queryClient.invalidateQueries({ queryKey: ['contraindications'] });
    },
  });

  const saveResponsesMutation = useMutation({
    mutationFn: async (responses: QuestionnaireResponse[]) => {
      await secureSetJSON(STORAGE_KEYS.QUESTIONNAIRE_RESPONSES, responses);
      await writeAuditLog('PHI_UPDATE', 'questionnaire', 'user');
      return responses;
    },
    onSuccess: (data) => {
      setQuestionnaireResponses(data);
      void queryClient.invalidateQueries({ queryKey: ['questionnaireResponses'] });
    },
  });

  const saveClinicalIntakeMutation = useMutation({
    mutationFn: async (intake: ClinicalIntake) => {
      await secureSetJSON(STORAGE_KEYS.CLINICAL_INTAKE, intake);
      await writeAuditLog('PHI_UPDATE', 'clinical_intake', intake.userId);
      return intake;
    },
    onSuccess: (data) => {
      setClinicalIntake(data);
      void queryClient.invalidateQueries({ queryKey: ['clinicalIntake'] });
    },
  });

  const updateUserProfile = useCallback((updates: Partial<UserProfile>) => {
    const updated = { ...userProfile, ...updates };
    saveUserMutation.mutate(updated);
  }, [userProfile, saveUserMutation]);

  const updateLifestyleProfile = useCallback((updates: Partial<LifestyleProfile>) => {
    const updated = { ...lifestyleProfile, ...updates };
    saveLifestyleMutation.mutate(updated);
  }, [lifestyleProfile, saveLifestyleMutation]);

  const updateContraindications = useCallback((updates: Partial<Contraindication>) => {
    const updated = { ...contraindications, ...updates };
    saveContraindicationsMutation.mutate(updated);
  }, [contraindications, saveContraindicationsMutation]);

  const saveQuestionnaireResponse = useCallback((response: QuestionnaireResponse) => {
    const existing = questionnaireResponses.filter(r => r.questionId !== response.questionId);
    const updated = [...existing, response];
    saveResponsesMutation.mutate(updated);
  }, [questionnaireResponses, saveResponsesMutation]);

  const saveClinicalIntake = useCallback((chiefComplaint: ChiefComplaint, symptoms: AssociatedSymptom[]) => {
    const intake: ClinicalIntake = {
      id: clinicalIntake?.id || `intake_${Date.now()}`,
      userId: userProfile.id || `user_${Date.now()}`,
      chiefComplaint,
      associatedSymptoms: symptoms,
      energyLevel: lifestyleProfile.sleepQuality,
      sleepQuality: lifestyleProfile.sleepQuality,
      digestiveFunction: 5,
      stressPerception: lifestyleProfile.stressLevel,
      temperatureSensitivity: 'normal',
      createdAt: clinicalIntake?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveClinicalIntakeMutation.mutate(intake);
  }, [clinicalIntake, userProfile.id, lifestyleProfile, saveClinicalIntakeMutation]);

  const completeOnboarding = useCallback(() => {
    const userId = userProfile.id || `user_${Date.now()}`;
    const updated = { ...userProfile, onboardingCompleted: true, id: userId };
    saveUserMutation.mutate(updated);

    const scores = questionnaireCategories.map(category => {
      const categoryResponses = questionnaireResponses.filter(r => r.categoryId === category.id);
      const totalScore = categoryResponses.reduce((sum, r) => sum + r.severity, 0);
      const maxScore = category.questions.length * 4;
      return { id: category.id, percentage: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0 };
    });

    const findScore = (id: string) => scores.find(s => s.id === id)?.percentage ?? 0;

    const assessmentScore: AssessmentScore = {
      moldRisk: findScore('mold'),
      heavyMetalsRisk: findScore('heavy_metals'),
      parasitesRisk: findScore('parasites'),
      lymeRisk: findScore('lyme'),
      ebvRisk: findScore('viral'),
      gutIssuesRisk: Math.max(findScore('gut_digestive'), findScore('leaky_gut')),
      thyroidRisk: findScore('thyroid'),
      hormoneRisk: findScore('hormones'),
      adrenalRisk: findScore('adrenal'),
    };

    const highRiskCategories = scores.filter(s => s.percentage >= 25).map(s => s.id);
    const recommendedLabs = highRiskCategories;

    sendAssessmentComplete({
      userId,
      email: userProfile.email,
      assessmentScore,
      recommendedLabs,
    });
  }, [userProfile, questionnaireResponses, saveUserMutation]);

  const resetOnboarding = useCallback(async () => {
    await secureMultiRemove([
      STORAGE_KEYS.USER_PROFILE,
      STORAGE_KEYS.LIFESTYLE_PROFILE,
      STORAGE_KEYS.CONTRAINDICATIONS,
      STORAGE_KEYS.QUESTIONNAIRE_RESPONSES,
      STORAGE_KEYS.CLINICAL_INTAKE,
    ]);
    await writeAuditLog('PHI_DELETE', 'onboarding_reset', userProfile.id || 'unknown');
    setUserProfile(defaultUserProfile);
    setLifestyleProfile(defaultLifestyleProfile);
    setContraindications(defaultContraindications);
    setQuestionnaireResponses([]);
    setClinicalIntake(null);
    void queryClient.invalidateQueries();
  }, [queryClient, userProfile.id]);

  const categoryScores = useMemo((): CategoryScore[] => {
    return questionnaireCategories.map(category => {
      const categoryResponses = questionnaireResponses.filter(
        r => r.categoryId === category.id
      );
      const totalScore = categoryResponses.reduce((sum, r) => sum + r.severity, 0);
      const maxScore = category.questions.length * 4;
      const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

      return {
        categoryId: category.id,
        categoryName: category.name,
        score: totalScore,
        maxScore,
        percentage: Math.round(percentage),
      };
    });
  }, [questionnaireResponses]);

  const isClinician = useMemo(() => userProfile.role === 'clinician', [userProfile.role]);

  const setUserRole = useCallback((role: AppUserRole) => {
    const updated = { ...userProfile, role };
    saveUserMutation.mutate(updated);
  }, [userProfile, saveUserMutation]);

  const isLoading = userQuery.isLoading || lifestyleQuery.isLoading || 
    contraindicationsQuery.isLoading || responsesQuery.isLoading || clinicalIntakeQuery.isLoading ||
    supabaseProfileQuery.isLoading;

  return useMemo(() => ({
    userProfile,
    lifestyleProfile,
    contraindications,
    questionnaireResponses,
    categoryScores,
    clinicalIntake,
    isLoading,
    isClinician,
    updateUserProfile,
    updateLifestyleProfile,
    updateContraindications,
    saveQuestionnaireResponse,
    saveClinicalIntake,
    completeOnboarding,
    resetOnboarding,
    setUserRole,
  }), [
    userProfile,
    lifestyleProfile,
    contraindications,
    questionnaireResponses,
    categoryScores,
    clinicalIntake,
    isLoading,
    isClinician,
    updateUserProfile,
    updateLifestyleProfile,
    updateContraindications,
    saveQuestionnaireResponse,
    saveClinicalIntake,
    completeOnboarding,
    resetOnboarding,
    setUserRole,
  ]);
});
