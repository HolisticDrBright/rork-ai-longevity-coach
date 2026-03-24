import {
  DailyBiometricRecord,
  UserBaseline,
  MealLogEntry,
  SupplementLogEntry,
  DailyRecommendation,
  ActionItem,
  TrainingGuidanceOutput,
  NutritionGuidanceOutput,
  SupplementGuidanceOutput,
  SleepGuidanceOutput,
  StressGuidanceOutput,
  EscalationFlag,
  TrainingGuidance,
  AllScores,
  PatternDetection,
  SupplementPriority,
} from '@/types/wearables';
import {
  computeRecoveryScore,
  computeSleepScore,
  computeStressLoadScore,
  computeMetabolicResilienceScore,
  computeAdherenceScore,
  computeNervousSystemBalance,
  computeInflammationStrainScore,
} from './scoringEngine';
import { detectPatterns, detectCorrelations } from './patternDetection';

function safe(val: number | null, fallback: number): number {
  return val !== null && !isNaN(val) ? val : fallback;
}

function generateTrainingGuidance(scores: AllScores, record: DailyBiometricRecord): TrainingGuidanceOutput {
  const recovery = scores.recovery.score;
  const sleep = scores.sleep.score;
  const strain = scores.inflammationStrain.score;
  const soreness = safe(record.sorenessScore, 3);

  let recommendation: TrainingGuidance;
  let label: string;
  let explanation: string;
  let suggestedWorkout: string;
  let intensityLevel: number;

  if (recovery >= 85 && sleep >= 80 && strain >= 75) {
    recommendation = 'intense_lift';
    label = 'High Intensity Day';
    explanation = 'Recovery and sleep are strong. Your body is primed for high-output training today.';
    suggestedWorkout = 'Compound lifts, HIIT, or sport-specific intensity';
    intensityLevel = 9;
  } else if (recovery >= 70 && sleep >= 65) {
    recommendation = 'strength_reduced_volume';
    label = 'Moderate Strength';
    explanation = 'Recovery is decent but not peak. Train with purpose but manage volume.';
    suggestedWorkout = 'Strength training with moderate sets, avoid failure on most sets';
    intensityLevel = 7;
  } else if (recovery >= 55 || (sleep >= 60 && soreness < 5)) {
    recommendation = 'zone_2_only';
    label = 'Zone 2 / Light Activity';
    explanation = 'Your recovery markers suggest keeping intensity low today. Zone 2 cardio supports recovery without adding stress.';
    suggestedWorkout = '30–45 min zone 2 cardio: walking, cycling, or easy swimming';
    intensityLevel = 4;
  } else if (recovery >= 40) {
    recommendation = 'mobility_recovery';
    label = 'Mobility & Recovery';
    explanation = 'Recovery is suppressed. Gentle movement, stretching, and mobility work will support your body without adding load.';
    suggestedWorkout = 'Yoga, foam rolling, gentle stretching, or a light walk';
    intensityLevel = 2;
  } else {
    recommendation = 'full_recovery_day';
    label = 'Full Recovery Day';
    explanation = 'Your body needs rest. Multiple recovery markers are flagged. Prioritize sleep, nutrition, and stress reduction.';
    suggestedWorkout = 'No structured exercise. Rest, walk if desired, prioritize sleep.';
    intensityLevel = 1;
  }

  return { recommendation, label, explanation, suggestedWorkout, intensityLevel };
}

