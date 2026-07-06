import { DailyBiometricRecord, WearableSource } from '@/types/wearables';

/**
 * Capability registry — the single source of truth for the adaptive
 * wearable UI.
 *
 * Junction (Vital) exposes ~70 resource types, but what actually arrives
 * depends on the connected device: a Dexcom CGM only sends glucose, an
 * Omron cuff only blood pressure, while Oura/Whoop/Apple Health send broad
 * multi-metric streams. Screens must therefore never render per-provider
 * layouts; they render per-metric, driven by three availability states:
 *
 *   live      — data is present in recent daily records
 *   expected  — a connected provider supplies this metric, awaiting first sync
 *   locked    — no connected provider measures it (upsell/education state)
 */

export type MetricGroupKey =
  | 'recovery'
  | 'sleep'
  | 'activity'
  | 'metabolic'
  | 'cardiovascular'
  | 'respiratory'
  | 'body'
  | 'cycle';

export interface MetricGroup {
  key: MetricGroupKey;
  label: string;
  /** lucide-react-native icon name rendered by the screens */
  icon: string;
  description: string;
  /** Providers to suggest when the group is locked, in display order. */
  suggestedProviders: WearableSource[];
}

export interface MetricDefinition {
  key: string;
  /** Field(s) on DailyBiometricRecord that carry this metric. */
  fields: (keyof DailyBiometricRecord)[];
  label: string;
  shortLabel: string;
  unit: string;
  group: MetricGroupKey;
  /** true when a falling trend is an improvement (RHR, glucose, BP…). */
  lowerIsBetter?: boolean;
  /** Junction resource types that feed this metric. */
  junctionResources: string[];
}

export const METRIC_GROUPS: MetricGroup[] = [
  {
    key: 'recovery',
    label: 'Recovery',
    icon: 'HeartPulse',
    description: 'HRV, resting heart rate, and device readiness/strain.',
    suggestedProviders: ['oura', 'whoop', 'apple_health', 'garmin'],
  },
  {
    key: 'sleep',
    label: 'Sleep',
    icon: 'Moon',
    description: 'Duration, stages, efficiency, and bedtime consistency.',
    suggestedProviders: ['oura', 'whoop', 'apple_health', 'fitbit'],
  },
  {
    key: 'activity',
    label: 'Activity',
    icon: 'Footprints',
    description: 'Steps, workouts, calories, and cardio fitness.',
    suggestedProviders: ['apple_health', 'garmin', 'fitbit', 'whoop'],
  },
  {
    key: 'metabolic',
    label: 'Glucose & Metabolic',
    icon: 'Droplets',
    description: 'Continuous glucose, hydration, and caffeine load.',
    suggestedProviders: ['dexcom', 'freestyle_libre', 'apple_health'],
  },
  {
    key: 'cardiovascular',
    label: 'Blood Pressure & Heart',
    icon: 'Heart',
    description: 'Blood pressure and daytime heart rate.',
    suggestedProviders: ['omron', 'withings', 'apple_health'],
  },
  {
    key: 'respiratory',
    label: 'Respiratory',
    icon: 'Wind',
    description: 'Overnight respiratory rate and blood oxygen.',
    suggestedProviders: ['oura', 'whoop', 'apple_health', 'garmin'],
  },
  {
    key: 'body',
    label: 'Body Composition',
    icon: 'Scale',
    description: 'Weight, body fat, and body temperature trends.',
    suggestedProviders: ['withings', 'oura', 'apple_health'],
  },
  {
    key: 'cycle',
    label: 'Cycle',
    icon: 'CalendarHeart',
    description: 'Menstrual cycle phase for cycle-synced protocols.',
    suggestedProviders: ['oura', 'apple_health'],
  },
];

