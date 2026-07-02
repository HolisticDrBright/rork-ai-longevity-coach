import {
  DailyBiometricRecord,
  UserBaseline,
  ScoreResult,
  ScoreBreakdownItem,
  RecoveryStatus,
  MealLogEntry,
  SupplementLogEntry,
} from '@/types/wearables';
import { parseClockHour, clockDistanceHours } from '@/utils/date';

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function safe(val: number | null, fallback: number): number {
  return val !== null && !isNaN(val) ? val : fallback;
}

function statusFromScore(score: number): RecoveryStatus {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  return 'red';
}

function labelFromStatus(status: RecoveryStatus): string {
  if (status === 'green') return 'Optimal';
  if (status === 'yellow') return 'Moderate';
  return 'Low';
}

function impactFromScore(normalizedScore: number): ScoreBreakdownItem['impact'] {
  return normalizedScore >= 70 ? 'positive' : normalizedScore >= 50 ? 'neutral' : 'negative';
}

/** Breakdown entry for a factor with real data. */
function factor(
  name: string,
  weight: number,
  rawValue: number | null,
  normalizedScore: number
): ScoreBreakdownItem {
  return { factor: name, weight, rawValue, normalizedScore, impact: impactFromScore(normalizedScore) };
}

/**
 * Breakdown entry for a factor whose underlying metric is missing.
 * Weight 0 excludes it from the weighted score (remaining weights are
 * renormalized in finalizeScore) instead of imputing a healthy default.
 */
function missingFactor(name: string): ScoreBreakdownItem {
  return { factor: name, weight: 0, rawValue: null, normalizedScore: 0, impact: 'neutral' };
}

/**
 * Weighted score over the available factors only. Missing factors carry
 * weight 0, so the remaining weights are renormalized (divide by their sum).
 * When every factor is missing, return a neutral default and label the
 * result as insufficient data rather than fabricating a healthy score.
 */
function finalizeScore(
  breakdown: ScoreBreakdownItem[],
  labelFor: (status: RecoveryStatus) => string = labelFromStatus
): ScoreResult {
  const totalWeight = breakdown.reduce((sum, b) => sum + b.weight, 0);
  if (totalWeight <= 0) {
    return { score: 60, status: 'yellow', label: 'Insufficient Data', breakdown };
  }
  const score = Math.round(
    breakdown.reduce((sum, b) => sum + b.normalizedScore * b.weight, 0) / totalWeight
  );
  const status = statusFromScore(score);
  return { score, status, label: labelFor(status), breakdown };
}

export function computeRecoveryScore(
  record: DailyBiometricRecord,
  baseline: UserBaseline | null,
  priorDayRecord: DailyBiometricRecord | null
): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];
  const bHrv = baseline?.hrv14Day ?? 50;
  const bRhr = baseline?.restingHr14Day ?? 60;

  if (record.hrv !== null) {
    const hrvVal = record.hrv;
    const hrvScore = hrvVal >= bHrv ? 100 : hrvVal >= bHrv * 0.9 ? 80 : hrvVal >= bHrv * 0.85 ? 60 : hrvVal >= bHrv * 0.8 ? 40 : 20;
    breakdown.push(factor('HRV vs baseline', 0.25, record.hrv, hrvScore));
  } else {
    breakdown.push(missingFactor('HRV vs baseline'));
  }

  if (record.restingHr !== null) {
    const rhrVal = record.restingHr;
    const rhrScore = rhrVal <= bRhr ? 100 : rhrVal <= bRhr * 1.03 ? 85 : rhrVal <= bRhr * 1.07 ? 60 : 30;
    breakdown.push(factor('Resting HR vs baseline', 0.20, record.restingHr, rhrScore));
  } else {
    breakdown.push(missingFactor('Resting HR vs baseline'));
  }

  if (record.sleepScore !== null) {
    const sleepNorm = clamp(record.sleepScore, 0, 100);
    breakdown.push(factor('Sleep score', 0.25, record.sleepScore, sleepNorm));
  } else {
    breakdown.push(missingFactor('Sleep score'));
  }

  if (record.energyScore !== null) {
    const energyNorm = clamp(record.energyScore / 10 * 100, 0, 100);
    breakdown.push(factor('Subjective energy', 0.10, record.energyScore, energyNorm));
  } else {
    breakdown.push(missingFactor('Subjective energy'));
  }

  const priorLoad = priorDayRecord ? safe(priorDayRecord.trainingLoad, 0) : 0;
  const soreness = safe(record.sorenessScore, 3);
  const loadNorm = clamp(100 - (priorLoad / 200 * 50 + soreness / 10 * 50), 0, 100);
  breakdown.push(factor('Training load / soreness', 0.10, priorLoad, loadNorm));

  if (record.respiratoryRate !== null || record.tempDeviation !== null) {
    const respRate = safe(record.respiratoryRate, 15.5);
    const tempDev = safe(record.tempDeviation, 0);
    const physioNorm = clamp(100 - Math.abs(respRate - 15.5) * 15 - Math.abs(tempDev) * 80, 0, 100);
    breakdown.push(factor('Respiratory / temp deviation', 0.10, record.respiratoryRate, physioNorm));
  } else {
    breakdown.push(missingFactor('Respiratory / temp deviation'));
  }

  return finalizeScore(breakdown);
}

