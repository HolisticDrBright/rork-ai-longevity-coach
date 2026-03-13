import { DailyBiometricRecord, WearableSource } from '@/types/wearables';

export interface RawHealthEvent {
  id: string;
  userId: string;
  provider: WearableSource;
  recordType: string;
  payload: Record<string, unknown>;
  recordedAt: string;
  importedAt: string;
}

export interface ProviderFieldMapping {
  provider: WearableSource;
  fieldMappings: Record<string, string>;
  sleepScoreField?: string;
  readinessScoreField?: string;
  stressScoreField?: string;
}

const OURA_MAPPING: ProviderFieldMapping = {
  provider: 'oura',
  fieldMappings: {
    'average_hrv': 'hrv',
    'resting_heart_rate': 'restingHr',
    'average_heart_rate': 'avgHr',
    'lowest_heart_rate': 'nighttimeHr',
    'total_sleep_duration': 'sleepDurationMinutes',
    'deep_sleep_duration': 'deepSleepMinutes',
    'rem_sleep_duration': 'remSleepMinutes',
    'light_sleep_duration': 'lightSleepMinutes',
    'sleep_efficiency': 'sleepEfficiency',
    'sleep_latency': 'sleepLatencyMinutes',
    'awakenings': 'awakenings',
    'bedtime_start': 'bedtime',
    'bedtime_end': 'wakeTime',
    'body_temperature_deviation': 'tempDeviation',
    'average_breath': 'respiratoryRate',
    'steps': 'steps',
    'total_calories': 'caloriesBurned',
    'active_calories': 'caloriesBurned',
    'medium_activity_minutes': 'activeMinutes',
    'spo2': 'spo2',
  },
  sleepScoreField: 'sleep_score',
  readinessScoreField: 'readiness_score',
  stressScoreField: 'stress_score',
};

const APPLE_HEALTH_MAPPING: ProviderFieldMapping = {
  provider: 'apple_health',
  fieldMappings: {
    'HKQuantityTypeIdentifierHeartRateVariabilitySDNN': 'hrv',
    'HKQuantityTypeIdentifierRestingHeartRate': 'restingHr',
    'HKQuantityTypeIdentifierHeartRate': 'avgHr',
    'HKCategoryTypeIdentifierSleepAnalysis_duration': 'sleepDurationMinutes',
    'HKQuantityTypeIdentifierStepCount': 'steps',
    'HKQuantityTypeIdentifierDistanceWalkingRunning': 'distanceKm',
    'HKQuantityTypeIdentifierActiveEnergyBurned': 'caloriesBurned',
    'HKQuantityTypeIdentifierAppleExerciseTime': 'activeMinutes',
    'HKQuantityTypeIdentifierBodyMass': 'weight',
    'HKQuantityTypeIdentifierBodyFatPercentage': 'bodyFatPercent',
    'HKQuantityTypeIdentifierOxygenSaturation': 'spo2',
    'HKQuantityTypeIdentifierRespiratoryRate': 'respiratoryRate',
    'HKQuantityTypeIdentifierVO2Max': 'vo2Max',
    'HKQuantityTypeIdentifierBloodPressureSystolic': 'bloodPressureSystolic',
    'HKQuantityTypeIdentifierBloodPressureDiastolic': 'bloodPressureDiastolic',
    'HKQuantityTypeIdentifierBloodGlucose': 'glucoseAvg',
  },
};

const GOOGLE_HEALTH_MAPPING: ProviderFieldMapping = {
  provider: 'google_health',
  fieldMappings: {
    'HeartRateVariabilityRmssd': 'hrv',
    'RestingHeartRate': 'restingHr',
    'HeartRate': 'avgHr',
    'SleepSession_duration': 'sleepDurationMinutes',
    'Steps': 'steps',
    'Distance': 'distanceKm',
    'ActiveCaloriesBurned': 'caloriesBurned',
    'ExerciseSession_duration': 'activeMinutes',
    'Weight': 'weight',
    'BodyFat': 'bodyFatPercent',
    'OxygenSaturation': 'spo2',
    'RespiratoryRate': 'respiratoryRate',
    'BloodPressure_systolic': 'bloodPressureSystolic',
    'BloodPressure_diastolic': 'bloodPressureDiastolic',
    'BloodGlucose': 'glucoseAvg',
  },
};

