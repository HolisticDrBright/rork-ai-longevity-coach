import { DailyBiometricRecord, MealLogEntry, SupplementLogEntry, SymptomLogEntry, UserBaseline, WearableConnection, InsightMessage } from '@/types/wearables';

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

function randBetween(min: number, max: number): number {
  return Math.round((Math.random() * (max - min) + min) * 10) / 10;
}

export function generateMockRecords(days: number = 30): DailyBiometricRecord[] {
  const records: DailyBiometricRecord[] = [];
  for (let i = 0; i < days; i++) {
    const dayVariance = Math.sin(i * 0.3) * 0.15;
    const weekendEffect = (i % 7 === 0 || i % 7 === 6) ? 0.1 : 0;
    const baseHrv = 52 + dayVariance * 20;
    const baseRhr = 58 - dayVariance * 8;
    const hadAlcohol = i % 7 === 0 || i % 7 === 6 ? Math.random() > 0.5 : Math.random() > 0.85;
    const lateMeal = Math.random() > 0.7;
    const sleepPenalty = (hadAlcohol ? -12 : 0) + (lateMeal ? -5 : 0);
    const cycleDayVal = i % 28;
    const isLuteal = cycleDayVal >= 14 && cycleDayVal <= 28;

    records.push({
      id: `bio_${i}`,
      userId: 'user_1',
      source: i % 3 === 0 ? 'oura' : 'apple_health',
      date: dateStr(i),
      sleepDurationMinutes: Math.round(randBetween(360, 510) + sleepPenalty),
      sleepEfficiency: Math.round(randBetween(78, 96) + sleepPenalty * 0.3),
      deepSleepMinutes: Math.round(randBetween(45, 105) + sleepPenalty * 0.2),
      remSleepMinutes: Math.round(randBetween(60, 120) + sleepPenalty * 0.15),
      lightSleepMinutes: Math.round(randBetween(120, 200)),
      sleepLatencyMinutes: Math.round(randBetween(5, 25) + (hadAlcohol ? 5 : 0)),
      wakeAfterSleepOnset: Math.round(randBetween(5, 35) + (hadAlcohol ? 10 : 0)),
      awakenings: Math.round(randBetween(1, 6) + (hadAlcohol ? 2 : 0)),
      sleepScore: Math.round(randBetween(65, 92) + sleepPenalty * 0.4),
      bedtime: `${Math.random() > 0.5 ? '22' : '23'}:${Math.round(Math.random() * 59).toString().padStart(2, '0')}`,
      wakeTime: `${Math.random() > 0.5 ? '06' : '07'}:${Math.round(Math.random() * 59).toString().padStart(2, '0')}`,
      hrv: Math.round(baseHrv + randBetween(-8, 8) + (hadAlcohol ? -12 : 0) + (isLuteal ? -4 : 0)),
      restingHr: Math.round(baseRhr + randBetween(-3, 3) + (hadAlcohol ? 4 : 0)),
      avgHr: Math.round(randBetween(68, 82)),
      nighttimeHr: Math.round(baseRhr - 3 + randBetween(-2, 2)),
      respiratoryRate: randBetween(14.5, 17.5),
      tempDeviation: randBetween(-0.3, 0.4) + (isLuteal ? 0.2 : 0),
      skinTemp: null,
      readinessScore: Math.round(randBetween(60, 92) + sleepPenalty * 0.3),
      stressScoreDevice: Math.round(randBetween(20, 70)),
      steps: Math.round(randBetween(4000, 14000) - weekendEffect * 2000),
      distanceKm: randBetween(2.5, 10),
      caloriesBurned: Math.round(randBetween(1800, 2800)),
      activeMinutes: Math.round(randBetween(20, 90)),
      sedentaryMinutes: Math.round(randBetween(400, 700)),
      vo2Max: randBetween(38, 48),
      workoutMinutes: i % 2 === 0 ? Math.round(randBetween(30, 75)) : 0,
      workoutType: i % 2 === 0 ? ['strength', 'HIIT', 'zone_2', 'yoga'][i % 4] : null,
      trainingLoad: i % 2 === 0 ? Math.round(randBetween(50, 200)) : 0,
      strainScore: Math.round(randBetween(4, 16)),
      weight: randBetween(72, 74),
      bodyFatPercent: randBetween(16, 19),
      spo2: randBetween(95, 99),
      glucoseAvg: randBetween(82, 105),
      bloodPressureSystolic: null,
      bloodPressureDiastolic: null,
      cyclePhase: cycleDayVal < 5 ? 'menstrual' : cycleDayVal < 13 ? 'follicular' : cycleDayVal < 16 ? 'ovulatory' : 'luteal',
      cycleDayEstimate: cycleDayVal,
      hydrationMl: Math.round(randBetween(1200, 3200)),
      alcoholUnits: hadAlcohol ? Math.round(randBetween(1, 4)) : 0,
      caffeineMg: Math.round(randBetween(80, 350)),
      caffeineLastTime: Math.random() > 0.4 ? `${Math.round(randBetween(14, 18))}:00` : '10:00',
      energyScore: Math.round(randBetween(4, 9) + sleepPenalty * 0.05),
      stressScoreSubjective: Math.round(randBetween(2, 8)),
      sorenessScore: i % 2 === 0 ? Math.round(randBetween(2, 7)) : Math.round(randBetween(1, 4)),
      moodScore: Math.round(randBetween(5, 9) + sleepPenalty * 0.04),
      libidoScore: null,
      bowelScore: Math.round(randBetween(3, 5)),
      cravingsScore: Math.round(randBetween(2, 7) + (isLuteal ? 2 : 0)),
      adherenceScore: Math.round(randBetween(60, 95)),
      subjectiveReadiness: Math.round(randBetween(4, 9)),
      symptomFlags: hadAlcohol ? ['poor_sleep', 'dehydration'] : (isLuteal ? ['cravings', 'fatigue'] : []),
      dataQualityScore: Math.round(randBetween(70, 98)),
    });
  }
  return records;
}