export function computeSleepScore(record: DailyBiometricRecord, baseline: UserBaseline | null): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];

  if (record.sleepDurationMinutes !== null) {
    const dur = record.sleepDurationMinutes;
    const durNorm = clamp(dur >= 480 ? 100 : dur >= 420 ? 85 : dur >= 360 ? 65 : dur >= 300 ? 40 : 20, 0, 100);
    breakdown.push(factor('Total sleep', 0.25, dur, durNorm));
  } else {
    breakdown.push(missingFactor('Total sleep'));
  }

  if (record.sleepEfficiency !== null) {
    const eff = record.sleepEfficiency;
    const effNorm = clamp(eff >= 90 ? 100 : eff >= 85 ? 85 : eff >= 80 ? 65 : eff >= 70 ? 40 : 20, 0, 100);
    breakdown.push(factor('Efficiency', 0.20, eff, effNorm));
  } else {
    breakdown.push(missingFactor('Efficiency'));
  }

  if (record.remSleepMinutes !== null) {
    const rem = record.remSleepMinutes;
    const remNorm = clamp(rem >= 100 ? 100 : rem >= 80 ? 85 : rem >= 60 ? 65 : 40, 0, 100);
    breakdown.push(factor('REM sleep', 0.15, rem, remNorm));
  } else {
    breakdown.push(missingFactor('REM sleep'));
  }

  if (record.deepSleepMinutes !== null) {
    const deep = record.deepSleepMinutes;
    const deepNorm = clamp(deep >= 85 ? 100 : deep >= 60 ? 85 : deep >= 45 ? 65 : 35, 0, 100);
    breakdown.push(factor('Deep sleep', 0.15, deep, deepNorm));
  } else {
    breakdown.push(missingFactor('Deep sleep'));
  }

  if (record.awakenings !== null || record.wakeAfterSleepOnset !== null) {
    const wake = safe(record.awakenings, 3) + safe(record.wakeAfterSleepOnset, 15) / 10;
    const wakeNorm = clamp(100 - wake * 8, 0, 100);
    breakdown.push(factor('Awakenings / WASO', 0.10, record.awakenings, wakeNorm));
  } else {
    breakdown.push(missingFactor('Awakenings / WASO'));
  }

  // Bedtime consistency: bedtime may be "HH:MM" (manual) or a full ISO
  // datetime (wearable pipeline). parseClockHour handles both, and
  // clockDistanceHours handles the midnight wraparound (00:30 vs 22:30 is a
  // 2h drift, not 22h).
  const baseBedHour = parseClockHour(baseline?.bedtimeAvg) ?? 22.5;
  const bedHour = parseClockHour(record.bedtime);
  if (bedHour !== null) {
    const bedDrift = clockDistanceHours(bedHour, baseBedHour);
    const consistNorm = clamp(100 - bedDrift * 40, 0, 100);
    breakdown.push(factor('Bedtime consistency', 0.10, bedHour, consistNorm));
  } else {
    breakdown.push(missingFactor('Bedtime consistency'));
  }

  if (record.sleepLatencyMinutes !== null) {
    const lat = record.sleepLatencyMinutes;
    const latNorm = clamp(lat <= 10 ? 100 : lat <= 15 ? 85 : lat <= 25 ? 60 : 30, 0, 100);
    breakdown.push(factor('Sleep latency', 0.05, lat, latNorm));
  } else {
    breakdown.push(missingFactor('Sleep latency'));
  }

  return finalizeScore(breakdown);
}