const WHOOP_MAPPING: ProviderFieldMapping = {
  provider: 'whoop',
  fieldMappings: {
    'hrv_rmssd': 'hrv',
    'resting_heart_rate': 'restingHr',
    'sleep_duration': 'sleepDurationMinutes',
    'sleep_efficiency': 'sleepEfficiency',
    'rem_sleep': 'remSleepMinutes',
    'sws_sleep': 'deepSleepMinutes',
    'light_sleep': 'lightSleepMinutes',
    'respiratory_rate': 'respiratoryRate',
    'skin_temp': 'skinTemp',
    'strain': 'strainScore',
    'calories': 'caloriesBurned',
    'spo2': 'spo2',
  },
  readinessScoreField: 'recovery_score',
  stressScoreField: 'stress_score',
};

const FITBIT_MAPPING: ProviderFieldMapping = {
  provider: 'fitbit',
  fieldMappings: {
    'hrv': 'hrv',
    'restingHeartRate': 'restingHr',
    'totalMinutesAsleep': 'sleepDurationMinutes',
    'efficiency': 'sleepEfficiency',
    'deepMinutes': 'deepSleepMinutes',
    'remMinutes': 'remSleepMinutes',
    'lightMinutes': 'lightSleepMinutes',
    'steps': 'steps',
    'distance': 'distanceKm',
    'caloriesOut': 'caloriesBurned',
    'veryActiveMinutes': 'activeMinutes',
    'sedentaryMinutes': 'sedentaryMinutes',
    'weight': 'weight',
    'fat': 'bodyFatPercent',
    'spo2': 'spo2',
    'breathingRate': 'respiratoryRate',
  },
  sleepScoreField: 'sleep_score',
};

const PROVIDER_MAPPINGS: Record<WearableSource, ProviderFieldMapping> = {
  oura: OURA_MAPPING,
  apple_health: APPLE_HEALTH_MAPPING,
  google_health: GOOGLE_HEALTH_MAPPING,
  whoop: WHOOP_MAPPING,
  fitbit: FITBIT_MAPPING,
  garmin: APPLE_HEALTH_MAPPING,
  manual: { provider: 'manual', fieldMappings: {} },
};

export interface SourcePrecedence {
  sleep: WearableSource[];
  hrv: WearableSource[];
  activity: WearableSource[];
  workouts: WearableSource[];
  body: WearableSource[];
}

export const DEFAULT_PRECEDENCE: SourcePrecedence = {
  sleep: ['oura', 'whoop', 'apple_health', 'fitbit', 'google_health', 'garmin'],
  hrv: ['oura', 'whoop', 'apple_health', 'fitbit', 'google_health', 'garmin'],
  activity: ['apple_health', 'google_health', 'garmin', 'fitbit', 'whoop', 'oura'],
  workouts: ['apple_health', 'google_health', 'garmin', 'whoop', 'oura', 'fitbit'],
  body: ['apple_health', 'google_health', 'fitbit', 'garmin', 'oura', 'whoop'],
};

export function getProviderMapping(source: WearableSource): ProviderFieldMapping {
  return PROVIDER_MAPPINGS[source] ?? PROVIDER_MAPPINGS.manual;
}

