import { z } from "zod";
import { publicProcedure, createTRPCRouter } from "../../create-context";
import type {
  BiometricType,
  BiometricReading,
  BiometricStatus,
  BiometricSummary,
  GlucoseStats,
  PaginatedResponse,
  PatientThresholds,
  DEFAULT_THRESHOLDS,
} from "@/types/clinic";

const biometricTypeStore: Map<string, BiometricType> = new Map();
const biometricReadingStore: Map<string, BiometricReading> = new Map();
const patientThresholdsStore: Map<string, PatientThresholds> = new Map();

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function calculateBiometricStatus(
  value: number,
  type: BiometricType
): BiometricStatus {
  if (type.criticalLow !== undefined && value < type.criticalLow)
    return 'critical_low';
  if (type.criticalHigh !== undefined && value > type.criticalHigh)
    return 'critical_high';
  if (type.warningLow !== undefined && value < type.warningLow)
    return 'warning_low';
  if (type.warningHigh !== undefined && value > type.warningHigh)
    return 'warning_high';
  return 'normal';
}

initializeBiometricTypes();

function initializeBiometricTypes() {
  const defaultTypes: Omit<BiometricType, 'id'>[] = [
    {
      code: 'glucose',
      name: 'Blood Glucose',
      unit: 'mg/dL',
      category: 'metabolic',
      normalLow: 70,
      normalHigh: 140,
      warningLow: 60,
      warningHigh: 180,
      criticalLow: 54,
      criticalHigh: 250,
      isActive: true,
    },
    {
      code: 'bp_systolic',
      name: 'Blood Pressure (Systolic)',
      unit: 'mmHg',
      category: 'vital',
      normalLow: 90,
      normalHigh: 120,
      warningLow: 80,
      warningHigh: 140,
      criticalLow: 70,
      criticalHigh: 180,
      isActive: true,
    },
    {
      code: 'bp_diastolic',
      name: 'Blood Pressure (Diastolic)',
      unit: 'mmHg',
      category: 'vital',
      normalLow: 60,
      normalHigh: 80,
      warningLow: 50,
      warningHigh: 90,
      criticalLow: 40,
      criticalHigh: 120,
      isActive: true,
    },
    {
      code: 'heart_rate',
      name: 'Heart Rate',
      unit: 'bpm',
      category: 'vital',
      normalLow: 60,
      normalHigh: 100,
      warningLow: 50,
      warningHigh: 110,
      criticalLow: 40,
      criticalHigh: 150,
      isActive: true,
    },
    {
      code: 'weight',
      name: 'Weight',
      unit: 'lbs',
      category: 'body_composition',
      isActive: true,
    },
    {
      code: 'body_fat',
      name: 'Body Fat Percentage',
      unit: '%',
      category: 'body_composition',
      isActive: true,
    },
    {
      code: 'waist',
      name: 'Waist Circumference',
      unit: 'inches',
      category: 'body_composition',
      isActive: true,
    },
    {
      code: 'temperature',
      name: 'Body Temperature',
      unit: '°F',
      category: 'vital',
      normalLow: 97.0,
      normalHigh: 99.0,
      warningLow: 95.0,
      warningHigh: 100.4,
      criticalLow: 93.0,
      criticalHigh: 104.0,
      isActive: true,
    },
    {
      code: 'oxygen_sat',
      name: 'Oxygen Saturation',
      unit: '%',
      category: 'vital',
      normalLow: 95,
      normalHigh: 100,
      warningLow: 92,
      criticalLow: 88,
      isActive: true,
    },
    {
      code: 'hrv',
      name: 'Heart Rate Variability',
      unit: 'ms',
      category: 'vital',
      normalLow: 20,
      isActive: true,
    },
    {
      code: 'sleep_hours',
      name: 'Sleep Duration',
      unit: 'hours',
      category: 'sleep',
      normalLow: 7,
      normalHigh: 9,
      warningLow: 5,
      warningHigh: 10,
      isActive: true,
    },
    {
      code: 'sleep_quality',
      name: 'Sleep Quality Score',
      unit: 'score',
      category: 'sleep',
      normalLow: 70,
      normalHigh: 100,
      warningLow: 50,
      isActive: true,
    },
    {
      code: 'steps',
      name: 'Daily Steps',
      unit: 'steps',
      category: 'activity',
      normalLow: 7000,
      isActive: true,
    },
    {
      code: 'ketones',
      name: 'Blood Ketones',
      unit: 'mmol/L',
      category: 'metabolic',
      normalLow: 0.5,
      normalHigh: 3.0,
      warningHigh: 5.0,
      criticalHigh: 10.0,
      isActive: true,
    },
  ];

  defaultTypes.forEach((type) => {
    const id = generateId();
    biometricTypeStore.set(id, { id, ...type });
  });
  console.log('[Biometrics] Initialized', biometricTypeStore.size, 'biometric types');
}