export const METRICS: MetricDefinition[] = [
  // Recovery
  { key: 'hrv', fields: ['hrv'], label: 'Heart Rate Variability', shortLabel: 'HRV', unit: 'ms', group: 'recovery', junctionResources: ['hrv', 'heartrate', 'sleep'] },
  { key: 'restingHr', fields: ['restingHr'], label: 'Resting Heart Rate', shortLabel: 'RHR', unit: 'bpm', group: 'recovery', lowerIsBetter: true, junctionResources: ['heartrate', 'sleep'] },
  { key: 'readiness', fields: ['readinessScore'], label: 'Device Readiness', shortLabel: 'Readiness', unit: '', group: 'recovery', junctionResources: ['sleep', 'activity'] },
  { key: 'strain', fields: ['strainScore', 'trainingLoad'], label: 'Strain / Training Load', shortLabel: 'Strain', unit: '', group: 'recovery', junctionResources: ['workouts', 'activity'] },
  { key: 'deviceStress', fields: ['stressScoreDevice'], label: 'Device Stress Score', shortLabel: 'Stress', unit: '', group: 'recovery', lowerIsBetter: true, junctionResources: ['stress_level'] },

  // Sleep
  { key: 'sleepDuration', fields: ['sleepDurationMinutes'], label: 'Sleep Duration', shortLabel: 'Sleep', unit: 'min', group: 'sleep', junctionResources: ['sleep'] },
  { key: 'sleepStages', fields: ['deepSleepMinutes', 'remSleepMinutes', 'lightSleepMinutes'], label: 'Sleep Stages', shortLabel: 'Stages', unit: 'min', group: 'sleep', junctionResources: ['sleep', 'sleep_cycle', 'hypnogram'] },
  { key: 'sleepEfficiency', fields: ['sleepEfficiency'], label: 'Sleep Efficiency', shortLabel: 'Efficiency', unit: '%', group: 'sleep', junctionResources: ['sleep'] },
  { key: 'bedtime', fields: ['bedtime', 'wakeTime'], label: 'Bedtime Consistency', shortLabel: 'Bedtime', unit: '', group: 'sleep', junctionResources: ['sleep'] },

  // Activity
  { key: 'steps', fields: ['steps'], label: 'Steps', shortLabel: 'Steps', unit: '', group: 'activity', junctionResources: ['steps', 'activity'] },
  { key: 'activeCalories', fields: ['caloriesBurned'], label: 'Calories Burned', shortLabel: 'Calories', unit: 'kcal', group: 'activity', junctionResources: ['calories_active', 'activity'] },
  { key: 'workouts', fields: ['workoutMinutes', 'workoutType'], label: 'Workouts', shortLabel: 'Workouts', unit: 'min', group: 'activity', junctionResources: ['workouts', 'workout_duration'] },
  { key: 'vo2max', fields: ['vo2Max'], label: 'VO₂ Max', shortLabel: 'VO₂', unit: 'mL/kg/min', group: 'activity', junctionResources: ['vo2_max'] },

  // Metabolic
  { key: 'glucose', fields: ['glucoseAvg'], label: 'Glucose (CGM)', shortLabel: 'Glucose', unit: 'mg/dL', group: 'metabolic', lowerIsBetter: true, junctionResources: ['glucose'] },
  { key: 'hydration', fields: ['hydrationMl'], label: 'Hydration', shortLabel: 'Water', unit: 'ml', group: 'metabolic', junctionResources: ['water'] },
  { key: 'caffeine', fields: ['caffeineMg'], label: 'Caffeine', shortLabel: 'Caffeine', unit: 'mg', group: 'metabolic', lowerIsBetter: true, junctionResources: ['caffeine'] },

  // Cardiovascular
  { key: 'bloodPressure', fields: ['bloodPressureSystolic', 'bloodPressureDiastolic'], label: 'Blood Pressure', shortLabel: 'BP', unit: 'mmHg', group: 'cardiovascular', lowerIsBetter: true, junctionResources: ['blood_pressure'] },
  { key: 'avgHr', fields: ['avgHr'], label: 'Average Heart Rate', shortLabel: 'Avg HR', unit: 'bpm', group: 'cardiovascular', lowerIsBetter: true, junctionResources: ['heartrate'] },

  // Respiratory
  { key: 'respiratoryRate', fields: ['respiratoryRate'], label: 'Respiratory Rate', shortLabel: 'Resp Rate', unit: 'br/min', group: 'respiratory', lowerIsBetter: true, junctionResources: ['respiratory_rate', 'sleep'] },
  { key: 'spo2', fields: ['spo2'], label: 'Blood Oxygen', shortLabel: 'SpO₂', unit: '%', group: 'respiratory', junctionResources: ['blood_oxygen', 'sleep'] },

  // Body
  { key: 'weight', fields: ['weight'], label: 'Weight', shortLabel: 'Weight', unit: 'kg', group: 'body', junctionResources: ['weight', 'body'] },
  { key: 'bodyFat', fields: ['bodyFatPercent'], label: 'Body Fat', shortLabel: 'Body Fat', unit: '%', group: 'body', junctionResources: ['fat', 'body'] },
  { key: 'temperature', fields: ['tempDeviation', 'skinTemp'], label: 'Body Temperature', shortLabel: 'Temp', unit: '°C', group: 'body', junctionResources: ['body_temperature', 'body_temperature_delta', 'basal_body_temperature'] },

  // Cycle
  { key: 'cycle', fields: ['cyclePhase', 'cycleDayEstimate'], label: 'Cycle Phase', shortLabel: 'Cycle', unit: '', group: 'cycle', junctionResources: ['menstrual_cycle'] },
];