export function computeStressLoadScore(record: DailyBiometricRecord, baseline: UserBaseline | null): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];
  const bHrv = baseline?.hrv14Day ?? 50;
  const bRhr = baseline?.restingHr14Day ?? 60;

  if (record.hrv !== null) {
    const hrvSup = record.hrv < bHrv * 0.9;
    const hrvNorm = hrvSup ? (record.hrv < bHrv * 0.8 ? 25 : 55) : 90;
    breakdown.push(factor('HRV suppression', 0.25, record.hrv, hrvNorm));
  } else {
    breakdown.push(missingFactor('HRV suppression'));
  }

  if (record.restingHr !== null) {
    const rhrElev = record.restingHr > bRhr * 1.05;
    const rhrNorm = rhrElev ? (record.restingHr > bRhr * 1.1 ? 30 : 55) : 90;
    breakdown.push(factor('Elevated resting HR', 0.20, record.restingHr, rhrNorm));
  } else {
    breakdown.push(missingFactor('Elevated resting HR'));
  }

  if (record.sleepDurationMinutes !== null) {
    const sleepDebt = record.sleepDurationMinutes < 390;
    const sleepNorm = sleepDebt ? (record.sleepDurationMinutes < 330 ? 25 : 50) : 90;
    breakdown.push(factor('Sleep debt', 0.20, record.sleepDurationMinutes, sleepNorm));
  } else {
    breakdown.push(missingFactor('Sleep debt'));
  }

  if (record.stressScoreSubjective !== null) {
    const stress = record.stressScoreSubjective;
    const stressNorm = clamp(100 - stress * 10, 0, 100);
    breakdown.push(factor('Subjective stress', 0.15, stress, stressNorm));
  } else {
    breakdown.push(missingFactor('Subjective stress'));
  }

  if (record.caffeineMg !== null) {
    const caff = record.caffeineMg;
    const caffNorm = clamp(caff <= 200 ? 90 : caff <= 300 ? 70 : caff <= 400 ? 50 : 30, 0, 100);
    breakdown.push(factor('Caffeine load', 0.05, caff, caffNorm));
  } else {
    breakdown.push(missingFactor('Caffeine load'));
  }

  const symptomCount = record.symptomFlags.length;
  const symNorm = clamp(100 - symptomCount * 20, 0, 100);
  breakdown.push(factor('Symptom burden', 0.10, symptomCount, symNorm));

  if (record.activeMinutes !== null || record.trainingLoad !== null) {
    const movement = safe(record.activeMinutes, 30);
    const load = safe(record.trainingLoad, 0);
    const moveNorm = movement >= 20 && movement <= 90 && load < 180 ? 85 : (movement < 10 || load > 200) ? 40 : 65;
    breakdown.push(factor('Movement balance', 0.05, record.activeMinutes, moveNorm));
  } else {
    breakdown.push(missingFactor('Movement balance'));
  }

  return finalizeScore(breakdown, status =>
    status === 'green' ? 'Low Stress' : status === 'yellow' ? 'Moderate Stress' : 'High Stress'
  );
}

/**
 * Glucose scoring tiers (mg/dL). Hypoglycemia is dangerous and must score
 * WORSE than mild elevation, not better:
 *   <54 critical low → 10, 54–69 low → 30, 70–100 optimal → 95,
 *   101–110 slightly elevated → 70, 111–125 elevated → 50, >125 high → 30.
 */