export function generateMockBaseline(records: DailyBiometricRecord[]): UserBaseline {
  const avg = (arr: (number | null)[]): number | null => {
    const valid = arr.filter((v): v is number => v !== null);
    return valid.length > 0 ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : null;
  };

  const slice7 = records.slice(0, 7);
  const slice14 = records.slice(0, 14);
  const slice30 = records.slice(0, 30);

  return {
    userId: 'user_1',
    updatedAt: new Date().toISOString(),
    hrv7Day: avg(slice7.map(r => r.hrv)),
    hrv14Day: avg(slice14.map(r => r.hrv)),
    hrv30Day: avg(slice30.map(r => r.hrv)),
    restingHr7Day: avg(slice7.map(r => r.restingHr)),
    restingHr14Day: avg(slice14.map(r => r.restingHr)),
    restingHr30Day: avg(slice30.map(r => r.restingHr)),
    sleepDuration7Day: avg(slice7.map(r => r.sleepDurationMinutes)),
    sleepDuration14Day: avg(slice14.map(r => r.sleepDurationMinutes)),
    sleepDuration30Day: avg(slice30.map(r => r.sleepDurationMinutes)),
    sleepEfficiency7Day: avg(slice7.map(r => r.sleepEfficiency)),
    sleepEfficiency14Day: avg(slice14.map(r => r.sleepEfficiency)),
    sleepEfficiency30Day: avg(slice30.map(r => r.sleepEfficiency)),
    steps7Day: avg(slice7.map(r => r.steps)),
    steps14Day: avg(slice14.map(r => r.steps)),
    steps30Day: avg(slice30.map(r => r.steps)),
    respiratoryRate7Day: avg(slice7.map(r => r.respiratoryRate)),
    respiratoryRate14Day: avg(slice14.map(r => r.respiratoryRate)),
    tempDeviation7Day: avg(slice7.map(r => r.tempDeviation)),
    tempDeviation14Day: avg(slice14.map(r => r.tempDeviation)),
    bedtimeAvg: '22:30',
    wakeTimeAvg: '06:45',
    weight7Day: avg(slice7.map(r => r.weight)),
    weight30Day: avg(slice30.map(r => r.weight)),
  };
}