/**
 * What each provider can deliver, expressed as metric keys.
 * Sources: Junction provider docs + device capabilities. Apple Health and
 * Google Health are aggregators — paired accessories (BP cuffs, CGMs,
 * smart scales) surface through them, hence their broad lists.
 */
export const PROVIDER_CAPABILITIES: Record<string, string[]> = {
  oura: ['hrv', 'restingHr', 'readiness', 'sleepDuration', 'sleepStages', 'sleepEfficiency', 'bedtime', 'steps', 'activeCalories', 'workouts', 'respiratoryRate', 'spo2', 'temperature', 'cycle', 'deviceStress'],
  whoop: ['hrv', 'restingHr', 'readiness', 'strain', 'sleepDuration', 'sleepStages', 'sleepEfficiency', 'bedtime', 'workouts', 'activeCalories', 'respiratoryRate', 'spo2', 'temperature'],
  apple_health: ['hrv', 'restingHr', 'sleepDuration', 'sleepStages', 'sleepEfficiency', 'bedtime', 'steps', 'activeCalories', 'workouts', 'vo2max', 'respiratoryRate', 'spo2', 'avgHr', 'bloodPressure', 'glucose', 'weight', 'bodyFat', 'temperature', 'cycle', 'hydration', 'caffeine'],
  google_health: ['hrv', 'restingHr', 'sleepDuration', 'sleepStages', 'bedtime', 'steps', 'activeCalories', 'workouts', 'avgHr', 'bloodPressure', 'glucose', 'weight', 'bodyFat', 'hydration'],
  garmin: ['hrv', 'restingHr', 'readiness', 'strain', 'deviceStress', 'sleepDuration', 'sleepStages', 'sleepEfficiency', 'bedtime', 'steps', 'activeCalories', 'workouts', 'vo2max', 'respiratoryRate', 'spo2'],
  fitbit: ['hrv', 'restingHr', 'sleepDuration', 'sleepStages', 'sleepEfficiency', 'bedtime', 'steps', 'activeCalories', 'workouts', 'spo2', 'temperature', 'avgHr'],
  dexcom: ['glucose'],
  freestyle_libre: ['glucose'],
  omron: ['bloodPressure'],
  withings: ['weight', 'bodyFat', 'bloodPressure', 'sleepDuration', 'temperature'],
  polar: ['restingHr', 'avgHr', 'workouts', 'activeCalories', 'sleepDuration'],
  eight_sleep: ['sleepDuration', 'sleepStages', 'hrv', 'respiratoryRate', 'temperature'],
  manual: [],
};