export function normalizeRawEvent(
  event: RawHealthEvent,
  existingRecord: Partial<DailyBiometricRecord>
): Partial<DailyBiometricRecord> {
  const mapping = getProviderMapping(event.provider);
  const normalized: Partial<DailyBiometricRecord> = { ...existingRecord };

  for (const [rawKey, canonicalKey] of Object.entries(mapping.fieldMappings)) {
    const rawValue = event.payload[rawKey];
    if (rawValue !== undefined && rawValue !== null) {
      (normalized as Record<string, unknown>)[canonicalKey] = rawValue;
    }
  }

  if (mapping.sleepScoreField && event.payload[mapping.sleepScoreField] != null) {
    normalized.sleepScore = event.payload[mapping.sleepScoreField] as number;
  }
  if (mapping.readinessScoreField && event.payload[mapping.readinessScoreField] != null) {
    normalized.readinessScore = event.payload[mapping.readinessScoreField] as number;
  }
  if (mapping.stressScoreField && event.payload[mapping.stressScoreField] != null) {
    normalized.stressScoreDevice = event.payload[mapping.stressScoreField] as number;
  }

  normalized.source = event.provider;

  return normalized;
}

export function resolveConflicts(
  records: Partial<DailyBiometricRecord>[],
  precedence: SourcePrecedence = DEFAULT_PRECEDENCE
): DailyBiometricRecord {
  const merged: Record<string, unknown> = {};

  const sleepFields = ['sleepDurationMinutes', 'sleepEfficiency', 'deepSleepMinutes', 'remSleepMinutes', 'lightSleepMinutes', 'sleepLatencyMinutes', 'wakeAfterSleepOnset', 'awakenings', 'sleepScore', 'bedtime', 'wakeTime'];
  const hrvFields = ['hrv', 'restingHr', 'nighttimeHr'];
  const activityFields = ['steps', 'distanceKm', 'caloriesBurned', 'activeMinutes', 'sedentaryMinutes'];
  const bodyFields = ['weight', 'bodyFatPercent', 'spo2', 'bloodPressureSystolic', 'bloodPressureDiastolic'];

  function pickBestValue(fieldName: string, fieldCategory: WearableSource[]) {
    for (const source of fieldCategory) {
      const record = records.find(r => r.source === source);
      if (record) {
        const val = (record as Record<string, unknown>)[fieldName];
        if (val !== undefined && val !== null) {
          return val;
        }
      }
    }
    for (const record of records) {
      const val = (record as Record<string, unknown>)[fieldName];
      if (val !== undefined && val !== null) return val;
    }
    return null;
  }

  for (const field of sleepFields) {
    merged[field] = pickBestValue(field, precedence.sleep);
  }
  for (const field of hrvFields) {
    merged[field] = pickBestValue(field, precedence.hrv);
  }
  for (const field of activityFields) {
    merged[field] = pickBestValue(field, precedence.activity);
  }
  for (const field of bodyFields) {
    merged[field] = pickBestValue(field, precedence.body);
  }

  for (const record of records) {
    for (const [key, val] of Object.entries(record)) {
      if (merged[key] === undefined || merged[key] === null) {
        merged[key] = val;
      }
    }
  }

  return merged as unknown as DailyBiometricRecord;
}

export function computeDataQualityScore(record: DailyBiometricRecord): number {
  const criticalFields: (keyof DailyBiometricRecord)[] = [
    'hrv', 'restingHr', 'sleepDurationMinutes', 'sleepEfficiency', 'steps',
  ];
  const importantFields: (keyof DailyBiometricRecord)[] = [
    'deepSleepMinutes', 'remSleepMinutes', 'respiratoryRate', 'tempDeviation',
    'activeMinutes', 'workoutMinutes',
  ];
  const supplementaryFields: (keyof DailyBiometricRecord)[] = [
    'energyScore', 'stressScoreSubjective', 'sorenessScore', 'moodScore',
    'hydrationMl', 'weight', 'spo2',
  ];

  let score = 0;
  const maxScore = criticalFields.length * 15 + importantFields.length * 8 + supplementaryFields.length * 3;

  for (const f of criticalFields) {
    if (record[f] !== null && record[f] !== undefined) score += 15;
  }
  for (const f of importantFields) {
    if (record[f] !== null && record[f] !== undefined) score += 8;
  }
  for (const f of supplementaryFields) {
    if (record[f] !== null && record[f] !== undefined) score += 3;
  }

  return Math.round((score / maxScore) * 100);
}