function generateNutritionGuidance(scores: AllScores, record: DailyBiometricRecord, meals: MealLogEntry[]): NutritionGuidanceOutput {
  const suggestions: string[] = [];
  const recovery = scores.recovery.score;
  const metabolic = scores.metabolicResilience.score;
  const cravings = safe(record.cravingsScore, 4);
  const isLuteal = record.cyclePhase === 'luteal';
  const hydration = safe(record.hydrationMl, 1500);

  suggestions.push('Front-load protein at breakfast (aim for 30–40g) to stabilize energy');

  if (recovery < 65) {
    suggestions.push('Increase protein intake today to support recovery');
    suggestions.push('Prioritize hydration and electrolytes');
  }

  if (metabolic < 65 || cravings >= 6) {
    suggestions.push('Stabilize meal timing — eat at consistent intervals');
    suggestions.push('Add a short walk after meals to support glucose metabolism');
  }

  if (isLuteal) {
    suggestions.push('Allow more strategic carbs during luteal phase');
    suggestions.push('Reduce fasting intensity — your body needs more fuel right now');
  }

  if (safe(record.alcoholUnits, 0) > 0) {
    suggestions.push('Consider skipping alcohol tonight to support recovery');
  }

  const lastMealHour = meals.length > 0 ? Math.max(...meals.filter(m => m.date === record.date).map(m => parseInt(m.mealTime?.split(':')[0] ?? '19'))) : 19;
  const mealTimingAdvice = lastMealHour >= 20
    ? 'Try to finish your last meal by 7:30 PM — late meals are affecting your sleep quality.'
    : 'Your meal timing looks good. Keep your last meal at least 3 hours before bed.';

  const hydrationTarget = recovery < 65 ? 3000 : hydration < 2000 ? 2800 : 2500;
  const proteinTarget = recovery < 65 ? 140 : 120;

  return {
    suggestions: suggestions.slice(0, 5),
    mealTimingAdvice,
    hydrationTargetMl: hydrationTarget,
    proteinTargetG: proteinTarget,
    notes: isLuteal ? 'Cycle-adjusted: luteal phase nutrition priorities active.' : '',
  };
}

function generateSupplementGuidance(scores: AllScores, record: DailyBiometricRecord, supplements: SupplementLogEntry[]): SupplementGuidanceOutput {
  const priorities: SupplementPriority[] = [];
  const recovery = scores.recovery.score;
  const sleep = scores.sleep.score;
  const stress = scores.stressLoad.score;
  const inflammation = scores.inflammationStrain.score;

  if (sleep < 70) {
    priorities.push({
      name: 'Magnesium Glycinate',
      timing: 'Before bed',
      reason: 'Sleep quality is below optimal — magnesium supports deep sleep and relaxation.',
      priority: 'high',
    });
  }

  if (recovery < 65) {
    priorities.push({
      name: 'NAD+ Patches',
      timing: 'Morning',
      reason: 'Recovery is suppressed — NAD+ supports cellular energy and mitochondrial repair.',
      priority: 'high',
    });
    priorities.push({
      name: 'Electrolytes',
      timing: 'Morning & post-workout',
      reason: 'Enhanced hydration support during low-recovery periods.',
      priority: 'high',
    });
  }

  if (inflammation < 65) {
    priorities.push({
      name: 'Omega-3 Fish Oil',
      timing: 'With breakfast',
      reason: 'Inflammation markers are elevated — omega-3s provide anti-inflammatory support.',
      priority: 'high',
    });
  }

  if (stress < 65) {
    priorities.push({
      name: 'Ashwagandha',
      timing: 'Evening',
      reason: 'Stress load is elevated — ashwagandha supports cortisol regulation and stress resilience.',
      priority: 'medium',
    });
  }

  priorities.push({
    name: 'Vitamin D3',
    timing: 'Morning with fat',
    reason: 'Daily baseline support for immune function and hormone health.',
    priority: 'medium',
  });

  const adherenceRate = supplements.filter(s => s.date === record.date && s.adherence).length;
  const totalSupps = supplements.filter(s => s.date === record.date).length;
  const notes = totalSupps > 0
    ? `Today's adherence: ${adherenceRate}/${totalSupps} supplements taken.`
    : 'No supplement logs for today yet.';

  return { priorities: priorities.slice(0, 6), notes };
}

function generateSleepGuidance(scores: AllScores, record: DailyBiometricRecord): SleepGuidanceOutput {
  const sleep = scores.sleep.score;
  const caffHour = record.caffeineLastTime ? parseInt(record.caffeineLastTime.split(':')[0]) : 10;
  const suggestions: string[] = [];

  suggestions.push('Dim lights 60–90 minutes before bed');
  suggestions.push('Keep room cool: 65–68°F (18–20°C)');

  if (sleep < 70) {
    suggestions.push('Try 10 minutes of NSDR or yoga nidra before bed');
    suggestions.push('Avoid screens for the last 30 minutes');
  }

  if (safe(record.alcoholUnits, 0) > 0) {
    suggestions.push('Alcohol disrupts REM sleep — consider skipping tonight');
  }

  if (safe(record.stressScoreSubjective, 5) >= 6) {
    suggestions.push('Journal or do a brain dump before bed to offload mental stress');
  }

  return {
    targetBedtime: '22:15',
    mealCutoff: '19:30',
    caffeineCutoff: caffHour > 14 ? '12:00 (earlier than recent days)' : '14:00',
    windDownSuggestions: suggestions.slice(0, 4),
    notes: sleep < 60 ? 'Sleep quality has been a concern — making this a priority will cascade into better recovery across the board.' : '',
  };
}

