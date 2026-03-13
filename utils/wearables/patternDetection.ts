import {
  DailyBiometricRecord,
  UserBaseline,
  PatternDetection,
  CorrelationResult,
  ConfidenceLevel,
  MealLogEntry,
  SupplementLogEntry,
} from '@/types/wearables';

function safe(val: number | null, fallback: number): number {
  return val !== null && !isNaN(val) ? val : fallback;
}

export function detectPatterns(
  records: DailyBiometricRecord[],
  baseline: UserBaseline | null,
  _meals: MealLogEntry[],
  _supplements: SupplementLogEntry[]
): PatternDetection[] {
  const patterns: PatternDetection[] = [];
  if (records.length < 3) return patterns;

  const today = records[0];
  const recent7 = records.slice(0, 7);
  const bHrv = baseline?.hrv14Day ?? 50;
  const bRhr = baseline?.restingHr14Day ?? 60;

  const lowRecoveryDays = recent7.filter(r => {
    const hrvLow = safe(r.hrv, bHrv) < bHrv * 0.85;
    const rhrHigh = safe(r.restingHr, bRhr) > bRhr * 1.05;
    const sleepLow = safe(r.sleepScore, 75) < 70;
    return (hrvLow && rhrHigh) || (hrvLow && sleepLow) || (rhrHigh && sleepLow);
  }).length;

  if (lowRecoveryDays >= 2) {
    patterns.push({
      id: 'pat_low_recovery',
      type: 'low_recovery',
      severity: lowRecoveryDays >= 5 ? 'severe' : lowRecoveryDays >= 3 ? 'moderate' : 'mild',
      confidence: lowRecoveryDays >= 4 ? 'high' : 'moderate',
      description: `Recovery has been suppressed for ${lowRecoveryDays} of the last 7 days. HRV is trending below baseline and resting heart rate is elevated.`,
      factors: ['hrv_below_baseline', 'resting_hr_elevated', 'sleep_quality_low'],
      daysPersisting: lowRecoveryDays,
      escalationNeeded: lowRecoveryDays >= 5,
    });
  }

  const highLoadDays = recent7.filter(r => safe(r.trainingLoad, 0) > 150).length;
  const highSoreness = safe(today.sorenessScore, 3) >= 6;
  const hrvSuppressed = safe(today.hrv, bHrv) < bHrv * 0.9;
  if (highLoadDays >= 2 && (highSoreness || hrvSuppressed)) {
    patterns.push({
      id: 'pat_overreaching',
      type: 'overreaching',
      severity: highLoadDays >= 4 ? 'severe' : 'moderate',
      confidence: 'moderate',
      description: 'Training load has been elevated and recovery markers are suppressed. You may be approaching overreaching.',
      factors: ['high_training_load', 'elevated_soreness', 'hrv_suppressed'],
      daysPersisting: highLoadDays,
      escalationNeeded: highLoadDays >= 4,
    });
  }

  const sleepDisruptDays = recent7.filter(r => {
    const effLow = safe(r.sleepEfficiency, 85) < 80;
    const hadAlcohol = safe(r.alcoholUnits, 0) > 0;
    const rhrUp = safe(r.restingHr, bRhr) > bRhr * 1.05;
    return effLow && (hadAlcohol || rhrUp);
  }).length;
  if (sleepDisruptDays >= 2) {
    patterns.push({
      id: 'pat_sleep_disruption',
      type: 'sleep_disruption',
      severity: sleepDisruptDays >= 4 ? 'severe' : 'moderate',
      confidence: 'high',
      description: 'Sleep quality has been disrupted, likely related to alcohol intake or elevated nighttime heart rate.',
      factors: ['low_sleep_efficiency', 'alcohol', 'elevated_rhr'],
      daysPersisting: sleepDisruptDays,
      escalationNeeded: sleepDisruptDays >= 5,
    });
  }

  const lowEnergy = safe(today.energyScore, 6) <= 4;
  const highCravings = safe(today.cravingsScore, 4) >= 6;
  const poorSleep = safe(today.sleepScore, 75) < 65;
  if (lowEnergy && highCravings && poorSleep) {
    patterns.push({
      id: 'pat_metabolic_stress',
      type: 'metabolic_stress',
      severity: 'moderate',
      confidence: 'moderate',
      description: 'Energy crashes combined with cravings and poor sleep suggest metabolic stress. Meal timing and composition may need adjustment.',
      factors: ['energy_crashes', 'cravings', 'poor_sleep'],
      daysPersisting: 1,
      escalationNeeded: false,
    });
  }

  if (today.cyclePhase === 'luteal') {
    const cravingsUp = safe(today.cravingsScore, 4) >= 5;
    const recoveryDown = safe(today.readinessScore, 75) < 70;
    if (cravingsUp || recoveryDown) {
      patterns.push({
        id: 'pat_cycle_aware',
        type: 'cycle_aware',
        severity: 'mild',
        confidence: 'high',
        description: 'Luteal phase detected. Recovery tends to decrease and cravings increase during this phase — this is normal hormonal variation.',
        factors: ['luteal_phase', 'cravings_increase', 'recovery_decrease'],
        daysPersisting: safe(today.cycleDayEstimate, 14) - 14,
        escalationNeeded: false,
      });
    }
  }

  const adherenceScores = recent7.map(r => safe(r.adherenceScore, 50));
  const avgAdherence = adherenceScores.reduce((a, b) => a + b, 0) / adherenceScores.length;
  const sleepScores = recent7.map(r => safe(r.sleepScore, 75));
  const avgSleep = sleepScores.reduce((a, b) => a + b, 0) / sleepScores.length;
  const hrvs = recent7.map(r => safe(r.hrv, bHrv));
  const avgHrv = hrvs.reduce((a, b) => a + b, 0) / hrvs.length;

  if (avgAdherence > 80 && avgSleep > 75 && avgHrv >= bHrv * 0.95) {
    patterns.push({
      id: 'pat_positive',
      type: 'positive_reinforcement',
      severity: 'mild',
      confidence: 'high',
      description: 'Your adherence, sleep, and HRV have been solid this week. The consistency is paying off — keep it going.',
      factors: ['high_adherence', 'good_sleep', 'stable_hrv'],
      daysPersisting: 7,
      escalationNeeded: false,
    });
  }

  const bedtimes = recent7.map(r => {
    if (!r.bedtime) return 22.5;
    return parseInt(r.bedtime.split(':')[0]) + parseInt(r.bedtime.split(':')[1]) / 60;
  });
  const bedtimeRange = Math.max(...bedtimes) - Math.min(...bedtimes);
  if (bedtimeRange > 1.5) {
    patterns.push({
      id: 'pat_circadian_drift',
      type: 'circadian_drift',
      severity: bedtimeRange > 2.5 ? 'moderate' : 'mild',
      confidence: 'moderate',
      description: `Your bedtime has varied by ${bedtimeRange.toFixed(1)} hours over the past week. Circadian consistency is a key driver of sleep quality and recovery.`,
      factors: ['bedtime_variation', 'circadian_disruption'],
      daysPersisting: 7,
      escalationNeeded: false,
    });
  }

  const hydrationLowDays = recent7.filter(r => safe(r.hydrationMl, 1500) < 1500).length;
  if (hydrationLowDays >= 3) {
    patterns.push({
      id: 'pat_hydration_deficit',
      type: 'low_recovery',
      severity: hydrationLowDays >= 5 ? 'moderate' : 'mild',
      confidence: 'moderate',
      description: `Hydration has been below 1.5L for ${hydrationLowDays} of the last 7 days. Chronic dehydration impacts recovery, cognition, and soreness.`,
      factors: ['low_hydration', 'recovery_impact'],
      daysPersisting: hydrationLowDays,
      escalationNeeded: false,
    });
  }

  const weekendAlcohol = recent7.filter(r => {
    const day = new Date(r.date).getDay();
    return (day === 0 || day === 5 || day === 6) && safe(r.alcoholUnits, 0) >= 2;
  }).length;
  const weekendSleepDrop = recent7.filter(r => {
    const day = new Date(r.date).getDay();
    return (day === 0 || day === 6) && safe(r.sleepScore, 75) < 65;
  }).length;
  if (weekendAlcohol >= 2 && weekendSleepDrop >= 1) {
    patterns.push({
      id: 'pat_weekend_derailment',
      type: 'sleep_disruption',
      severity: 'moderate',
      confidence: 'moderate',
      description: 'Weekend alcohol intake appears to be disrupting your sleep and recovery, undoing weekday progress.',
      factors: ['weekend_alcohol', 'sleep_disruption', 'recovery_setback'],
      daysPersisting: 7,
      escalationNeeded: false,
    });
  }

  const rhrElev5 = recent7.filter(r => safe(r.restingHr, bRhr) > bRhr * 1.1).length;
  const sleepFragHigh = recent7.filter(r => safe(r.awakenings, 3) >= 5).length;
  const tempElevated = recent7.filter(r => safe(r.tempDeviation, 0) > 0.5).length;
  if (rhrElev5 >= 3 && (sleepFragHigh >= 2 || tempElevated >= 2)) {
    patterns.push({
      id: 'pat_illness_watch',
      type: 'chronic_inflammation',
      severity: 'moderate',
      confidence: 'moderate',
      description: 'Elevated resting HR, temperature deviation, and sleep fragmentation may indicate illness onset or acute systemic strain.',
      factors: ['elevated_rhr', 'temp_deviation', 'sleep_fragmentation'],
      daysPersisting: rhrElev5,
      escalationNeeded: rhrElev5 >= 5,
    });
  }

  const prior7 = records.slice(7, 14);
  if (prior7.length >= 5) {
    const priorAvgRecovery = prior7.reduce((s, r) => s + safe(r.readinessScore, 70), 0) / prior7.length;
    const currentAvgRecovery = recent7.reduce((s, r) => s + safe(r.readinessScore, 70), 0) / recent7.length;
    if (currentAvgRecovery > priorAvgRecovery + 8) {
      patterns.push({
        id: 'pat_recovery_rebound',
        type: 'positive_reinforcement',
        severity: 'mild',
        confidence: 'moderate',
        description: `Recovery has improved by ${Math.round(currentAvgRecovery - priorAvgRecovery)} points compared to last week. Your recent changes appear to be working.`,
        factors: ['recovery_improving', 'positive_trajectory'],
        daysPersisting: 7,
        escalationNeeded: false,
      });
    }
  }

  const highStressDays = recent7.filter(r => safe(r.stressScoreSubjective, 5) >= 7).length;
  const lowMovementDays = recent7.filter(r => safe(r.steps, 5000) < 3000).length;
  if (highStressDays >= 4 && lowMovementDays >= 3) {
    patterns.push({
      id: 'pat_chronic_stress',
      type: 'metabolic_stress',
      severity: highStressDays >= 6 ? 'severe' : 'moderate',
      confidence: 'moderate',
      description: 'Sustained high stress with low movement creates a compounding negative pattern for recovery and metabolic health.',
      factors: ['chronic_stress', 'sedentary_pattern', 'recovery_suppression'],
      daysPersisting: highStressDays,
      escalationNeeded: highStressDays >= 6,
    });
  }

  return patterns;
}