export function generateMockMealLogs(days: number = 7): MealLogEntry[] {
  const meals: MealLogEntry[] = [];
  const mealTypes: ('breakfast' | 'lunch' | 'dinner' | 'snack')[] = ['breakfast', 'lunch', 'dinner', 'snack'];
  for (let d = 0; d < days; d++) {
    for (const mt of mealTypes) {
      const time = mt === 'breakfast' ? '07:30' : mt === 'lunch' ? '12:30' : mt === 'dinner' ? '19:00' : '15:30';
      const isHighProtein = mt === 'breakfast' && d % 3 === 0;
      meals.push({
        id: `meal_${d}_${mt}`,
        userId: 'user_1',
        date: dateStr(d),
        mealTime: time,
        mealType: mt,
        proteinG: isHighProtein ? Math.round(randBetween(35, 50)) : Math.round(randBetween(15, 35)),
        carbsG: Math.round(randBetween(20, 60)),
        fatG: Math.round(randBetween(10, 30)),
        fiberG: Math.round(randBetween(3, 12)),
        calories: Math.round(randBetween(300, 700)),
        foodQualityScore: Math.round(randBetween(5, 9)),
        tags: mt === 'dinner' && d % 3 === 0 ? ['late_meal'] : [],
        glycemicLoadEstimate: Math.random() > 0.6 ? 'medium' : 'low',
        inflammatoryLoadEstimate: Math.random() > 0.8 ? 'medium' : 'low',
      });
    }
  }
  return meals;
}

export function generateMockSupplementLogs(days: number = 7): SupplementLogEntry[] {
  const supplements = [
    { name: 'Magnesium Glycinate', category: 'sleep', timing: 'before_bed' as const, goal: 'sleep_quality' },
    { name: 'Vitamin D3', category: 'immune', timing: 'morning' as const, goal: 'immune_support' },
    { name: 'Omega-3 Fish Oil', category: 'inflammation', timing: 'morning' as const, goal: 'inflammation_reduction' },
    { name: 'NAD+ Patches', category: 'mitochondrial', timing: 'morning' as const, goal: 'energy_mitochondria' },
    { name: 'Ashwagandha', category: 'stress', timing: 'evening' as const, goal: 'stress_resilience' },
    { name: 'Electrolytes', category: 'hydration', timing: 'morning' as const, goal: 'hydration' },
  ];

  const logs: SupplementLogEntry[] = [];
  for (let d = 0; d < days; d++) {
    for (const s of supplements) {
      logs.push({
        id: `supp_${d}_${s.name}`,
        userId: 'user_1',
        date: dateStr(d),
        supplementName: s.name,
        category: s.category,
        dose: '1 serving',
        timing: s.timing,
        adherence: Math.random() > 0.15,
        associatedGoal: s.goal,
      });
    }
  }
  return logs;
}

export function generateMockSymptomLogs(days: number = 14): SymptomLogEntry[] {
  const symptoms = ['fatigue', 'brain_fog', 'joint_stiffness', 'bloating', 'headache', 'anxiety'];
  const logs: SymptomLogEntry[] = [];
  for (let d = 0; d < days; d++) {
    if (Math.random() > 0.5) {
      const symptom = symptoms[Math.floor(Math.random() * symptoms.length)];
      logs.push({
        id: `sym_${d}`,
        userId: 'user_1',
        date: dateStr(d),
        symptom,
        severity: Math.round(randBetween(2, 7)),
        onset: 'gradual',
        notes: '',
      });
    }
  }
  return logs;
}

export const mockConnections: WearableConnection[] = [
  { id: 'conn_1', source: 'apple_health', connected: true, lastSync: new Date().toISOString(), permissions: ['sleep', 'heart_rate', 'steps', 'workouts'] },
  { id: 'conn_2', source: 'oura', connected: true, lastSync: new Date().toISOString(), permissions: ['sleep', 'readiness', 'activity'] },
  { id: 'conn_3', source: 'google_health', connected: false, lastSync: null, permissions: [] },
  { id: 'conn_4', source: 'whoop', connected: false, lastSync: null, permissions: [] },
  { id: 'conn_5', source: 'fitbit', connected: false, lastSync: null, permissions: [] },
  { id: 'conn_6', source: 'garmin', connected: false, lastSync: null, permissions: [] },
];

