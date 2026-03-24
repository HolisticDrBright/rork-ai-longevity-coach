import {
  DailyBiometricRecord,
  UserBaseline,
  ScoreResult,
  ScoreBreakdownItem,
  RecoveryStatus,
  MealLogEntry,
  SupplementLogEntry,
} from '@/types/wearables';

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

export function computeRecoveryScore(
  record: DailyBiometricRecord,
  baseline: UserBaseline | null,
  priorDayRecord: DailyBiometricRecord | null
): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];
  const bHrv = baseline?.hrv14Day ?? 50;
  const bRhr = baseline?.restingHr14Day ?? 60;

  const hrvVal = safe(record.hrv, bHrv);
  const hrvScore = record.hrv !== null
    ? (hrvVal >= bHrv ? 100 : hrvVal >= bHrv * 0.9 ? 80 : hrvVal >= bHrv * 0.85 ? 60 : hrvVal >= bHrv * 0.8 ? 40 : 20)
    : 60;
  breakdown.push({ factor: 'HRV vs baseline', weight: 0.25, rawValue: record.hrv, normalizedScore: hrvScore, impact: hrvScore >= 70 ? 'positive' : hrvScore >= 50 ? 'neutral' : 'negative' });

  const rhrVal = safe(record.restingHr, bRhr);
  const rhrScore = record.restingHr !== null
    ? (rhrVal <= bRhr ? 100 : rhrVal <= bRhr * 1.03 ? 85 : rhrVal <= bRhr * 1.07 ? 60 : 30)
    : 60;
  breakdown.push({ factor: 'Resting HR vs baseline', weight: 0.20, rawValue: record.restingHr, normalizedScore: rhrScore, impact: rhrScore >= 70 ? 'positive' : rhrScore >= 50 ? 'neutral' : 'negative' });

  const sleepVal = safe(record.sleepScore, 75);
  const sleepNorm = clamp(sleepVal / 100 * 100, 0, 100);
  breakdown.push({ factor: 'Sleep score', weight: 0.25, rawValue: record.sleepScore, normalizedScore: sleepNorm, impact: sleepNorm >= 70 ? 'positive' : sleepNorm >= 50 ? 'neutral' : 'negative' });

  const energyVal = safe(record.energyScore, 6);
  const energyNorm = clamp(energyVal / 10 * 100, 0, 100);
  breakdown.push({ factor: 'Subjective energy', weight: 0.10, rawValue: record.energyScore, normalizedScore: energyNorm, impact: energyNorm >= 70 ? 'positive' : energyNorm >= 50 ? 'neutral' : 'negative' });

  const priorLoad = priorDayRecord ? safe(priorDayRecord.trainingLoad, 0) : 0;
  const soreness = safe(record.sorenessScore, 3);
  const loadNorm = clamp(100 - (priorLoad / 200 * 50 + soreness / 10 * 50), 0, 100);
  breakdown.push({ factor: 'Training load / soreness', weight: 0.10, rawValue: priorLoad, normalizedScore: loadNorm, impact: loadNorm >= 70 ? 'positive' : loadNorm >= 50 ? 'neutral' : 'negative' });

  const respRate = safe(record.respiratoryRate, 15.5);
  const tempDev = safe(record.tempDeviation, 0);
  const physioNorm = clamp(100 - Math.abs(respRate - 15.5) * 15 - Math.abs(tempDev) * 80, 0, 100);
  breakdown.push({ factor: 'Respiratory / temp deviation', weight: 0.10, rawValue: record.respiratoryRate, normalizedScore: physioNorm, impact: physioNorm >= 70 ? 'positive' : physioNorm >= 50 ? 'neutral' : 'negative' });

  const score = Math.round(breakdown.reduce((sum, b) => sum + b.normalizedScore * b.weight, 0));
  const status = statusFromScore(score);

  return { score, status, label: labelFromStatus(status), breakdown };
}