function generateStressGuidance(scores: AllScores, _record: DailyBiometricRecord): StressGuidanceOutput {
  const stress = scores.stressLoad.score;
  const recovery = scores.recovery.score;
  const suggestions: string[] = [];
  const avoidItems: string[] = [];

  suggestions.push('10 minutes of morning sunlight within 30 minutes of waking');

  if (stress < 65) {
    suggestions.push('10-minute box breathing or 4-7-8 breathwork session');
    suggestions.push('20-minute walk in nature or gentle mobility');
    suggestions.push('NSDR (Non-Sleep Deep Rest) for nervous system reset');
    avoidItems.push('Avoid intense training today');
    avoidItems.push('Reduce caffeine intake');
  } else if (stress < 80) {
    suggestions.push('5-minute meditation or breathwork');
    suggestions.push('Post-meal walk for parasympathetic activation');
  }

  if (recovery < 55) {
    suggestions.push('Consider sauna only if well-hydrated; skip if deeply fatigued');
    avoidItems.push('Skip cold plunge if HRV is significantly suppressed');
  } else if (recovery >= 75) {
    suggestions.push('Sauna session (15–20 min) for recovery and detox support');
  }

  const notes = stress < 50
    ? 'Stress load is high. Prioritize nervous system regulation today — it will pay dividends for recovery.'
    : '';

  return { suggestions: suggestions.slice(0, 5), avoidItems, notes };
}

function generateEscalationFlags(patterns: PatternDetection[], records: DailyBiometricRecord[], _baseline: UserBaseline | null): EscalationFlag[] {
  const flags: EscalationFlag[] = [];
  const bRhr = _baseline?.restingHr14Day ?? 60;

  const severePatterns = patterns.filter(p => p.escalationNeeded);
  for (const p of severePatterns) {
    flags.push({
      id: `esc_${p.id}`,
      severity: 'alert',
      message: p.description,
      daysPersisting: p.daysPersisting,
      recommendation: 'Consider reviewing your current stress load, training volume, sleep habits, or scheduling a check-in with your practitioner.',
    });
  }

  const rhrElevatedDays = records.slice(0, 7).filter(r => safe(r.restingHr, bRhr) > bRhr * 1.08).length;
  if (rhrElevatedDays >= 5) {
    flags.push({
      id: 'esc_rhr_persistent',
      severity: 'alert',
      message: `Resting heart rate has been persistently elevated (>8% above baseline) for ${rhrElevatedDays} of the last 7 days.`,
      daysPersisting: rhrElevatedDays,
      recommendation: 'This may indicate illness, overtraining, or chronic stress. Consider a practitioner review.',
    });
  }

  const sleepFragDays = records.slice(0, 7).filter(r => safe(r.awakenings, 3) >= 5).length;
  if (sleepFragDays >= 4) {
    flags.push({
      id: 'esc_sleep_frag',
      severity: 'warning',
      message: 'Sleep fragmentation has been worsening — frequent awakenings over the past week.',
      daysPersisting: sleepFragDays,
      recommendation: 'Review evening habits, alcohol intake, room environment, and consider sleep study if persistent.',
    });
  }

  return flags;
}

