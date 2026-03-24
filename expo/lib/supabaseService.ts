import { supabase } from './supabase';
import type {
  ProfileRow,
  ProfileUpdate,
  LifestyleProfileRow,
  LifestyleProfileUpdate,
  ContraindicationRow,
  ContraindicationUpdate,
  QuestionnaireResponseRow,
  QuestionnaireResponseInsert,
  ClinicalIntakeRow,
  ClinicalIntakeUpdate,
  ProtocolRow,
  ProtocolUpdate,
  DailyAdherenceRow,
  DailyAdherenceUpdate,
  HormoneEntryRow,
  HormoneEntryUpdate,
  LabPanelRow,
  LabPanelUpdate,
  DailyBiometricRow,
  DailyBiometricUpdate,
  DailyScoreRow,
  DailyRecommendationRow,
  DetectedPatternRow,
  CorrelationRow,
  MealLogRow,
  MealLogInsert,
  SupplementLogRow,
  SupplementLogInsert,
  SymptomLogRow,
  SymptomLogInsert,
  DailyBaselineRow,
  PractitionerFlagRow,
  HealthGoalRow,
  HealthGoalUpdate,
  WearableConnectionRow,
  WearableConnectionUpdate,
  AppSettingsRow,
  AppSettingsUpdate,
} from '@/types/database';

type ServiceResult<T> = { data: T | null; error: string | null };

function handleError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return (error as { message: string }).message;
  }
  return 'An unexpected error occurred';
}

async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