export function computeSleepScore(record: DailyBiometricRecord, baseline: UserBaseline | null): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];

  const dur = safe(record.sleepDurationMinutes, 420);
  const durNorm = clamp(dur >= 480 ? 100 : dur >= 420 ? 85 : dur >= 360 ? 65 : dur >= 300 ? 40 : 20, 0, 100);
  breakdown.push({ factor: 'Total sleep', weight: 0.25, rawValue: record.sleepDurationMinutes, normalizedScore: durNorm, impact: durNorm >= 70 ? 'positive' : durNorm >= 50 ? 'neutral' : 'negative' });

  const eff = safe(record.sleepEfficiency, 85);
  const effNorm = clamp(eff >= 90 ? 100 : eff >= 85 ? 85 : eff >= 80 ? 65 : eff >= 70 ? 40 : 20, 0, 100);
  breakdown.push({ factor: 'Efficiency', weight: 0.20, rawValue: record.sleepEfficiency, normalizedScore: effNorm, impact: effNorm >= 70 ? 'positive' : effNorm >= 50 ? 'neutral' : 'negative' });

  const rem = safe(record.remSleepMinutes, 90);
  const remNorm = clamp(rem >= 100 ? 100 : rem >= 80 ? 85 : rem >= 60 ? 65 : 40, 0, 100);
  breakdown.push({ factor: 'REM sleep', weight: 0.15, rawValue: record.remSleepMinutes, normalizedScore: remNorm, impact: remNorm >= 70 ? 'positive' : remNorm >= 50 ? 'neutral' : 'negative' });

  const deep = safe(record.deepSleepMinutes, 70);
  const deepNorm = clamp(deep >= 85 ? 100 : deep >= 60 ? 85 : deep >= 45 ? 65 : 35, 0, 100);
  breakdown.push({ factor: 'Deep sleep', weight: 0.15, rawValue: record.deepSleepMinutes, normalizedScore: deepNorm, impact: deepNorm >= 70 ? 'positive' : deepNorm >= 50 ? 'neutral' : 'negative' });

  const wake = safe(record.awakenings, 3) + safe(record.wakeAfterSleepOnset, 15) / 10;
  const wakeNorm = clamp(100 - wake * 8, 0, 100);
  breakdown.push({ factor: 'Awakenings / WASO', weight: 0.10, rawValue: record.awakenings, normalizedScore: wakeNorm, impact: wakeNorm >= 70 ? 'positive' : wakeNorm >= 50 ? 'neutral' : 'negative' });

  const bBed = baseline?.bedtimeAvg ?? '22:30';
  const bedHour = record.bedtime ? parseInt(record.bedtime.split(':')[0]) + parseInt(record.bedtime.split(':')[1]) / 60 : 22.5;
  const baseBedHour = parseInt(bBed.split(':')[0]) + parseInt(bBed.split(':')[1]) / 60;
  const bedDrift = Math.abs(bedHour - baseBedHour);
  const consistNorm = clamp(100 - bedDrift * 40, 0, 100);
  breakdown.push({ factor: 'Bedtime consistency', weight: 0.10, rawValue: bedHour, normalizedScore: consistNorm, impact: consistNorm >= 70 ? 'positive' : consistNorm >= 50 ? 'neutral' : 'negative' });

  const lat = safe(record.sleepLatencyMinutes, 12);
  const latNorm = clamp(lat <= 10 ? 100 : lat <= 15 ? 85 : lat <= 25 ? 60 : 30, 0, 100);
  breakdown.push({ factor: 'Sleep latency', weight: 0.05, rawValue: record.sleepLatencyMinutes, normalizedScore: latNorm, impact: latNorm >= 70 ? 'positive' : latNorm >= 50 ? 'neutral' : 'negative' });

  const score = Math.round(breakdown.reduce((sum, b) => sum + b.normalizedScore * b.weight, 0));
  const status = statusFromScore(score);
  return { score, status, label: labelFromStatus(status), breakdown };
}