function generateTopActions(scores: AllScores, training: TrainingGuidanceOutput, record: DailyBiometricRecord): ActionItem[] {
  const actions: ActionItem[] = [];
  let priority = 1;

  if (scores.recovery.score < 65) {
    actions.push({
      id: 'act_recovery',
      priority: priority++,
      action: training.label,
      reason: training.explanation,
      category: 'training',
      icon: 'activity',
    });
  }

  if (scores.sleep.score < 70) {
    actions.push({
      id: 'act_sleep',
      priority: priority++,
      action: 'Prioritize sleep tonight',
      reason: 'Sleep quality is below baseline. Earlier bedtime and wind-down routine recommended.',
      category: 'sleep',
      icon: 'moon',
    });
  }

  if (scores.stressLoad.score < 65) {
    actions.push({
      id: 'act_stress',
      priority: priority++,
      action: 'Stress regulation session',
      reason: 'Stress load is elevated. A breathwork or NSDR session will help reset your nervous system.',
      category: 'stress',
      icon: 'wind',
    });
  }

  actions.push({
    id: 'act_hydrate',
    priority: priority++,
    action: `Hydration target: ${safe(record.hydrationMl, 1500) < 2000 ? '3L' : '2.5L'} today`,
    reason: 'Consistent hydration supports recovery, cognitive function, and metabolic health.',
    category: 'nutrition',
    icon: 'droplets',
  });

  actions.push({
    id: 'act_protein',
    priority: priority++,
    action: 'Front-load protein at breakfast',
    reason: 'High-protein breakfasts correlate with more stable energy in your data.',
    category: 'nutrition',
    icon: 'utensils',
  });

  if (scores.adherence.score < 75) {
    actions.push({
      id: 'act_adherence',
      priority: priority++,
      action: 'Complete supplement stack today',
      reason: 'Supplement adherence has dipped — consistency is where the results compound.',
      category: 'supplement',
      icon: 'pill',
    });
  }

  return actions.slice(0, 5);
}

function generateSummary(scores: AllScores, _record: DailyBiometricRecord, patterns: PatternDetection[]): string {
  const recovery = scores.recovery;
  const parts: string[] = [];

  if (recovery.status === 'green') {
    parts.push('Recovery looks strong today.');
  } else if (recovery.status === 'yellow') {
    parts.push('Recovery is moderate today — listen to your body.');
  } else {
    parts.push('Recovery is suppressed today.');
  }

  if (scores.sleep.score < 70) {
    parts.push('Sleep quality was below your usual standard.');
  }

  const cycleNote = _record.cyclePhase === 'luteal' ? ' Luteal phase may be contributing to lower readiness.' : '';

  const patternNote = patterns.find(p => p.type === 'overreaching');
  if (patternNote) {
    parts.push('Training load has been high — consider backing off today.');
  }

  return parts.join(' ') + cycleNote;
}

export function generateDailyRecommendation(
  records: DailyBiometricRecord[],
  baseline: UserBaseline | null,
  meals: MealLogEntry[],
  supplements: SupplementLogEntry[]
): DailyRecommendation | null {
  if (records.length === 0) return null;

  const today = records[0];
  const priorDay = records.length > 1 ? records[1] : null;

  const recovery = computeRecoveryScore(today, baseline, priorDay);
  const sleep = computeSleepScore(today, baseline);
  const stressLoad = computeStressLoadScore(today, baseline);
  const metabolicResilience = computeMetabolicResilienceScore(today, meals);
  const adherence = computeAdherenceScore(today, supplements, meals);
  const nervousSystemBalance = computeNervousSystemBalance(today, records, baseline);
  const inflammationStrain = computeInflammationStrainScore(today, records, baseline);

  const allScores: AllScores = {
    recovery,
    sleep,
    stressLoad,
    metabolicResilience,
    adherence,
    nervousSystemBalance,
    inflammationStrain,
  };

  const patterns = detectPatterns(records, baseline, meals, supplements);
  const correlations = detectCorrelations(records, meals, supplements);
  const trainingGuidance = generateTrainingGuidance(allScores, today);
  const nutritionGuidance = generateNutritionGuidance(allScores, today, meals);
  const supplementGuidance = generateSupplementGuidance(allScores, today, supplements);
  const sleepGuidance = generateSleepGuidance(allScores, today);
  const stressGuidance = generateStressGuidance(allScores, today);
  const escalationFlags = generateEscalationFlags(patterns, records, baseline);
  const topActions = generateTopActions(allScores, trainingGuidance, today);
  const summary = generateSummary(allScores, today, patterns);

  return {
    date: today.date,
    recoveryStatus: recovery.status,
    recoveryScore: recovery.score,
    oneSentenceSummary: summary,
    topActions,
    trainingGuidance,
    nutritionGuidance,
    supplementGuidance,
    sleepGuidance,
    stressGuidance,
    escalationFlags,
    patterns,
    correlations,
    scores: allScores,
  };
}
