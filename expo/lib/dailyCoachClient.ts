import { supabase } from './supabase';

export interface CoachSupplement {
  name: string;
  dose: string;
  timing: string;
  reason: string;
  caution: string | null;
}

export interface CoachSkip {
  name: string;
  reason: string;
}

export interface DailyCoachResult {
  recovery_status: 'good' | 'moderate' | 'poor' | string;
  top_actions: string[];
  training_guidance: string;
  nutrition_guidance: string;
  supplement_guidance: CoachSupplement[];
  supplements_to_skip_today: CoachSkip[];
  sleep_guidance: string;
  stress_guidance: string;
  escalation_flag: boolean;
  explanation_short: string;
  explanation_long: string;
}

export async function fetchOrGenerateDailyCoach(date?: string): Promise<{
  data: DailyCoachResult | null;
  error: string | null;
}> {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);

  const existing = await supabase
    .from('daily_recommendations')
    .select('*')
    .eq('date', targetDate)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.data) {
    return { data: mapRowToResult(existing.data), error: null };
  }

  return generateDailyCoach(targetDate);
}

export async function generateDailyCoach(date?: string): Promise<{
  data: DailyCoachResult | null;
  error: string | null;
}> {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);

  try {
    const { data, error } = await supabase.functions.invoke('daily-coach', {
      body: { date: targetDate },
    });
    if (error) {
      return { data: null, error: error.message };
    }
    const rec = data?.recommendation;
    if (!rec) return { data: null, error: 'No recommendation returned' };
    return {
      data: {
        recovery_status: rec.recovery_status ?? 'moderate',
        top_actions: rec.top_actions ?? [],
        training_guidance: rec.training_guidance ?? '',
        nutrition_guidance: rec.nutrition_guidance ?? '',
        supplement_guidance: rec.supplement_guidance ?? [],
        supplements_to_skip_today: rec.supplements_to_skip_today ?? [],
        sleep_guidance: rec.sleep_guidance ?? '',
        stress_guidance: rec.stress_guidance ?? '',
        escalation_flag: Boolean(rec.escalation_flag),
        explanation_short: rec.explanation_short ?? '',
        explanation_long: rec.explanation_long ?? '',
      },
      error: null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return { data: null, error: message };
  }
}

function mapRowToResult(row: Record<string, unknown>): DailyCoachResult {
  const payload = (row.recommendation_payload_json ?? {}) as Record<string, unknown>;
  return {
    recovery_status: String(row.recovery_status ?? 'moderate'),
    top_actions: (row.top_actions_json as string[] | null) ?? [],
    training_guidance: String(row.training_guidance ?? ''),
    nutrition_guidance: String(row.nutrition_guidance ?? ''),
    supplement_guidance:
      (payload.supplement_guidance as CoachSupplement[] | null) ??
      (row.supplement_guidance as unknown as CoachSupplement[] | null) ??
      [],
    supplements_to_skip_today: (payload.supplements_to_skip_today as CoachSkip[] | null) ?? [],
    sleep_guidance: String(row.sleep_guidance ?? ''),
    stress_guidance: String(row.stress_guidance ?? ''),
    escalation_flag: Boolean(row.escalation_flag),
    explanation_short: String(row.explanation_short ?? ''),
    explanation_long: String(row.explanation_long ?? ''),
  };
}