export function computeStressLoadScore(record: DailyBiometricRecord, baseline: UserBaseline | null): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];
  const bHrv = baseline?.hrv14Day ?? 50;
  const bRhr = baseline?.restingHr14Day ?? 60;

  const hrvSup = safe(record.hrv, bHrv) < bHrv * 0.9;
  const hrvNorm = hrvSup ? (safe(record.hrv, bHrv) < bHrv * 0.8 ? 25 : 55) : 90;
  breakdown.push({ factor: 'HRV suppression', weight: 0.25, rawValue: record.hrv, normalizedScore: hrvNorm, impact: hrvNorm >= 70 ? 'positive' : hrvNorm >= 50 ? 'neutral' : 'negative' });

  const rhrElev = safe(record.restingHr, bRhr) > bRhr * 1.05;
  const rhrNorm = rhrElev ? (safe(record.restingHr, bRhr) > bRhr * 1.1 ? 30 : 55) : 90;
  breakdown.push({ factor: 'Elevated resting HR', weight: 0.20, rawValue: record.restingHr, normalizedScore: rhrNorm, impact: rhrNorm >= 70 ? 'positive' : rhrNorm >= 50 ? 'neutral' : 'negative' });

  const sleepDebt = safe(record.sleepDurationMinutes, 420) < 390;
  const sleepNorm = sleepDebt ? (safe(record.sleepDurationMinutes, 420) < 330 ? 25 : 50) : 90;
  breakdown.push({ factor: 'Sleep debt', weight: 0.20, rawValue: record.sleepDurationMinutes, normalizedScore: sleepNorm, impact: sleepNorm >= 70 ? 'positive' : sleepNorm >= 50 ? 'neutral' : 'negative' });

  const stress = safe(record.stressScoreSubjective, 5);
  const stressNorm = clamp(100 - stress * 10, 0, 100);
  breakdown.push({ factor: 'Subjective stress', weight: 0.15, rawValue: record.stressScoreSubjective, normalizedScore: stressNorm, impact: stressNorm >= 70 ? 'positive' : stressNorm >= 50 ? 'neutral' : 'negative' });

  const caff = safe(record.caffeineMg, 150);
  const caffNorm = clamp(caff <= 200 ? 90 : caff <= 300 ? 70 : caff <= 400 ? 50 : 30, 0, 100);
  breakdown.push({ factor: 'Caffeine load', weight: 0.05, rawValue: record.caffeineMg, normalizedScore: caffNorm, impact: caffNorm >= 70 ? 'positive' : caffNorm >= 50 ? 'neutral' : 'negative' });

  const symptomCount = record.symptomFlags.length;
  const symNorm = clamp(100 - symptomCount * 20, 0, 100);
  breakdown.push({ factor: 'Symptom burden', weight: 0.10, rawValue: symptomCount, normalizedScore: symNorm, impact: symNorm >= 70 ? 'positive' : symNorm >= 50 ? 'neutral' : 'negative' });

  const movement = safe(record.activeMinutes, 30);
  const load = safe(record.trainingLoad, 0);
  const moveNorm = movement >= 20 && movement <= 90 && load < 180 ? 85 : (movement < 10 || load > 200) ? 40 : 65;
  breakdown.push({ factor: 'Movement balance', weight: 0.05, rawValue: movement, normalizedScore: moveNorm, impact: moveNorm >= 70 ? 'positive' : moveNorm >= 50 ? 'neutral' : 'negative' });

  const score = Math.round(breakdown.reduce((sum, b) => sum + b.normalizedScore * b.weight, 0));
  const status = statusFromScore(score);
  return { score, status, label: status === 'green' ? 'Low Stress' : status === 'yellow' ? 'Moderate Stress' : 'High Stress', breakdown };
}

