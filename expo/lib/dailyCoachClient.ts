import { supabase } from './supabase';
import type { DailyRecommendationRow } from '@/types/database';

export interface CoachTopAction {
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
}

export interface CoachSkipItem {
  name: string;
  reason: string;
}

export interface DailyCoachResult {
  date: string;
  recovery_status: 'green' | 'yellow' | 'red' | null;
  explanation_short: string | null;
  explanation_long: string | null;
  top_actions: CoachTopAction[];
  supplements_to_skip_today: CoachSkipItem[];
  training_guidance: string | null;
  nutrition_guidance: string | null;
  supplement_guidance: string | null;
  sleep_guidance: string | null;
  stress_guidance: string | null;
  escalation_flag: string | null;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function rowToResult(row: DailyRecommendationRow): DailyCoachResult {
  const payload = (row.recommendation_payload_json ?? {}) as Partial<DailyCoachResult> & {
    top_actions?: CoachTopAction[];
    supplements_to_skip_today?: CoachSkipItem[];
  };
  const aiSummary = (row.ai_summary_json ?? {}) as { supplements_to_skip?: CoachSkipItem[] };

  return {
    date: row.date,
    recovery_status: (row.recovery_status as DailyCoachResult['recovery_status']) ?? null,
    explanation_short: row.explanation_short ?? null,
    explanation_long: row.explanation_long ?? null,
    top_actions: (row.top_actions_json as unknown as CoachTopAction[]) ?? payload.top_actions ?? [],
    supplements_to_skip_today:
      payload.supplements_to_skip_today ?? aiSummary.supplements_to_skip ?? [],
    training_guidance: row.training_guidance ?? null,
    nutrition_guidance: row.nutrition_guidance ?? null,
    supplement_guidance: row.supplement_guidance ?? null,
    sleep_guidance: row.sleep_guidance ?? null,
    stress_guidance: row.stress_guidance ?? null,
    escalation_flag: row.escalation_flag ?? null,
  };
}

async function readStored(date: string): Promise<DailyCoachResult | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const { data, error } = await supabase
    .from('daily_recommendations')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('date', date)
    .maybeSingle();

  if (error) {
    console.log('[dailyCoachClient] readStored error:', error.message);
    return null;
  }
  if (!data) return null;

  return rowToResult(data as DailyRecommendationRow);
}

export async function generateDailyCoach(date?: string): Promise<DailyCoachResult | null> {
  const targetDate = date ?? todayDate();
  console.log('[dailyCoachClient] generating for', targetDate);

  const { data, error } = await supabase.functions.invoke('daily-coach', {
    body: { date: targetDate },
  });

  if (error) {
    console.log('[dailyCoachClient] generateDailyCoach error:', error.message);
    return null;
  }
  if (data && (data as { status?: string }).status === 'error') {
    console.log('[dailyCoachClient] daily-coach returned error:', (data as { error?: string }).error);
    return null;
  }

  return readStored(targetDate);
}

export async function fetchOrGenerateDailyCoach(date?: string): Promise<DailyCoachResult | null> {
  const targetDate = date ?? todayDate();
  const stored = await readStored(targetDate);
  if (stored) {
    console.log('[dailyCoachClient] cache hit for', targetDate);
    return stored;
  }
  console.log('[dailyCoachClient] cache miss for', targetDate, '- invoking edge function');
  return generateDailyCoach(targetDate);
}
