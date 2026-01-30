import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useMemo } from 'react';

import {
  UserProfile,
  LifestyleProfile,
  Contraindication,
  QuestionnaireResponse,
  CategoryScore,
  AppUserRole,
} from '@/types';
import { questionnaireCategories } from '@/mocks/questionnaire';

const STORAGE_KEYS = {
  USER_PROFILE: 'longevity_user_profile',
  LIFESTYLE_PROFILE: 'longevity_lifestyle_profile',
  CONTRAINDICATIONS: 'longevity_contraindications',
  QUESTIONNAIRE_RESPONSES: 'longevity_questionnaire_responses',
};

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

  const userQuery = useQuery({
    queryKey: ['userProfile'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.USER_PROFILE);
      return stored ? JSON.parse(stored) : defaultUserProfile;
    },
  });

  const lifestyleQuery = useQuery({
    queryKey: ['lifestyleProfile'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.LIFESTYLE_PROFILE);
      return stored ? JSON.parse(stored) : defaultLifestyleProfile;
    },
  });

  const contraindicationsQuery = useQuery({
    queryKey: ['contraindications'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.CONTRAINDICATIONS);
      return stored ? JSON.parse(stored) : defaultContraindications;
    },
  });

  const responsesQuery = useQuery({
    queryKey: ['questionnaireResponses'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.QUESTIONNAIRE_RESPONSES);
      return stored ? JSON.parse(stored) : [];
    },
  });

  useEffect(() => {
    if (userQuery.data) setUserProfile(userQuery.data);
  }, [userQuery.data]);

  useEffect(() => {
    if (lifestyleQuery.data) setLifestyleProfile(lifestyleQuery.data);
  }, [lifestyleQuery.data]);

  useEffect(() => {
    if (contraindicationsQuery.data) setContraindications(contraindicationsQuery.data);
  }, [contraindicationsQuery.data]);

  useEffect(() => {
    if (responsesQuery.data) setQuestionnaireResponses(responsesQuery.data);
  }, [responsesQuery.data]);

  const saveUserMutation = useMutation({
    mutationFn: async (profile: UserProfile) => {
      await AsyncStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(profile));
      return profile;
    },
    onSuccess: (data) => {
      setUserProfile(data);
      queryClient.invalidateQueries({ queryKey: ['userProfile'] });
    },
  });

  const saveLifestyleMutation = useMutation({
    mutationFn: async (profile: LifestyleProfile) => {
      await AsyncStorage.setItem(STORAGE_KEYS.LIFESTYLE_PROFILE, JSON.stringify(profile));
      return profile;
    },
    onSuccess: (data) => {
      setLifestyleProfile(data);
      queryClient.invalidateQueries({ queryKey: ['lifestyleProfile'] });
    },
  });

  const saveContraindicationsMutation = useMutation({
    mutationFn: async (data: Contraindication) => {
      await AsyncStorage.setItem(STORAGE_KEYS.CONTRAINDICATIONS, JSON.stringify(data));
      return data;
    },
    onSuccess: (data) => {
      setContraindications(data);
      queryClient.invalidateQueries({ queryKey: ['contraindications'] });
    },
  });

  const saveResponsesMutation = useMutation({
    mutationFn: async (responses: QuestionnaireResponse[]) => {
      await AsyncStorage.setItem(STORAGE_KEYS.QUESTIONNAIRE_RESPONSES, JSON.stringify(responses));
      return responses;
    },
    onSuccess: (data) => {
      setQuestionnaireResponses(data);
      queryClient.invalidateQueries({ queryKey: ['questionnaireResponses'] });
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

  const completeOnboarding = useCallback(() => {
    const updated = { ...userProfile, onboardingCompleted: true, id: `user_${Date.now()}` };
    saveUserMutation.mutate(updated);
  }, [userProfile, saveUserMutation]);

  const resetOnboarding = useCallback(async () => {
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.USER_PROFILE,
      STORAGE_KEYS.LIFESTYLE_PROFILE,
      STORAGE_KEYS.CONTRAINDICATIONS,
      STORAGE_KEYS.QUESTIONNAIRE_RESPONSES,
    ]);
    setUserProfile(defaultUserProfile);
    setLifestyleProfile(defaultLifestyleProfile);
    setContraindications(defaultContraindications);
    setQuestionnaireResponses([]);
    queryClient.invalidateQueries();
  }, [queryClient]);

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
    contraindicationsQuery.isLoading || responsesQuery.isLoading;

  return {
    userProfile,
    lifestyleProfile,
    contraindications,
    questionnaireResponses,
    categoryScores,
    isLoading,
    isClinician,
    updateUserProfile,
    updateLifestyleProfile,
    updateContraindications,
    saveQuestionnaireResponse,
    completeOnboarding,
    resetOnboarding,
    setUserRole,
  };
});