export function computeMetabolicResilienceScore(
  record: DailyBiometricRecord,
  meals: MealLogEntry[]
): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];

  const todayMeals = meals.filter(m => m.date === record.date);
  const mealTimes = todayMeals.map(m => parseInt(m.mealTime.split(':')[0]));
  const timingConsistent = mealTimes.length >= 2;
  const timingNorm = timingConsistent ? 80 : 50;
  breakdown.push({ factor: 'Meal timing consistency', weight: 0.20, rawValue: todayMeals.length, normalizedScore: timingNorm, impact: timingNorm >= 70 ? 'positive' : 'neutral' });

  const totalProtein = todayMeals.reduce((s, m) => s + m.proteinG, 0);
  const proteinNorm = clamp(totalProtein >= 120 ? 100 : totalProtein >= 90 ? 80 : totalProtein >= 60 ? 60 : 35, 0, 100);
  breakdown.push({ factor: 'Protein sufficiency', weight: 0.20, rawValue: totalProtein, normalizedScore: proteinNorm, impact: proteinNorm >= 70 ? 'positive' : proteinNorm >= 50 ? 'neutral' : 'negative' });

  const active = safe(record.activeMinutes, 30);
  const actNorm = clamp(active >= 30 ? 90 : active >= 15 ? 70 : 40, 0, 100);
  breakdown.push({ factor: 'Activity / post-meal movement', weight: 0.15, rawValue: active, normalizedScore: actNorm, impact: actNorm >= 70 ? 'positive' : actNorm >= 50 ? 'neutral' : 'negative' });

  const sleepEff = safe(record.sleepEfficiency, 85);
  const sleepNorm = clamp(sleepEff >= 85 ? 90 : sleepEff >= 75 ? 65 : 40, 0, 100);
  breakdown.push({ factor: 'Sleep quality', weight: 0.15, rawValue: sleepEff, normalizedScore: sleepNorm, impact: sleepNorm >= 70 ? 'positive' : sleepNorm >= 50 ? 'neutral' : 'negative' });

  const energy = safe(record.energyScore, 6);
  const energyNorm = clamp(energy / 10 * 100, 0, 100);
  breakdown.push({ factor: 'Energy stability', weight: 0.10, rawValue: energy, normalizedScore: energyNorm, impact: energyNorm >= 70 ? 'positive' : energyNorm >= 50 ? 'neutral' : 'negative' });

  const cravings = safe(record.cravingsScore, 4);
  const cravNorm = clamp(100 - cravings * 12, 0, 100);
  breakdown.push({ factor: 'Cravings stability', weight: 0.10, rawValue: cravings, normalizedScore: cravNorm, impact: cravNorm >= 70 ? 'positive' : cravNorm >= 50 ? 'neutral' : 'negative' });

  const glucose = safe(record.glucoseAvg, 92);
  const glucNorm = clamp(glucose >= 70 && glucose <= 100 ? 95 : glucose <= 110 ? 70 : 40, 0, 100);
  breakdown.push({ factor: 'Glucose (if available)', weight: 0.10, rawValue: record.glucoseAvg, normalizedScore: glucNorm, impact: glucNorm >= 70 ? 'positive' : glucNorm >= 50 ? 'neutral' : 'negative' });

  const score = Math.round(breakdown.reduce((sum, b) => sum + b.normalizedScore * b.weight, 0));
  const status = statusFromScore(score);
  return { score, status, label: labelFromStatus(status), breakdown };
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

  const hydration = safe(record.hydrationMl, 1500);
  const hydNorm = clamp(hydration >= 2500 ? 100 : hydration >= 2000 ? 85 : hydration >= 1500 ? 60 : 30, 0, 100);
  breakdown.push({ factor: 'Hydration target', weight: 0.20, rawValue: hydration, normalizedScore: hydNorm, impact: hydNorm >= 70 ? 'positive' : hydNorm >= 50 ? 'neutral' : 'negative' });

  const todayMeals = meals.filter(m => m.date === record.date);
  const mealsLogged = todayMeals.length >= 3;
  const totalProt = todayMeals.reduce((s, m) => s + m.proteinG, 0);
  const mealNorm = mealsLogged && totalProt >= 90 ? 90 : mealsLogged ? 70 : 40;
  breakdown.push({ factor: 'Meals / protein target', weight: 0.20, rawValue: totalProt, normalizedScore: mealNorm, impact: mealNorm >= 70 ? 'positive' : mealNorm >= 50 ? 'neutral' : 'negative' });

  const bedtime = record.bedtime;
  const bedHour = bedtime ? parseInt(bedtime.split(':')[0]) + parseInt(bedtime.split(':')[1]) / 60 : 23;
  const bedNorm = bedHour <= 22.5 ? 95 : bedHour <= 23 ? 75 : bedHour <= 23.5 ? 55 : 30;
  breakdown.push({ factor: 'Bedtime target', weight: 0.10, rawValue: bedHour, normalizedScore: bedNorm, impact: bedNorm >= 70 ? 'positive' : bedNorm >= 50 ? 'neutral' : 'negative' });

  const workout = safe(record.workoutMinutes, 0);
  const steps = safe(record.steps, 5000);
  const moveNorm = (workout > 0 || steps >= 7000) ? 90 : steps >= 5000 ? 65 : 35;
  breakdown.push({ factor: 'Workout / movement goal', weight: 0.10, rawValue: steps, normalizedScore: moveNorm, impact: moveNorm >= 70 ? 'positive' : moveNorm >= 50 ? 'neutral' : 'negative' });

  const checkinNorm = record.energyScore !== null && record.moodScore !== null ? 90 : 40;
  breakdown.push({ factor: 'Check-in completed', weight: 0.10, rawValue: checkinNorm, normalizedScore: checkinNorm, impact: checkinNorm >= 70 ? 'positive' : 'negative' });

  const score = Math.round(breakdown.reduce((sum, b) => sum + b.normalizedScore * b.weight, 0));
  const status = statusFromScore(score);
  return { score, status, label: labelFromStatus(status), breakdown };
}