export function generateMockInsights(records: DailyBiometricRecord[]): InsightMessage[] {
  const today = records[0];
  const insights: InsightMessage[] = [];

  if (today) {
    const recentAlcoholDays = records.slice(0, 7).filter(r => (r.alcoholUnits ?? 0) > 0).length;
    if (recentAlcoholDays >= 2) {
      insights.push({
        id: 'ins_alcohol_sleep',
        date: today.date,
        type: 'correlation',
        title: 'Alcohol appears to reduce your sleep quality',
        body: `On nights with alcohol, your sleep efficiency drops by an average of 8% and HRV decreases. This pattern has been consistent over the past ${recentAlcoholDays} days with alcohol.`,
        confidence: 'high',
        relatedFactors: ['alcohol', 'sleep_efficiency', 'hrv'],
        actionSuggestion: 'Consider reducing alcohol, especially within 3 hours of bedtime.',
        priority: 2,
      });
    }

    const lateMealDays = records.slice(0, 7).filter(r => r.symptomFlags.includes('late_meal')).length;
    if (lateMealDays >= 2) {
      insights.push({
        id: 'ins_late_meal',
        date: today.date,
        type: 'correlation',
        title: 'Late meals may be affecting your sleep',
        body: 'When you eat dinner after 8:30 PM, your sleep latency increases and deep sleep duration tends to decrease.',
        confidence: 'moderate',
        relatedFactors: ['meal_timing', 'sleep_latency', 'deep_sleep'],
        actionSuggestion: 'Try finishing your last meal at least 3 hours before bedtime.',
        priority: 3,
      });
    }

    if ((today.hrv ?? 60) < 45) {
      insights.push({
        id: 'ins_low_hrv',
        date: today.date,
        type: 'warning',
        title: 'HRV is below your baseline',
        body: 'Your heart rate variability has been trending below your 14-day average. This often indicates accumulated stress or under-recovery.',
        confidence: 'high',
        relatedFactors: ['hrv', 'recovery', 'stress'],
        actionSuggestion: 'Prioritize recovery today: zone 2 cardio, extra sleep, hydration.',
        priority: 1,
      });
    }

    const adherenceRecent = records.slice(0, 7).map(r => r.adherenceScore ?? 0);
    const avgAdherence = adherenceRecent.reduce((a, b) => a + b, 0) / adherenceRecent.length;
    if (avgAdherence > 80) {
      insights.push({
        id: 'ins_adherence_positive',
        date: today.date,
        type: 'positive',
        title: 'Great supplement adherence this week',
        body: `Your supplement adherence is ${Math.round(avgAdherence)}% this week. Consistent supplementation correlates with your improved sleep scores.`,
        confidence: 'moderate',
        relatedFactors: ['adherence', 'supplements', 'sleep'],
        actionSuggestion: 'Keep it up! Consistency is the key to long-term results.',
        priority: 5,
      });
    }

    if (today.cyclePhase === 'luteal' && (today.cravingsScore ?? 0) > 5) {
      insights.push({
        id: 'ins_cycle_luteal',
        date: today.date,
        type: 'observation',
        title: 'Luteal phase: recovery and cravings adjustment',
        body: 'During your luteal phase, recovery tends to decrease and cravings increase. This is a normal hormonal pattern.',
        confidence: 'high',
        relatedFactors: ['cycle_phase', 'cravings', 'recovery'],
        actionSuggestion: 'Allow more strategic carbs, reduce fasting intensity, prioritize magnesium.',
        priority: 3,
      });
    }

    const highProteinDays = records.slice(0, 14).filter((_, idx) => idx % 3 === 0);
    if (highProteinDays.length > 2) {
      insights.push({
        id: 'ins_protein_energy',
        date: today.date,
        type: 'correlation',
        title: 'Higher protein breakfasts linked to stable energy',
        body: 'After mornings with higher protein intake (35g+), your energy scores tend to be more stable throughout the day.',
        confidence: 'moderate',
        relatedFactors: ['protein', 'breakfast', 'energy'],
        actionSuggestion: 'Front-load protein at breakfast for more stable energy throughout the day.',
        priority: 4,
      });
    }

    const lowRecoveryStreak = records.slice(0, 7).filter(r => (r.readinessScore ?? 80) < 65).length;
    if (lowRecoveryStreak >= 3) {
      insights.push({
        id: 'ins_recovery_suppressed',
        date: today.date,
        type: 'escalation',
        title: 'Recovery suppressed for multiple days',
        body: `Your readiness score has been below 65 for ${lowRecoveryStreak} of the last 7 days. This persistent pattern may warrant review of your training load, sleep habits, or stress levels.`,
        confidence: 'high',
        relatedFactors: ['readiness', 'recovery', 'training_load'],
        actionSuggestion: 'Consider reviewing stress load, illness risk, or labs with your practitioner.',
        priority: 1,
      });
    }
  }

  return insights.sort((a, b) => a.priority - b.priority);
}
