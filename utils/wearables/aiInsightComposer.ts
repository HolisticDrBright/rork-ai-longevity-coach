import { generateObject } from '@rork-ai/toolkit-sdk';
import { z } from 'zod';
import {
  AllScores,
  DailyBiometricRecord,
  UserBaseline,
  PatternDetection,
  CorrelationResult,
  MealLogEntry,
  SupplementLogEntry,
} from '@/types/wearables';
import { BaselineDeviation } from './baselineEngine';

const AI_INSIGHT_SCHEMA = z.object({
  oneLineSummary: z.string(),
  topActions: z.array(z.string()).min(1).max(5),
  whyItMatters: z.string(),
  trainingGuidance: z.string(),
  nutritionGuidance: z.string(),
  supplementGuidance: z.string(),
  sleepGuidance: z.string(),
  stressGuidance: z.string(),
  escalationNote: z.string(),
  confidence: z.enum(['low', 'moderate', 'high']),
});

export type AIInsightOutput = z.infer<typeof AI_INSIGHT_SCHEMA>;

const SYSTEM_PROMPT = `You are the health intelligence engine for AI Health Pro.

Your role is to interpret wearable, recovery, nutrition, supplement, symptom, cycle, and lifestyle data and generate personalized wellness guidance.

You do not diagnose disease or claim to treat medical conditions.

You identify meaningful trends, compare current values against personal baseline, explain likely contributors, and generate practical actions for today.

Prioritize:
- recovery
- sleep
- stress resilience
- metabolic stability
- exercise readiness
- nervous system support
- adherence reinforcement

Rules:
- Use cautious wording for associations ("appears associated with", "may be contributing to", "likely pattern")
- Never overstate causality
- Use plain, intelligent English
- Keep the output practical and concise
- Tailor recommendations to the user's data, not generic advice
- If data is limited, acknowledge it and provide best guidance possible`;