export const biometricsRouter = createTRPCRouter({
  listTypes: publicProcedure
    .input(
      z.object({
        category: z.string().optional(),
        activeOnly: z.boolean().default(true),
      })
    )
    .query(async ({ input }): Promise<BiometricType[]> => {
      console.log('[Biometrics] Listing biometric types');
      
      let types = Array.from(biometricTypeStore.values());

      if (input.activeOnly) {
        types = types.filter((t) => t.isActive);
      }

      if (input.category) {
        types = types.filter((t) => t.category === input.category);
      }

      return types.sort((a, b) => a.name.localeCompare(b.name));
    }),

  getTypeByCode: publicProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }): Promise<BiometricType | null> => {
      return (
        Array.from(biometricTypeStore.values()).find((t) => t.code === input.code) ||
        null
      );
    }),

  listReadings: publicProcedure
    .input(
      z.object({
        patientId: z.string(),
        biometricTypeId: z.string().optional(),
        biometricCode: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        status: z.enum(['normal', 'warning_low', 'warning_high', 'critical_low', 'critical_high']).optional(),
        context: z.enum(['fasting', 'post_meal', 'pre_exercise', 'post_exercise', 'bedtime', 'waking', 'random']).optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(500).default(100),
      })
    )
    .query(async ({ input }): Promise<PaginatedResponse<BiometricReading>> => {
      console.log('[Biometrics] Listing readings for patient:', input.patientId);
      
      let readings = Array.from(biometricReadingStore.values()).filter(
        (r) => r.patientId === input.patientId
      );

      if (input.biometricTypeId) {
        readings = readings.filter((r) => r.biometricTypeId === input.biometricTypeId);
      }

      if (input.biometricCode) {
        const type = Array.from(biometricTypeStore.values()).find(
          (t) => t.code === input.biometricCode
        );
        if (type) {
          readings = readings.filter((r) => r.biometricTypeId === type.id);
        }
      }

      if (input.startDate) {
        readings = readings.filter((r) => r.readingTime >= input.startDate!);
      }

      if (input.endDate) {
        readings = readings.filter((r) => r.readingTime <= input.endDate!);
      }

      if (input.status) {
        readings = readings.filter((r) => r.status === input.status);
      }

      if (input.context) {
        readings = readings.filter((r) => r.context === input.context);
      }

      readings = readings.map((r) => ({
        ...r,
        biometricType: biometricTypeStore.get(r.biometricTypeId),
      }));

      readings.sort(
        (a, b) =>
          new Date(b.readingTime).getTime() - new Date(a.readingTime).getTime()
      );

      const total = readings.length;
      const totalPages = Math.ceil(total / input.limit);
      const startIndex = (input.page - 1) * input.limit;
      const paginatedReadings = readings.slice(startIndex, startIndex + input.limit);

      return {
        data: paginatedReadings,
        total,
        page: input.page,
        limit: input.limit,
        totalPages,
      };
    }),

  addReading: publicProcedure
    .input(
      z.object({
        patientId: z.string(),
        biometricTypeId: z.string().optional(),
        biometricCode: z.string().optional(),
        value: z.number(),
        unit: z.string().optional(),
        readingTime: z.string(),
        context: z.enum(['fasting', 'post_meal', 'pre_exercise', 'post_exercise', 'bedtime', 'waking', 'random']).optional(),
        notes: z.string().optional(),
        source: z.enum(['manual', 'device_sync', 'cgm', 'app']).default('manual'),
        deviceName: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<BiometricReading> => {
      console.log('[Biometrics] Adding reading for patient:', input.patientId);
      
      let biometricType: BiometricType | undefined;

      if (input.biometricTypeId) {
        biometricType = biometricTypeStore.get(input.biometricTypeId);
      } else if (input.biometricCode) {
        biometricType = Array.from(biometricTypeStore.values()).find(
          (t) => t.code === input.biometricCode
        );
      }

      if (!biometricType) {
        throw new Error('Biometric type not found');
      }

      const status = calculateBiometricStatus(input.value, biometricType);

      const reading: BiometricReading = {
        id: generateId(),
        patientId: input.patientId,
        biometricTypeId: biometricType.id,
        value: input.value,
        unit: input.unit || biometricType.unit,
        readingTime: input.readingTime,
        context: input.context,
        notes: input.notes,
        source: input.source,
        deviceName: input.deviceName,
        status,
        createdAt: new Date().toISOString(),
      };

      biometricReadingStore.set(reading.id, reading);
      console.log('[Biometrics] Reading added:', reading.id, 'Status:', status);

      return { ...reading, biometricType };
    }),

  deleteReading: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }): Promise<{ success: boolean }> => {
      console.log('[Biometrics] Deleting reading:', input.id);
      
      if (!biometricReadingStore.has(input.id)) {
        throw new Error('Reading not found');
      }

      biometricReadingStore.delete(input.id);
      return { success: true };
    }),

  getSummary: publicProcedure
    .input(
      z.object({
        patientId: z.string(),
        days: z.number().min(1).max(365).default(30),
      })
    )
    .query(async ({ input }): Promise<BiometricSummary[]> => {
      console.log('[Biometrics] Getting summary for patient:', input.patientId);
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - input.days);
      const cutoffStr = cutoffDate.toISOString();

      const readings = Array.from(biometricReadingStore.values()).filter(
        (r) => r.patientId === input.patientId && r.readingTime >= cutoffStr
      );

      const byType = new Map<string, BiometricReading[]>();
      readings.forEach((r) => {
        const existing = byType.get(r.biometricTypeId) || [];
        existing.push(r);
        byType.set(r.biometricTypeId, existing);
      });

      const summaries: BiometricSummary[] = [];

      byType.forEach((typeReadings, typeId) => {
        const biometricType = biometricTypeStore.get(typeId);
        if (!biometricType) return;

        const values = typeReadings.map((r) => r.value);
        const sortedByTime = [...typeReadings].sort(
          (a, b) =>
            new Date(b.readingTime).getTime() - new Date(a.readingTime).getTime()
        );

        const latest = sortedByTime[0];
        const avgValue = values.reduce((a, b) => a + b, 0) / values.length;

        let trend: BiometricSummary['trend'] = 'unknown';
        if (sortedByTime.length >= 5) {
          const recentAvg =
            sortedByTime.slice(0, 3).reduce((a, b) => a + b.value, 0) / 3;
          const olderAvg =
            sortedByTime.slice(-3).reduce((a, b) => a + b.value, 0) / 3;
          
          const normalHigh = biometricType.normalHigh ?? Infinity;
          const isDecreaseGood = biometricType.code === 'glucose' || 
                                  biometricType.code === 'bp_systolic' ||
                                  biometricType.code === 'bp_diastolic';
          
          if (Math.abs(recentAvg - olderAvg) < avgValue * 0.05) {
            trend = 'stable';
          } else if (recentAvg < olderAvg) {
            trend = isDecreaseGood ? 'improving' : 'worsening';
          } else {
            trend = isDecreaseGood ? 'worsening' : 'improving';
          }
        }

        summaries.push({
          biometricTypeId: typeId,
          typeName: biometricType.name,
          latestValue: latest.value,
          latestDate: latest.readingTime,
          avgValue: Math.round(avgValue * 10) / 10,
          minValue: Math.min(...values),
          maxValue: Math.max(...values),
          readingCount: values.length,
          trend,
        });
      });

      return summaries;
    }),

  getGlucoseStats: publicProcedure
    .input(
      z.object({
        patientId: z.string(),
        days: z.number().min(1).max(90).default(14),
      })
    )
    .query(async ({ input }): Promise<GlucoseStats> => {
      console.log('[Biometrics] Getting glucose stats for patient:', input.patientId);
      
      const glucoseType = Array.from(biometricTypeStore.values()).find(
        (t) => t.code === 'glucose'
      );

      if (!glucoseType) {
        throw new Error('Glucose type not configured');
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - input.days);
      const cutoffStr = cutoffDate.toISOString();

      const thresholds = patientThresholdsStore.get(input.patientId);
      const highThreshold = thresholds?.glucoseHigh ?? 180;
      const lowThreshold = thresholds?.glucoseLow ?? 70;

      const readings = Array.from(biometricReadingStore.values()).filter(
        (r) =>
          r.patientId === input.patientId &&
          r.biometricTypeId === glucoseType.id &&
          r.readingTime >= cutoffStr
      );

      if (readings.length === 0) {
        return {
          averageGlucose: 0,
          timeInRange: 0,
          timeAboveRange: 0,
          timeBelowRange: 0,
          highestReading: 0,
          lowestReading: 0,
          readingCount: 0,
        };
      }

      const values = readings.map((r) => r.value);
      const avgGlucose = values.reduce((a, b) => a + b, 0) / values.length;

      const inRange = readings.filter(
        (r) => r.value >= lowThreshold && r.value <= highThreshold
      ).length;
      const aboveRange = readings.filter((r) => r.value > highThreshold).length;
      const belowRange = readings.filter((r) => r.value < lowThreshold).length;

      const estimatedA1c = (avgGlucose + 46.7) / 28.7;

      return {
        averageGlucose: Math.round(avgGlucose),
        timeInRange: Math.round((inRange / readings.length) * 100),
        timeAboveRange: Math.round((aboveRange / readings.length) * 100),
        timeBelowRange: Math.round((belowRange / readings.length) * 100),
        highestReading: Math.max(...values),
        lowestReading: Math.min(...values),
        readingCount: readings.length,
        estimatedA1c: Math.round(estimatedA1c * 10) / 10,
      };
    }),

  getPatientThresholds: publicProcedure
    .input(z.object({ patientId: z.string() }))
    .query(async ({ input }): Promise<PatientThresholds> => {
      console.log('[Biometrics] Getting thresholds for patient:', input.patientId);
      
      const existing = patientThresholdsStore.get(input.patientId);
      if (existing) {
        return existing;
      }

      return {
        id: generateId(),
        patientId: input.patientId,
        glucoseHigh: 180,
        glucoseLow: 70,
        glucoseCriticalHigh: 250,
        glucoseCriticalLow: 54,
        bpSystolicHigh: 140,
        bpSystolicLow: 90,
        bpDiastolicHigh: 90,
        bpDiastolicLow: 60,
        updatedAt: new Date().toISOString(),
      };
    }),

  updatePatientThresholds: publicProcedure
    .input(
      z.object({
        patientId: z.string(),
        glucoseHigh: z.number().optional(),
        glucoseLow: z.number().optional(),
        glucoseCriticalHigh: z.number().optional(),
        glucoseCriticalLow: z.number().optional(),
        bpSystolicHigh: z.number().optional(),
        bpSystolicLow: z.number().optional(),
        bpDiastolicHigh: z.number().optional(),
        bpDiastolicLow: z.number().optional(),
        updatedBy: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<PatientThresholds> => {
      console.log('[Biometrics] Updating thresholds for patient:', input.patientId);
      
      const existing = patientThresholdsStore.get(input.patientId);
      const { patientId, updatedBy, ...updates } = input;

      const cleanedUpdates = Object.fromEntries(
        Object.entries(updates).filter(([_, v]) => v !== undefined)
      );

      const thresholds: PatientThresholds = {
        id: existing?.id || generateId(),
        patientId,
        glucoseHigh: 180,
        glucoseLow: 70,
        glucoseCriticalHigh: 250,
        glucoseCriticalLow: 54,
        bpSystolicHigh: 140,
        bpSystolicLow: 90,
        bpDiastolicHigh: 90,
        bpDiastolicLow: 60,
        ...existing,
        ...cleanedUpdates,
        updatedAt: new Date().toISOString(),
        updatedBy,
      };

      patientThresholdsStore.set(patientId, thresholds);
      return thresholds;
    }),

  getCategories: publicProcedure.query(async (): Promise<string[]> => {
    const categories = new Set<string>();
    biometricTypeStore.forEach((type) => {
      if (type.category) {
        categories.add(type.category);
      }
    });
    return Array.from(categories).sort();
  }),
});

export { biometricTypeStore, biometricReadingStore, patientThresholdsStore };