export function scoreGlucose(glucose: number): number {
  if (glucose < 54) return 10;
  if (glucose < 70) return 30;
  if (glucose <= 100) return 95;
  if (glucose <= 110) return 70;
  if (glucose <= 125) return 50;
  return 30;
}

export function computeMetabolicResilienceScore(
  record: DailyBiometricRecord,
  meals: MealLogEntry[]
): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];

  const todayMeals = meals.filter(m => m.date === record.date);
  const timingConsistent = todayMeals.length >= 2;
  const timingNorm = timingConsistent ? 80 : 50;
  breakdown.push({ factor: 'Meal timing consistency', weight: 0.20, rawValue: todayMeals.length, normalizedScore: timingNorm, impact: timingNorm >= 70 ? 'positive' : 'neutral' });

  const totalProtein = todayMeals.reduce((s, m) => s + m.proteinG, 0);
  const proteinNorm = clamp(totalProtein >= 120 ? 100 : totalProtein >= 90 ? 80 : totalProtein >= 60 ? 60 : 35, 0, 100);
  breakdown.push(factor('Protein sufficiency', 0.20, totalProtein, proteinNorm));

  if (record.activeMinutes !== null) {
    const active = record.activeMinutes;
    const actNorm = clamp(active >= 30 ? 90 : active >= 15 ? 70 : 40, 0, 100);
    breakdown.push(factor('Activity / post-meal movement', 0.15, active, actNorm));
  } else {
    breakdown.push(missingFactor('Activity / post-meal movement'));
  }

  if (record.sleepEfficiency !== null) {
    const sleepEff = record.sleepEfficiency;
    const sleepNorm = clamp(sleepEff >= 85 ? 90 : sleepEff >= 75 ? 65 : 40, 0, 100);
    breakdown.push(factor('Sleep quality', 0.15, sleepEff, sleepNorm));
  } else {
    breakdown.push(missingFactor('Sleep quality'));
  }

  if (record.energyScore !== null) {
    const energyNorm = clamp(record.energyScore / 10 * 100, 0, 100);
    breakdown.push(factor('Energy stability', 0.10, record.energyScore, energyNorm));
  } else {
    breakdown.push(missingFactor('Energy stability'));
  }

  if (record.cravingsScore !== null) {
    const cravNorm = clamp(100 - record.cravingsScore * 12, 0, 100);
    breakdown.push(factor('Cravings stability', 0.10, record.cravingsScore, cravNorm));
  } else {
    breakdown.push(missingFactor('Cravings stability'));
  }

  if (record.glucoseAvg !== null) {
    const glucNorm = scoreGlucose(record.glucoseAvg);
    breakdown.push(factor('Glucose (if available)', 0.10, record.glucoseAvg, glucNorm));
  } else {
    breakdown.push(missingFactor('Glucose (if available)'));
  }

  return finalizeScore(breakdown);
}