function buildInputPayload(params: {
  record: DailyBiometricRecord;
  scores: AllScores;
  deviations: BaselineDeviation[];
  patterns: PatternDetection[];
  correlations: CorrelationResult[];
  meals: MealLogEntry[];
  supplements: SupplementLogEntry[];
  baseline: UserBaseline | null;
}): string {
  const { record, scores, deviations, patterns, correlations, meals, supplements, baseline } = params;

  const todayMeals = meals.filter(m => m.date === record.date);
  const todaySupps = supplements.filter(s => s.date === record.date);
  const suppAdherence = todaySupps.length > 0
    ? Math.round((todaySupps.filter(s => s.adherence).length / todaySupps.length) * 100)
    : null;

  const sections: string[] = [];

  sections.push(`## Today's Biometrics (${record.date})
- HRV: ${record.hrv ?? 'N/A'} ms ${baseline?.hrv14Day ? `(baseline: ${baseline.hrv14Day})` : ''}
- Resting HR: ${record.restingHr ?? 'N/A'} bpm ${baseline?.restingHr14Day ? `(baseline: ${baseline.restingHr14Day})` : ''}
- Sleep: ${record.sleepDurationMinutes ? `${(record.sleepDurationMinutes / 60).toFixed(1)}h` : 'N/A'}, efficiency ${record.sleepEfficiency ?? 'N/A'}%
- Deep sleep: ${record.deepSleepMinutes ?? 'N/A'} min, REM: ${record.remSleepMinutes ?? 'N/A'} min
- Steps: ${record.steps ?? 'N/A'}, Active min: ${record.activeMinutes ?? 'N/A'}
- Readiness: ${record.readinessScore ?? 'N/A'}
- Energy: ${record.energyScore ?? 'N/A'}/10, Stress: ${record.stressScoreSubjective ?? 'N/A'}/10
- Soreness: ${record.sorenessScore ?? 'N/A'}/10, Mood: ${record.moodScore ?? 'N/A'}/10
- Hydration: ${record.hydrationMl ?? 'N/A'} ml
- Alcohol: ${record.alcoholUnits ?? 0} units, Caffeine: ${record.caffeineMg ?? 'N/A'} mg
- Cycle phase: ${record.cyclePhase ?? 'N/A'}
- Temperature deviation: ${record.tempDeviation ?? 'N/A'}°C
- Respiratory rate: ${record.respiratoryRate ?? 'N/A'}`);

  sections.push(`## Scores
- Recovery: ${scores.recovery.score}/100 (${scores.recovery.status})
- Sleep: ${scores.sleep.score}/100 (${scores.sleep.status})
- Stress Load: ${scores.stressLoad.score}/100 (${scores.stressLoad.status})
- Metabolic Resilience: ${scores.metabolicResilience.score}/100
- Adherence: ${scores.adherence.score}/100
- Nervous System: ${scores.nervousSystemBalance.score}/100
- Inflammation/Strain: ${scores.inflammationStrain.score}/100`);

  if (deviations.length > 0) {
    const notable = deviations.filter(d => d.classification !== 'normal');
    if (notable.length > 0) {
      sections.push(`## Baseline Deviations
${notable.map(d => `- ${d.metric}: ${d.deviationPercent?.toFixed(1)}% ${d.direction} baseline (${d.classification})`).join('\n')}`);
    }
  }

  if (patterns.length > 0) {
    sections.push(`## Detected Patterns
${patterns.map(p => `- [${p.severity}] ${p.type}: ${p.description}`).join('\n')}`);
  }

  if (correlations.length > 0) {
    sections.push(`## Correlations
${correlations.slice(0, 5).map(c => `- ${c.factorA} → ${c.factorB}: ${c.direction} (${c.confidence} confidence) - ${c.insight}`).join('\n')}`);
  }

  if (todayMeals.length > 0) {
    const totalProtein = todayMeals.reduce((s, m) => s + m.proteinG, 0);
    const totalCals = todayMeals.reduce((s, m) => s + m.calories, 0);
    sections.push(`## Nutrition Today
- Meals logged: ${todayMeals.length}
- Total protein: ${totalProtein}g, calories: ${totalCals}
- Meal types: ${todayMeals.map(m => m.mealType).join(', ')}`);
  }

  if (todaySupps.length > 0) {
    sections.push(`## Supplements Today
- Adherence: ${suppAdherence}%
- Taken: ${todaySupps.filter(s => s.adherence).map(s => s.supplementName).join(', ') || 'None'}
- Missed: ${todaySupps.filter(s => !s.adherence).map(s => s.supplementName).join(', ') || 'None'}`);
  }

  return sections.join('\n\n');
}

export async function composeAIInsight(params: {
  record: DailyBiometricRecord;
  scores: AllScores;
  deviations: BaselineDeviation[];
  patterns: PatternDetection[];
  correlations: CorrelationResult[];
  meals: MealLogEntry[];
  supplements: SupplementLogEntry[];
  baseline: UserBaseline | null;
}): Promise<AIInsightOutput> {
  try {
    const inputPayload = buildInputPayload(params);

    console.log('[AI Insight Composer] Generating insight for date:', params.record.date);

    const result = await generateObject({
      messages: [
        {
          role: 'user' as const,
          content: `${SYSTEM_PROMPT}\n\n---\n\nHere is today's health data for the user. Generate personalized wellness guidance based on this data.\n\n${inputPayload}\n\nProduce structured output with:\n- oneLineSummary: one sentence summary of today's state\n- topActions: 3-5 practical actions for today\n- whyItMatters: brief explanation of why these actions matter\n- trainingGuidance: workout recommendation\n- nutritionGuidance: nutrition advice\n- supplementGuidance: supplement priorities\n- sleepGuidance: sleep optimization advice\n- stressGuidance: stress regulation advice\n- escalationNote: practitioner review note ONLY if persistent concerning trends exist, otherwise empty string\n- confidence: low/moderate/high based on data completeness`,
        },
      ],
      schema: AI_INSIGHT_SCHEMA,
    });

    console.log('[AI Insight Composer] Successfully generated insight');
    return result;
  } catch (error) {
    console.error('[AI Insight Composer] Error generating insight:', error);
    return generateFallbackInsight(params);
  }
}