export function computeNervousSystemBalance(
  record: DailyBiometricRecord,
  recentRecords: DailyBiometricRecord[],
  baseline: UserBaseline | null
): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];
  const bHrv = baseline?.hrv14Day ?? 50;

  const hrvTrend = recentRecords.slice(0, 7).map(r => r.hrv ?? bHrv);
  const hrvAvg = hrvTrend.reduce((a, b) => a + b, 0) / hrvTrend.length;
  const hrvTrendNorm = clamp(hrvAvg >= bHrv ? 95 : hrvAvg >= bHrv * 0.9 ? 70 : 40, 0, 100);
  breakdown.push({ factor: 'HRV trend', weight: 0.25, rawValue: hrvAvg, normalizedScore: hrvTrendNorm, impact: hrvTrendNorm >= 70 ? 'positive' : hrvTrendNorm >= 50 ? 'neutral' : 'negative' });

  const sleepTrend = recentRecords.slice(0, 7).map(r => r.sleepScore ?? 75);
  const sleepAvg = sleepTrend.reduce((a, b) => a + b, 0) / sleepTrend.length;
  const sleepNorm = clamp(sleepAvg >= 80 ? 95 : sleepAvg >= 70 ? 70 : 45, 0, 100);
  breakdown.push({ factor: 'Sleep trend', weight: 0.20, rawValue: sleepAvg, normalizedScore: sleepNorm, impact: sleepNorm >= 70 ? 'positive' : sleepNorm >= 50 ? 'neutral' : 'negative' });

  const stress = safe(record.stressScoreSubjective, 5);
  const stressNorm = clamp(100 - stress * 12, 0, 100);
  breakdown.push({ factor: 'Stress score', weight: 0.15, rawValue: stress, normalizedScore: stressNorm, impact: stressNorm >= 70 ? 'positive' : stressNorm >= 50 ? 'neutral' : 'negative' });

  const hasBreathwork = record.symptomFlags.includes('breathwork') || record.symptomFlags.includes('meditation');
  const bwNorm = hasBreathwork ? 95 : 50;
  breakdown.push({ factor: 'Breathwork / meditation', weight: 0.10, rawValue: hasBreathwork ? 1 : 0, normalizedScore: bwNorm, impact: bwNorm >= 70 ? 'positive' : 'neutral' });

  const symptomBurden = record.symptomFlags.length;
  const symNorm = clamp(100 - symptomBurden * 18, 0, 100);
  breakdown.push({ factor: 'Symptom trends', weight: 0.10, rawValue: symptomBurden, normalizedScore: symNorm, impact: symNorm >= 70 ? 'positive' : symNorm >= 50 ? 'neutral' : 'negative' });

  const cycleAdj = record.cyclePhase === 'luteal' ? -8 : record.cyclePhase === 'follicular' ? 5 : 0;
  const cycleNorm = clamp(75 + cycleAdj, 0, 100);
  breakdown.push({ factor: 'Cycle phase', weight: 0.10, rawValue: cycleAdj, normalizedScore: cycleNorm, impact: cycleAdj >= 0 ? 'positive' : 'neutral' });

  const energy = safe(record.energyScore, 6);
  const energyStab = clamp(energy / 10 * 100, 0, 100);
  breakdown.push({ factor: 'Energy stability', weight: 0.10, rawValue: energy, normalizedScore: energyStab, impact: energyStab >= 70 ? 'positive' : energyStab >= 50 ? 'neutral' : 'negative' });

  const score = Math.round(breakdown.reduce((sum, b) => sum + b.normalizedScore * b.weight, 0));
  const status = statusFromScore(score);
  return { score, status, label: labelFromStatus(status), breakdown };
}