/** Human-readable provider names + category for the connect catalog. */
export interface ProviderInfo {
  slug: string;
  name: string;
  category: 'Rings & Bands' | 'Watches & Trackers' | 'Phone Health Platforms' | 'CGMs' | 'Blood Pressure & Scales' | 'Sleep';
}

export const PROVIDER_CATALOG: ProviderInfo[] = [
  { slug: 'oura', name: 'Oura Ring', category: 'Rings & Bands' },
  { slug: 'whoop', name: 'WHOOP', category: 'Rings & Bands' },
  { slug: 'garmin', name: 'Garmin', category: 'Watches & Trackers' },
  { slug: 'fitbit', name: 'Fitbit', category: 'Watches & Trackers' },
  { slug: 'polar', name: 'Polar', category: 'Watches & Trackers' },
  { slug: 'apple_health', name: 'Apple Health', category: 'Phone Health Platforms' },
  { slug: 'google_health', name: 'Health Connect (Android)', category: 'Phone Health Platforms' },
  { slug: 'dexcom', name: 'Dexcom CGM', category: 'CGMs' },
  { slug: 'freestyle_libre', name: 'FreeStyle Libre', category: 'CGMs' },
  { slug: 'omron', name: 'Omron BP Monitor', category: 'Blood Pressure & Scales' },
  { slug: 'withings', name: 'Withings', category: 'Blood Pressure & Scales' },
  { slug: 'eight_sleep', name: 'Eight Sleep', category: 'Sleep' },
];

export type MetricAvailability = 'live' | 'expected' | 'locked';

export function getMetric(key: string): MetricDefinition | undefined {
  return METRICS.find(m => m.key === key);
}

export function metricsForGroup(group: MetricGroupKey): MetricDefinition[] {
  return METRICS.filter(m => m.group === group);
}

export function capabilitiesForProvider(slug: string): MetricDefinition[] {
  const keys = PROVIDER_CAPABILITIES[slug] ?? [];
  return METRICS.filter(m => keys.includes(m.key));
}

export function providersForMetric(key: string): ProviderInfo[] {
  return PROVIDER_CATALOG.filter(p => (PROVIDER_CAPABILITIES[p.slug] ?? []).includes(key));
}

function metricHasData(metric: MetricDefinition, records: DailyBiometricRecord[]): boolean {
  return records.some(r =>
    metric.fields.some(f => {
      const v = r[f];
      return v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
    }),
  );
}

/**
 * Compute the availability of every metric from recent records + the set of
 * connected provider slugs. `records` should be the last ~14 days.
 */
export function computeMetricAvailability(
  records: DailyBiometricRecord[],
  connectedProviders: string[],
): Record<string, MetricAvailability> {
  const connectedCaps = new Set<string>(
    connectedProviders.flatMap(p => PROVIDER_CAPABILITIES[p] ?? []),
  );
  const result: Record<string, MetricAvailability> = {};
  for (const metric of METRICS) {
    if (metricHasData(metric, records)) {
      result[metric.key] = 'live';
    } else if (connectedCaps.has(metric.key)) {
      result[metric.key] = 'expected';
    } else {
      result[metric.key] = 'locked';
    }
  }
  return result;
}

/** Group-level rollup: live if any metric is live, expected if any expected. */
export function computeGroupAvailability(
  availability: Record<string, MetricAvailability>,
): Record<MetricGroupKey, MetricAvailability> {
  const result = {} as Record<MetricGroupKey, MetricAvailability>;
  for (const group of METRIC_GROUPS) {
    const states = metricsForGroup(group.key).map(m => availability[m.key] ?? 'locked');
    result[group.key] = states.includes('live') ? 'live' : states.includes('expected') ? 'expected' : 'locked';
  }
  return result;
}