function generateFallbackInsight(params: {
  record: DailyBiometricRecord;
  scores: AllScores;
  patterns: PatternDetection[];
}): AIInsightOutput {
  const { scores, patterns } = params;
  const recovery = scores.recovery;

  let summary = '';
  if (recovery.status === 'green') {
    summary = 'Recovery looks strong today. Your body is well-positioned for productive training and activity.';
  } else if (recovery.status === 'yellow') {
    summary = 'Recovery is moderate today. Listen to your body and adjust intensity based on how you feel.';
  } else {
    summary = 'Recovery is suppressed today. Prioritize rest, hydration, and stress management.';
  }

  const actions: string[] = [];
  if (recovery.score < 65) actions.push('Reduce training intensity to zone 2 or recovery work');
  if (scores.sleep.score < 70) actions.push('Target an earlier bedtime tonight with a wind-down routine');
  if (scores.stressLoad.score < 65) actions.push('Complete a 10-minute breathwork session');
  actions.push('Hit your hydration target today');
  actions.push('Front-load protein at breakfast');

  const hasEscalation = patterns.some(p => p.escalationNeeded);

  return {
    oneLineSummary: summary,
    topActions: actions.slice(0, 5),
    whyItMatters: 'These actions are based on your current recovery status, sleep quality, and stress load patterns.',
    trainingGuidance: recovery.score >= 80 ? 'Green light for higher intensity training.' : recovery.score >= 60 ? 'Moderate intensity recommended.' : 'Recovery-focused activity only.',
    nutritionGuidance: 'Prioritize protein-rich meals and stay ahead of hydration.',
    supplementGuidance: scores.sleep.score < 70 ? 'Prioritize magnesium before bed tonight.' : 'Continue your core supplement stack.',
    sleepGuidance: 'Aim for consistent bedtime and reduce screen exposure before sleep.',
    stressGuidance: scores.stressLoad.score < 65 ? 'Your stress load is elevated. Breathwork and nature time will help.' : 'Stress levels look manageable.',
    escalationNote: hasEscalation ? 'Some patterns have been persisting. Consider reviewing with your practitioner.' : '',
    confidence: 'moderate',
  };
}

export async function composeWeeklyDigest(params: {
  records: DailyBiometricRecord[];
  scores: AllScores;
  patterns: PatternDetection[];
  correlations: CorrelationResult[];
}): Promise<string> {
  try {
    const { records, scores, patterns, correlations } = params;
    const recent7 = records.slice(0, 7);

    const avgRecovery = Math.round(recent7.reduce((s, r) => s + (r.readinessScore ?? 70), 0) / recent7.length);
    const avgSleep = Math.round(recent7.reduce((s, r) => s + (r.sleepDurationMinutes ?? 420), 0) / recent7.length / 60 * 10) / 10;
    const avgHrv = Math.round(recent7.reduce((s, r) => s + (r.hrv ?? 50), 0) / recent7.length);

    const prompt = `Generate a concise weekly health digest summary based on this data:
- Average recovery: ${avgRecovery}/100
- Average sleep: ${avgSleep} hours
- Average HRV: ${avgHrv} ms
- Current scores: Recovery ${scores.recovery.score}, Sleep ${scores.sleep.score}, Stress ${scores.stressLoad.score}
- Patterns detected: ${patterns.map(p => p.type).join(', ') || 'none'}
- Top correlations: ${correlations.slice(0, 3).map(c => c.insight).join('; ') || 'none'}

Write 3-4 sentences summarizing the week's highlights, areas for improvement, and one key win. Keep it encouraging and actionable.`;

    const result = await generateObject({
      messages: [{ role: 'user' as const, content: prompt }],
      schema: z.object({ digest: z.string() }),
    });

    return result.digest;
  } catch (error) {
    console.error('[AI Weekly Digest] Error:', error);
    return 'Your weekly health data has been analyzed. Continue tracking consistently for more detailed insights.';
  }
}