export const profileService = {
  async get(): Promise<ServiceResult<ProfileRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.log('[profileService.get] Failed to fetch profile');
        return { data: null, error: error.message };
      }
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async upsert(profile: ProfileUpdate): Promise<ServiceResult<ProfileRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('profiles')
        .upsert({ ...profile, id: userId, updated_at: new Date().toISOString() })
        .select()
        .single();

      if (error) {
        console.log('[profileService.upsert] Failed to upsert profile');
        return { data: null, error: error.message };
      }
      console.log('[profileService.upsert] Success');
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const lifestyleService = {
  async get(): Promise<ServiceResult<LifestyleProfileRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('lifestyle_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async upsert(profile: LifestyleProfileUpdate): Promise<ServiceResult<LifestyleProfileRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('lifestyle_profiles')
        .upsert({ ...profile, user_id: userId, updated_at: new Date().toISOString() })
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const contraindicationService = {
  async get(): Promise<ServiceResult<ContraindicationRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('contraindications')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async upsert(contra: ContraindicationUpdate): Promise<ServiceResult<ContraindicationRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('contraindications')
        .upsert({ ...contra, user_id: userId, updated_at: new Date().toISOString() })
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const questionnaireService = {
  async getAll(): Promise<ServiceResult<QuestionnaireResponseRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('questionnaire_responses')
        .select('*')
        .eq('user_id', userId)
        .order('timestamp', { ascending: true });

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async upsertResponse(response: Omit<QuestionnaireResponseInsert, 'user_id'>): Promise<ServiceResult<QuestionnaireResponseRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('questionnaire_responses')
        .upsert(
          { ...response, user_id: userId },
          { onConflict: 'user_id,question_id' }
        )
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const clinicalIntakeService = {
  async get(): Promise<ServiceResult<ClinicalIntakeRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('clinical_intakes')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async upsert(intake: ClinicalIntakeUpdate): Promise<ServiceResult<ClinicalIntakeRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('clinical_intakes')
        .upsert({ ...intake, user_id: userId, updated_at: new Date().toISOString() })
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const protocolService = {
  async getAll(): Promise<ServiceResult<ProtocolRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('protocols')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async upsert(protocol: ProtocolUpdate): Promise<ServiceResult<ProtocolRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('protocols')
        .upsert({ ...protocol, user_id: userId, updated_at: new Date().toISOString() })
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const adherenceService = {
  async getForDateRange(startDate: string, endDate: string): Promise<ServiceResult<DailyAdherenceRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('daily_adherence')
        .select('*')
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async upsert(adherence: DailyAdherenceUpdate): Promise<ServiceResult<DailyAdherenceRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('daily_adherence')
        .upsert(
          { ...adherence, user_id: userId, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,date,protocol_id' }
        )
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const labPanelService = {
  async getAll(): Promise<ServiceResult<LabPanelRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('lab_panels')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false });

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async upsert(panel: LabPanelUpdate): Promise<ServiceResult<LabPanelRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('lab_panels')
        .upsert({ ...panel, user_id: userId, updated_at: new Date().toISOString() })
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const hormoneEntryService = {
  async getAll(): Promise<ServiceResult<HormoneEntryRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('hormone_entries')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false });

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async upsert(entry: HormoneEntryUpdate): Promise<ServiceResult<HormoneEntryRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('hormone_entries')
        .upsert({ ...entry, user_id: userId, updated_at: new Date().toISOString() })
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const biometricService = {
  async getForDate(date: string): Promise<ServiceResult<DailyBiometricRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('daily_biometric_records')
        .select('*')
        .eq('user_id', userId)
        .eq('date', date)
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async getForDateRange(startDate: string, endDate: string): Promise<ServiceResult<DailyBiometricRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('daily_biometric_records')
        .select('*')
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async upsert(record: DailyBiometricUpdate): Promise<ServiceResult<DailyBiometricRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('daily_biometric_records')
        .upsert(
          { ...record, user_id: userId, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,date' }
        )
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const scoresService = {
  async getForDate(date: string): Promise<ServiceResult<DailyScoreRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('daily_scores')
        .select('*')
        .eq('user_id', userId)
        .eq('date', date)
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async getForDateRange(startDate: string, endDate: string): Promise<ServiceResult<DailyScoreRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('daily_scores')
        .select('*')
        .eq('user_id', userId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const recommendationService = {
  async getForDate(date: string): Promise<ServiceResult<DailyRecommendationRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('daily_recommendations')
        .select('*')
        .eq('user_id', userId)
        .eq('date', date)
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const patternService = {
  async getForDate(date: string): Promise<ServiceResult<DetectedPatternRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('detected_patterns')
        .select('*')
        .eq('user_id', userId)
        .eq('date', date)
        .order('created_at', { ascending: false });

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const correlationService = {
  async getRecent(limit: number = 20): Promise<ServiceResult<CorrelationRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('correlations')
        .select('*')
        .eq('user_id', userId)
        .order('computed_at', { ascending: false })
        .limit(limit);

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const mealLogService = {
  async getForDate(date: string): Promise<ServiceResult<MealLogRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('meal_logs')
        .select('*')
        .eq('user_id', userId)
        .gte('meal_time', `${date}T00:00:00`)
        .lte('meal_time', `${date}T23:59:59`)
        .order('meal_time', { ascending: true });

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async insert(meal: Omit<MealLogInsert, 'user_id'>): Promise<ServiceResult<MealLogRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('meal_logs')
        .insert({ ...meal, user_id: userId })
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const supplementLogService = {
  async getForDate(date: string): Promise<ServiceResult<SupplementLogRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('supplement_logs')
        .select('*')
        .eq('user_id', userId)
        .gte('logged_at', `${date}T00:00:00`)
        .lte('logged_at', `${date}T23:59:59`)
        .order('logged_at', { ascending: true });

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async insert(log: Omit<SupplementLogInsert, 'user_id'>): Promise<ServiceResult<SupplementLogRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('supplement_logs')
        .insert({ ...log, user_id: userId })
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const symptomLogService = {
  async getForDate(date: string): Promise<ServiceResult<SymptomLogRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('symptom_logs')
        .select('*')
        .eq('user_id', userId)
        .gte('logged_at', `${date}T00:00:00`)
        .lte('logged_at', `${date}T23:59:59`)
        .order('logged_at', { ascending: true });

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async insert(log: Omit<SymptomLogInsert, 'user_id'>): Promise<ServiceResult<SymptomLogRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('symptom_logs')
        .insert({ ...log, user_id: userId })
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const baselineService = {
  async getLatest(): Promise<ServiceResult<DailyBaselineRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('daily_baselines')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(1)
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const practitionerFlagService = {
  async getUnresolved(): Promise<ServiceResult<PractitionerFlagRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('practitioner_flags')
        .select('*')
        .eq('user_id', userId)
        .eq('resolved', false)
        .order('created_at', { ascending: false });

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const healthGoalService = {
  async get(): Promise<ServiceResult<HealthGoalRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('health_goals')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async upsert(goal: HealthGoalUpdate): Promise<ServiceResult<HealthGoalRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('health_goals')
        .upsert({ ...goal, user_id: userId, updated_at: new Date().toISOString() })
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const wearableConnectionService = {
  async getAll(): Promise<ServiceResult<WearableConnectionRow[]>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('wearable_connections')
        .select('*')
        .eq('user_id', userId);

      if (error) return { data: null, error: error.message };
      return { data: data ?? [], error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async upsert(connection: WearableConnectionUpdate): Promise<ServiceResult<WearableConnectionRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('wearable_connections')
        .upsert({ ...connection, user_id: userId, updated_at: new Date().toISOString() })
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const appSettingsService = {
  async get(): Promise<ServiceResult<AppSettingsRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('app_settings')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },

  async upsert(settings: AppSettingsUpdate): Promise<ServiceResult<AppSettingsRow>> {
    try {
      const userId = await getCurrentUserId();
      if (!userId) return { data: null, error: 'Not authenticated' };

      const { data, error } = await supabase
        .from('app_settings')
        .upsert({ ...settings, user_id: userId, updated_at: new Date().toISOString() })
        .select()
        .single();

      if (error) return { data: null, error: error.message };
      return { data, error: null };
    } catch (e) {
      return { data: null, error: handleError(e) };
    }
  },
};

export const authService = {
  async signUp(email: string, password: string) {
    console.log('[authService.signUp] Attempting signup');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      console.log('[authService.signUp] Failed');
      return { data: null, error: error.message };
    }
    console.log('[authService.signUp] Success');
    return { data, error: null };
  },

  async signIn(email: string, password: string) {
    console.log('[authService.signIn] Attempting login');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.log('[authService.signIn] Failed');
      return { data: null, error: error.message };
    }
    console.log('[authService.signIn] Success');
    return { data, error: null };
  },

  async signInWithMagicLink(email: string) {
    console.log('[authService.signInWithMagicLink] Sending magic link');
    const { data, error } = await supabase.auth.signInWithOtp({ email });
    if (error) {
      console.log('[authService.signInWithMagicLink] Failed');
      return { data: null, error: error.message };
    }
    return { data, error: null };
  },

  async signOut() {
    console.log('[authService.signOut] Signing out');
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.log('[authService.signOut] Failed');
      return { error: error.message };
    }
    return { error: null };
  },

  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) return { data: null, error: error.message };
    return { data: data.session, error: null };
  },

  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) return { data: null, error: error.message };
    return { data: data.user, error: null };
  },

  async resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) return { error: error.message };
    return { error: null };
  },

  onAuthStateChange(callback: (event: string, session: unknown) => void) {
    return supabase.auth.onAuthStateChange(callback);
  },
};