export function detectCorrelations(
  records: DailyBiometricRecord[],
  meals: MealLogEntry[],
  supplements: SupplementLogEntry[]
): CorrelationResult[] {
  const correlations: CorrelationResult[] = [];
  if (records.length < 7) return correlations;

  const alcoholDays = records.filter(r => safe(r.alcoholUnits, 0) > 0);
  const noAlcoholDays = records.filter(r => safe(r.alcoholUnits, 0) === 0);
  if (alcoholDays.length >= 3 && noAlcoholDays.length >= 3) {
    const alcSleepAvg = alcoholDays.reduce((s, r) => s + safe(r.sleepEfficiency, 85), 0) / alcoholDays.length;
    const noAlcSleepAvg = noAlcoholDays.reduce((s, r) => s + safe(r.sleepEfficiency, 85), 0) / noAlcoholDays.length;
    const diff = noAlcSleepAvg - alcSleepAvg;
    if (diff > 3) {
      correlations.push({
        id: 'cor_alcohol_sleep',
        factorA: 'Alcohol intake',
        factorB: 'Sleep efficiency',
        direction: 'negative',
        strength: Math.min(diff / 15, 1),
        confidence: diff > 6 ? 'high' : 'moderate',
        dataPoints: alcoholDays.length + noAlcoholDays.length,
        insight: `On nights with alcohol, your sleep efficiency averages ${alcSleepAvg.toFixed(0)}% vs ${noAlcSleepAvg.toFixed(0)}% without — a ${diff.toFixed(1)}% difference.`,
        actionable: true,
      });
    }

    const alcHrvAvg = alcoholDays.reduce((s, r) => s + safe(r.hrv, 50), 0) / alcoholDays.length;
    const noAlcHrvAvg = noAlcoholDays.reduce((s, r) => s + safe(r.hrv, 50), 0) / noAlcoholDays.length;
    const hrvDiff = noAlcHrvAvg - alcHrvAvg;
    if (hrvDiff > 3) {
      correlations.push({
        id: 'cor_alcohol_hrv',
        factorA: 'Alcohol intake',
        factorB: 'HRV next morning',
        direction: 'negative',
        strength: Math.min(hrvDiff / 20, 1),
        confidence: hrvDiff > 8 ? 'high' : 'moderate',
        dataPoints: alcoholDays.length + noAlcoholDays.length,
        insight: `Alcohol appears to suppress your HRV by an average of ${hrvDiff.toFixed(0)} ms the following morning.`,
        actionable: true,
      });
    }
  }

  const highCaffLateDays = records.filter(r => {
    if (!r.caffeineLastTime) return false;
    const hour = parseInt(r.caffeineLastTime.split(':')[0]);
    return hour >= 14 && safe(r.caffeineMg, 0) > 100;
  });
  const earlyCaffDays = records.filter(r => {
    if (!r.caffeineLastTime) return false;
    const hour = parseInt(r.caffeineLastTime.split(':')[0]);
    return hour < 14;
  });
  if (highCaffLateDays.length >= 3 && earlyCaffDays.length >= 3) {
    const lateSleepAvg = highCaffLateDays.reduce((s, r) => s + safe(r.sleepScore, 75), 0) / highCaffLateDays.length;
    const earlySleepAvg = earlyCaffDays.reduce((s, r) => s + safe(r.sleepScore, 75), 0) / earlyCaffDays.length;
    const diff = earlySleepAvg - lateSleepAvg;
    if (diff > 3) {
      correlations.push({
        id: 'cor_caffeine_sleep',
        factorA: 'Late caffeine (after 2 PM)',
        factorB: 'Sleep quality',
        direction: 'negative',
        strength: Math.min(diff / 12, 1),
        confidence: diff > 5 ? 'moderate' : 'low',
        dataPoints: highCaffLateDays.length + earlyCaffDays.length,
        insight: `Sleep quality is ${diff.toFixed(0)} points higher on days when caffeine is consumed before 2 PM.`,
        actionable: true,
      });
    }
  }

  const workoutDays = records.filter(r => safe(r.workoutMinutes, 0) > 30);
  if (workoutDays.length >= 3) {
    const nextDayReadiness: number[] = [];
    workoutDays.forEach(wd => {
      const idx = records.indexOf(wd);
      if (idx > 0) {
        nextDayReadiness.push(safe(records[idx - 1].readinessScore, 75));
      }
    });
    const hiitDays = workoutDays.filter(r => r.workoutType === 'HIIT' || safe(r.trainingLoad, 0) > 150);
    const zone2Days = workoutDays.filter(r => r.workoutType === 'zone_2' || safe(r.trainingLoad, 0) <= 100);
    if (hiitDays.length >= 2 && zone2Days.length >= 2) {
      correlations.push({
        id: 'cor_workout_readiness',
        factorA: 'Workout intensity',
        factorB: 'Next-day readiness',
        direction: 'negative',
        strength: 0.6,
        confidence: 'moderate',
        dataPoints: hiitDays.length + zone2Days.length,
        insight: 'Higher intensity workouts tend to lower your next-day readiness score more than zone 2 sessions.',
        actionable: true,
      });
    }
  }

  const todaySupps = supplements.filter(s => s.date === records[0]?.date);
  const _magTaken = todaySupps.some(s => s.supplementName.toLowerCase().includes('magnesium') && s.adherence);
  const recentMag = records.slice(0, 14).map((r, _i) => {
    const daySupps = supplements.filter(s => s.date === r.date);
    const took = daySupps.some(s => s.supplementName.toLowerCase().includes('magnesium') && s.adherence);
    return { sleepScore: safe(r.sleepScore, 75), magTaken: took };
  });
  const magDays = recentMag.filter(d => d.magTaken);
  const noMagDays = recentMag.filter(d => !d.magTaken);
  if (magDays.length >= 3 && noMagDays.length >= 3) {
    const magSleepAvg = magDays.reduce((s, d) => s + d.sleepScore, 0) / magDays.length;
    const noMagSleepAvg = noMagDays.reduce((s, d) => s + d.sleepScore, 0) / noMagDays.length;
    const diff = magSleepAvg - noMagSleepAvg;
    if (diff > 2) {
      correlations.push({
        id: 'cor_magnesium_sleep',
        factorA: 'Evening magnesium',
        factorB: 'Sleep quality',
        direction: 'positive',
        strength: Math.min(diff / 10, 1),
        confidence: diff > 5 ? 'high' : 'moderate',
        dataPoints: magDays.length + noMagDays.length,
        insight: `Sleep quality is ${diff.toFixed(0)} points higher on nights when magnesium is taken. Missed doses appear to coincide with lower sleep quality.`,
        actionable: true,
      });
    }
  }

  const hydrationHigh = records.filter(r => safe(r.hydrationMl, 1500) >= 2500);
  const hydrationLow = records.filter(r => safe(r.hydrationMl, 1500) < 2000);
  if (hydrationHigh.length >= 3 && hydrationLow.length >= 3) {
    const highSoreAvg = hydrationHigh.reduce((s, r) => s + safe(r.sorenessScore, 3), 0) / hydrationHigh.length;
    const lowSoreAvg = hydrationLow.reduce((s, r) => s + safe(r.sorenessScore, 3), 0) / hydrationLow.length;
    const diff = lowSoreAvg - highSoreAvg;
    if (diff > 0.5) {
      correlations.push({
        id: 'cor_hydration_soreness',
        factorA: 'Hydration level',
        factorB: 'Soreness',
        direction: 'positive',
        strength: Math.min(diff / 3, 1),
        confidence: diff > 1 ? 'moderate' : 'low',
        dataPoints: hydrationHigh.length + hydrationLow.length,
        insight: 'Better hydration appears associated with reduced soreness levels.',
        actionable: true,
      });
    }
  }

  return correlations.sort((a, b) => {
    const confOrder: Record<ConfidenceLevel, number> = { high: 0, moderate: 1, low: 2 };
    return confOrder[a.confidence] - confOrder[b.confidence];
  });
}