export function computeInflammationStrainScore(
  record: DailyBiometricRecord,
  recentRecords: DailyBiometricRecord[],
  baseline: UserBaseline | null
): ScoreResult {
  const breakdown: ScoreBreakdownItem[] = [];
  const bRhr = baseline?.restingHr14Day ?? 60;

  const sleepDebt = recentRecords.slice(0, 7).filter(r => (r.sleepDurationMinutes ?? 420) < 360).length;
  const sleepDebtNorm = clamp(100 - sleepDebt * 20, 0, 100);
  breakdown.push({ factor: 'Sleep debt', weight: 0.15, rawValue: sleepDebt, normalizedScore: sleepDebtNorm, impact: sleepDebtNorm >= 70 ? 'positive' : sleepDebtNorm >= 50 ? 'neutral' : 'negative' });

  const rhrElev = safe(record.restingHr, bRhr) - bRhr;
  const rhrNorm = clamp(100 - rhrElev * 10, 0, 100);
  breakdown.push({ factor: 'Elevated resting HR', weight: 0.15, rawValue: record.restingHr, normalizedScore: rhrNorm, impact: rhrNorm >= 70 ? 'positive' : rhrNorm >= 50 ? 'neutral' : 'negative' });

  const resp = safe(record.respiratoryRate, 15.5);
  const respNorm = clamp(100 - Math.abs(resp - 15.5) * 20, 0, 100);
  breakdown.push({ factor: 'Respiratory rate deviation', weight: 0.10, rawValue: resp, normalizedScore: respNorm, impact: respNorm >= 70 ? 'positive' : respNorm >= 50 ? 'neutral' : 'negative' });

  const temp = safe(record.tempDeviation, 0);
  const tempNorm = clamp(100 - Math.abs(temp) * 100, 0, 100);
  breakdown.push({ factor: 'Temp deviation', weight: 0.10, rawValue: temp, normalizedScore: tempNorm, impact: tempNorm >= 70 ? 'positive' : tempNorm >= 50 ? 'neutral' : 'negative' });

  const soreness = safe(record.sorenessScore, 3);
  const soreNorm = clamp(100 - soreness * 12, 0, 100);
  breakdown.push({ factor: 'Soreness', weight: 0.10, rawValue: soreness, normalizedScore: soreNorm, impact: soreNorm >= 70 ? 'positive' : soreNorm >= 50 ? 'neutral' : 'negative' });

  const load = safe(record.trainingLoad, 0);
  const loadNorm = clamp(load <= 100 ? 90 : load <= 150 ? 70 : load <= 200 ? 50 : 30, 0, 100);
  breakdown.push({ factor: 'Training load', weight: 0.10, rawValue: load, normalizedScore: loadNorm, impact: loadNorm >= 70 ? 'positive' : loadNorm >= 50 ? 'neutral' : 'negative' });

  const readiness = safe(record.readinessScore, 75);
  const readNorm = clamp(readiness, 0, 100);
  breakdown.push({ factor: 'Low recovery', weight: 0.10, rawValue: readiness, normalizedScore: readNorm, impact: readNorm >= 70 ? 'positive' : readNorm >= 50 ? 'neutral' : 'negative' });

  const alcohol = safe(record.alcoholUnits, 0);
  const alcNorm = clamp(100 - alcohol * 25, 0, 100);
  breakdown.push({ factor: 'Alcohol intake', weight: 0.10, rawValue: alcohol, normalizedScore: alcNorm, impact: alcNorm >= 70 ? 'positive' : alcNorm >= 50 ? 'neutral' : 'negative' });

  const nutQual = 70;
  breakdown.push({ factor: 'Nutrition patterns', weight: 0.10, rawValue: null, normalizedScore: nutQual, impact: 'neutral' });

  const score = Math.round(breakdown.reduce((sum, b) => sum + b.normalizedScore * b.weight, 0));
  const status = statusFromScore(score);
  return { score, status, label: status === 'green' ? 'Low Inflammation' : status === 'yellow' ? 'Moderate Strain' : 'High Strain', breakdown };
}