export function computeAdherenceScore(
  record: DailyBiometricRecord,
  supplements: SupplementLogEntry[],
  meals: MealLogEntry[]
): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];

  const todaySupps = supplements.filter(s => s.date === record.date);
  const suppAdherence = todaySupps.length > 0 ? todaySupps.filter(s => s.adherence).length / todaySupps.length * 100 : 50;
  breakdown.push({ factor: 'Supplements logged', weight: 0.30, rawValue: suppAdherence, normalizedScore: suppAdherence, impact: suppAdherence >= 80 ? 'positive' : suppAdherence >= 60 ? 'neutral' : 'negative' });

  if (record.hydrationMl !== null) {
    const hydration = record.hydrationMl;
    const hydNorm = clamp(hydration >= 2500 ? 100 : hydration >= 2000 ? 85 : hydration >= 1500 ? 60 : 30, 0, 100);
    breakdown.push(factor('Hydration target', 0.20, hydration, hydNorm));
  } else {
    breakdown.push(missingFactor('Hydration target'));
  }

  const todayMeals = meals.filter(m => m.date === record.date);
  const mealsLogged = todayMeals.length >= 3;
  const totalProt = todayMeals.reduce((s, m) => s + m.proteinG, 0);
  const mealNorm = mealsLogged && totalProt >= 90 ? 90 : mealsLogged ? 70 : 40;
  breakdown.push(factor('Meals / protein target', 0.20, totalProt, mealNorm));

  // Bedtime may be "HH:MM" or an ISO datetime. Hours 0–4 are after-midnight
  // bedtimes and count as LATE (past target), not "before 22:30".
  const bedHourRaw = parseClockHour(record.bedtime);
  if (bedHourRaw !== null) {
    const bedHour = bedHourRaw < 5 ? bedHourRaw + 24 : bedHourRaw;
    const bedNorm = bedHour <= 22.5 ? 95 : bedHour <= 23 ? 75 : bedHour <= 23.5 ? 55 : 30;
    breakdown.push(factor('Bedtime target', 0.10, bedHourRaw, bedNorm));
  } else {
    breakdown.push(missingFactor('Bedtime target'));
  }

  if (record.steps !== null || record.workoutMinutes !== null) {
    const workout = safe(record.workoutMinutes, 0);
    const steps = safe(record.steps, 0);
    const moveNorm = (workout > 0 || steps >= 7000) ? 90 : steps >= 5000 ? 65 : 35;
    breakdown.push(factor('Workout / movement goal', 0.10, record.steps, moveNorm));
  } else {
    breakdown.push(missingFactor('Workout / movement goal'));
  }

  const checkinNorm = record.energyScore !== null && record.moodScore !== null ? 90 : 40;
  breakdown.push({ factor: 'Check-in completed', weight: 0.10, rawValue: checkinNorm, normalizedScore: checkinNorm, impact: checkinNorm >= 70 ? 'positive' : 'negative' });

  return finalizeScore(breakdown);
}

export function computeNervousSystemBalance(
  record: DailyBiometricRecord,
  recentRecords: DailyBiometricRecord[],
  baseline: UserBaseline | null
): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];
  const bHrv = baseline?.hrv14Day ?? 50;

  const hrvTrend = recentRecords.slice(0, 7).map(r => r.hrv).filter((v): v is number => v !== null);
  if (hrvTrend.length > 0) {
    const hrvAvg = hrvTrend.reduce((a, b) => a + b, 0) / hrvTrend.length;
    const hrvTrendNorm = clamp(hrvAvg >= bHrv ? 95 : hrvAvg >= bHrv * 0.9 ? 70 : 40, 0, 100);
    breakdown.push(factor('HRV trend', 0.25, hrvAvg, hrvTrendNorm));
  } else {
    breakdown.push(missingFactor('HRV trend'));
  }

  const sleepTrend = recentRecords.slice(0, 7).map(r => r.sleepScore).filter((v): v is number => v !== null);
  if (sleepTrend.length > 0) {
    const sleepAvg = sleepTrend.reduce((a, b) => a + b, 0) / sleepTrend.length;
    const sleepNorm = clamp(sleepAvg >= 80 ? 95 : sleepAvg >= 70 ? 70 : 45, 0, 100);
    breakdown.push(factor('Sleep trend', 0.20, sleepAvg, sleepNorm));
  } else {
    breakdown.push(missingFactor('Sleep trend'));
  }

  if (record.stressScoreSubjective !== null) {
    const stress = record.stressScoreSubjective;
    const stressNorm = clamp(100 - stress * 12, 0, 100);
    breakdown.push(factor('Stress score', 0.15, stress, stressNorm));
  } else {
    breakdown.push(missingFactor('Stress score'));
  }

  const hasBreathwork = record.symptomFlags.includes('breathwork') || record.symptomFlags.includes('meditation');
  const bwNorm = hasBreathwork ? 95 : 50;
  breakdown.push({ factor: 'Breathwork / meditation', weight: 0.10, rawValue: hasBreathwork ? 1 : 0, normalizedScore: bwNorm, impact: bwNorm >= 70 ? 'positive' : 'neutral' });

  const symptomBurden = record.symptomFlags.length;
  const symNorm = clamp(100 - symptomBurden * 18, 0, 100);
  breakdown.push(factor('Symptom trends', 0.10, symptomBurden, symNorm));

  const cycleAdj = record.cyclePhase === 'luteal' ? -8 : record.cyclePhase === 'follicular' ? 5 : 0;
  const cycleNorm = clamp(75 + cycleAdj, 0, 100);
  breakdown.push({ factor: 'Cycle phase', weight: 0.10, rawValue: cycleAdj, normalizedScore: cycleNorm, impact: cycleAdj >= 0 ? 'positive' : 'neutral' });

  if (record.energyScore !== null) {
    const energyStab = clamp(record.energyScore / 10 * 100, 0, 100);
    breakdown.push(factor('Energy stability', 0.10, record.energyScore, energyStab));
  } else {
    breakdown.push(missingFactor('Energy stability'));
  }

  return finalizeScore(breakdown);
}

export function computeInflammationStrainScore(
  record: DailyBiometricRecord,
  recentRecords: DailyBiometricRecord[],
  baseline: UserBaseline | null
): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];
  const bRhr = baseline?.restingHr14Day ?? 60;

  const sleepDurations = recentRecords.slice(0, 7).map(r => r.sleepDurationMinutes).filter((v): v is number => v !== null);
  if (sleepDurations.length > 0) {
    const sleepDebt = sleepDurations.filter(d => d < 360).length;
    const sleepDebtNorm = clamp(100 - sleepDebt * 20, 0, 100);
    breakdown.push(factor('Sleep debt', 0.15, sleepDebt, sleepDebtNorm));
  } else {
    breakdown.push(missingFactor('Sleep debt'));
  }

  if (record.restingHr !== null) {
    const rhrElev = record.restingHr - bRhr;
    const rhrNorm = clamp(100 - rhrElev * 10, 0, 100);
    breakdown.push(factor('Elevated resting HR', 0.15, record.restingHr, rhrNorm));
  } else {
    breakdown.push(missingFactor('Elevated resting HR'));
  }

  if (record.respiratoryRate !== null) {
    const resp = record.respiratoryRate;
    const respNorm = clamp(100 - Math.abs(resp - 15.5) * 20, 0, 100);
    breakdown.push(factor('Respiratory rate deviation', 0.10, resp, respNorm));
  } else {
    breakdown.push(missingFactor('Respiratory rate deviation'));
  }

  if (record.tempDeviation !== null) {
    const temp = record.tempDeviation;
    const tempNorm = clamp(100 - Math.abs(temp) * 100, 0, 100);
    breakdown.push(factor('Temp deviation', 0.10, temp, tempNorm));
  } else {
    breakdown.push(missingFactor('Temp deviation'));
  }

  if (record.sorenessScore !== null) {
    const soreNorm = clamp(100 - record.sorenessScore * 12, 0, 100);
    breakdown.push(factor('Soreness', 0.10, record.sorenessScore, soreNorm));
  } else {
    breakdown.push(missingFactor('Soreness'));
  }

  const load = safe(record.trainingLoad, 0);
  const loadNorm = clamp(load <= 100 ? 90 : load <= 150 ? 70 : load <= 200 ? 50 : 30, 0, 100);
  breakdown.push(factor('Training load', 0.10, load, loadNorm));

  if (record.readinessScore !== null) {
    const readNorm = clamp(record.readinessScore, 0, 100);
    breakdown.push(factor('Low recovery', 0.10, record.readinessScore, readNorm));
  } else {
    breakdown.push(missingFactor('Low recovery'));
  }

  const alcohol = safe(record.alcoholUnits, 0);
  const alcNorm = clamp(100 - alcohol * 25, 0, 100);
  breakdown.push(factor('Alcohol intake', 0.10, alcohol, alcNorm));

  breakdown.push(missingFactor('Nutrition patterns'));

  return finalizeScore(breakdown, status =>
    status === 'green' ? 'Low Inflammation' : status === 'yellow' ? 'Moderate Strain' : 'High Strain'
  );
}
