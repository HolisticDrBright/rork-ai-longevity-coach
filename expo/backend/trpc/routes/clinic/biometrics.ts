import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, createTRPCRouter } from "../../create-context";
import { createServerSupabaseClient } from "../../../supabase-server";
import type {
  BiometricType,
  BiometricReading,
  BiometricStatus,
  BiometricSummary,
  GlucoseStats,
  PaginatedResponse,
  PatientThresholds,
} from "@/types/clinic";

function calculateBiometricStatus(
  value: number,
  type: BiometricType
): BiometricStatus {
  if (type.criticalLow !== undefined && value < type.criticalLow) return 'critical_low';
  if (type.criticalHigh !== undefined && value > type.criticalHigh) return 'critical_high';
  if (type.warningLow !== undefined && value < type.warningLow) return 'warning_low';
  if (type.warningHigh !== undefined && value > type.warningHigh) return 'warning_high';
  return 'normal';
}

function mapDbToBiometricType(row: Record<string, unknown>): BiometricType {
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    unit: row.unit as string,
    category: row.category as BiometricType['category'],
    normalLow: row.normal_low as number | undefined,
    normalHigh: row.normal_high as number | undefined,
    warningLow: row.warning_low as number | undefined,
    warningHigh: row.warning_high as number | undefined,
    criticalLow: row.critical_low as number | undefined,
    criticalHigh: row.critical_high as number | undefined,
    isActive: row.is_active as boolean,
  };
}

function mapDbToReading(row: Record<string, unknown>, bioType?: BiometricType): BiometricReading {
  return {
    id: row.id as string,
    patientId: row.patient_id as string,
    biometricTypeId: row.biometric_type_id as string,
    biometricType: bioType,
    value: row.value as number,
    unit: row.unit as string,
    readingTime: row.reading_time as string,
    context: row.context as BiometricReading['context'],
    notes: row.notes as string | undefined,
    source: row.source as BiometricReading['source'],
    deviceName: row.device_name as string | undefined,
    status: row.status as BiometricStatus,
    createdAt: row.created_at as string,
  };
}

function mapDbToThresholds(row: Record<string, unknown>): PatientThresholds {
  return {
    id: row.id as string,
    patientId: row.patient_id as string,
    glucoseHigh: row.glucose_high as number,
    glucoseLow: row.glucose_low as number,
    glucoseCriticalHigh: row.glucose_critical_high as number,
    glucoseCriticalLow: row.glucose_critical_low as number,
    bpSystolicHigh: row.bp_systolic_high as number,
    bpSystolicLow: row.bp_systolic_low as number,
    bpDiastolicHigh: row.bp_diastolic_high as number,
    bpDiastolicLow: row.bp_diastolic_low as number,
    updatedAt: row.updated_at as string,
    updatedBy: row.updated_by as string | undefined,
  };
}

export const biometricsRouter = createTRPCRouter({
  listTypes: protectedProcedure
    .input(
      z.object({
        category: z.string().optional(),
        activeOnly: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }): Promise<BiometricType[]> => {
      console.log('[Biometrics] Listing biometric types');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      let query = sb.from('clinic_biometric_types').select('*');
      if (input.activeOnly) query = query.eq('is_active', true);
      if (input.category) query = query.eq('category', input.category);
      query = query.order('name');

      const { data, error } = await query;
      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list biometric types' });
      }
      return (data ?? []).map(mapDbToBiometricType);
    }),

  getTypeByCode: protectedProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ ctx, input }): Promise<BiometricType | null> => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb.from('clinic_biometric_types').select('*').eq('code', input.code).single();
      if (!data) return null;
      return mapDbToBiometricType(data);
    }),

  listReadings: protectedProcedure
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
    .query(async ({ ctx, input }): Promise<PaginatedResponse<BiometricReading>> => {
      console.log('[Biometrics] Listing readings');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      let typeId = input.biometricTypeId;
      if (!typeId && input.biometricCode) {
        const { data: t } = await sb.from('clinic_biometric_types').select('id').eq('code', input.biometricCode).single();
        if (t) typeId = t.id;
      }

      let query = sb.from('clinic_biometric_readings').select('*', { count: 'exact' }).eq('patient_id', input.patientId);
      if (typeId) query = query.eq('biometric_type_id', typeId);
      if (input.startDate) query = query.gte('reading_time', input.startDate);
      if (input.endDate) query = query.lte('reading_time', input.endDate);
      if (input.status) query = query.eq('status', input.status);
      if (input.context) query = query.eq('context', input.context);

      const offset = (input.page - 1) * input.limit;
      query = query.order('reading_time', { ascending: false }).range(offset, offset + input.limit - 1);

      const { data, error, count } = await query;
      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list readings' });
      }

      const bioTypeIds = [...new Set((data ?? []).map((r: Record<string, unknown>) => r.biometric_type_id as string))];
      const typesMap = new Map<string, BiometricType>();
      if (bioTypeIds.length > 0) {
        const { data: types } = await sb.from('clinic_biometric_types').select('*').in('id', bioTypeIds);
        (types ?? []).forEach((t: Record<string, unknown>) => typesMap.set(t.id as string, mapDbToBiometricType(t)));
      }

      const total = count ?? 0;
      return {
        data: (data ?? []).map((r: Record<string, unknown>) => mapDbToReading(r, typesMap.get(r.biometric_type_id as string))),
        total,
        page: input.page,
        limit: input.limit,
        totalPages: Math.ceil(total / input.limit),
      };
    }),

  addReading: protectedProcedure
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
    .mutation(async ({ ctx, input }): Promise<BiometricReading> => {
      console.log('[Biometrics] Adding reading');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      let biometricType: BiometricType | undefined;

      if (input.biometricTypeId) {
        const { data } = await sb.from('clinic_biometric_types').select('*').eq('id', input.biometricTypeId).single();
        if (data) biometricType = mapDbToBiometricType(data);
      } else if (input.biometricCode) {
        const { data } = await sb.from('clinic_biometric_types').select('*').eq('code', input.biometricCode).single();
        if (data) biometricType = mapDbToBiometricType(data);
      }

      if (!biometricType) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Biometric type not found' });
      }

      const status = calculateBiometricStatus(input.value, biometricType);

      const { data, error } = await sb
        .from('clinic_biometric_readings')
        .insert({
          clinician_id: ctx.user.id,
          patient_id: input.patientId,
          biometric_type_id: biometricType.id,
          value: input.value,
          unit: input.unit || biometricType.unit,
          reading_time: input.readingTime,
          context: input.context,
          notes: input.notes,
          source: input.source,
          device_name: input.deviceName,
          status,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add reading' });
      }

      console.log('[Biometrics] Reading added, status:', status);
      return mapDbToReading(data, biometricType);
    }),

  deleteReading: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }): Promise<{ success: boolean }> => {
      console.log('[Biometrics] Deleting reading');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { error } = await sb.from('clinic_biometric_readings').delete().eq('id', input.id);
      if (error) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Reading not found' });
      }
      return { success: true };
    }),

  getSummary: protectedProcedure
    .input(
      z.object({
        patientId: z.string(),
        days: z.number().min(1).max(365).default(30),
      })
    )
    .query(async ({ ctx, input }): Promise<BiometricSummary[]> => {
      console.log('[Biometrics] Getting summary');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - input.days);
      const cutoffStr = cutoffDate.toISOString();

      const { data: readings } = await sb
        .from('clinic_biometric_readings')
        .select('*')
        .eq('patient_id', input.patientId)
        .gte('reading_time', cutoffStr)
        .order('reading_time', { ascending: false });

      if (!readings || readings.length === 0) return [];

      const typeIds = [...new Set(readings.map((r: Record<string, unknown>) => r.biometric_type_id as string))];
      const { data: types } = await sb.from('clinic_biometric_types').select('*').in('id', typeIds);
      const typesMap = new Map<string, BiometricType>();
      (types ?? []).forEach((t: Record<string, unknown>) => typesMap.set(t.id as string, mapDbToBiometricType(t)));

      const byType = new Map<string, Record<string, unknown>[]>();
      readings.forEach((r: Record<string, unknown>) => {
        const tid = r.biometric_type_id as string;
        const arr = byType.get(tid) || [];
        arr.push(r);
        byType.set(tid, arr);
      });

      const summaries: BiometricSummary[] = [];

      byType.forEach((typeReadings, typeId) => {
        const bt = typesMap.get(typeId);
        if (!bt) return;

        const values = typeReadings.map((r) => r.value as number);
        const latest = typeReadings[0];
        const avgValue = values.reduce((a, b) => a + b, 0) / values.length;

        let trend: BiometricSummary['trend'] = 'unknown';
        if (typeReadings.length >= 5) {
          const recentAvg = typeReadings.slice(0, 3).reduce((a, b) => a + (b.value as number), 0) / 3;
          const olderAvg = typeReadings.slice(-3).reduce((a, b) => a + (b.value as number), 0) / 3;
          const isDecreaseGood = bt.code === 'glucose' || bt.code === 'bp_systolic' || bt.code === 'bp_diastolic';

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
          typeName: bt.name,
          latestValue: latest.value as number,
          latestDate: latest.reading_time as string,
          avgValue: Math.round(avgValue * 10) / 10,
          minValue: Math.min(...values),
          maxValue: Math.max(...values),
          readingCount: values.length,
          trend,
        });
      });

      return summaries;
    }),

  getGlucoseStats: protectedProcedure
    .input(
      z.object({
        patientId: z.string(),
        days: z.number().min(1).max(90).default(14),
      })
    )
    .query(async ({ ctx, input }): Promise<GlucoseStats> => {
      console.log('[Biometrics] Getting glucose stats');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: glucoseType } = await sb.from('clinic_biometric_types').select('id').eq('code', 'glucose').single();
      if (!glucoseType) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Glucose type not configured' });
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - input.days);

      const { data: thresholdRow } = await sb
        .from('clinic_patient_thresholds')
        .select('glucose_high,glucose_low')
        .eq('patient_id', input.patientId)
        .single();

      const highThreshold = (thresholdRow?.glucose_high as number) ?? 180;
      const lowThreshold = (thresholdRow?.glucose_low as number) ?? 70;

      const { data: readings } = await sb
        .from('clinic_biometric_readings')
        .select('value')
        .eq('patient_id', input.patientId)
        .eq('biometric_type_id', glucoseType.id)
        .gte('reading_time', cutoffDate.toISOString());

      if (!readings || readings.length === 0) {
        return {
          averageGlucose: 0, timeInRange: 0, timeAboveRange: 0, timeBelowRange: 0,
          highestReading: 0, lowestReading: 0, readingCount: 0,
        };
      }

      const values = readings.map((r: Record<string, unknown>) => r.value as number);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const inRange = values.filter((v) => v >= lowThreshold && v <= highThreshold).length;
      const above = values.filter((v) => v > highThreshold).length;
      const below = values.filter((v) => v < lowThreshold).length;

      return {
        averageGlucose: Math.round(avg),
        timeInRange: Math.round((inRange / values.length) * 100),
        timeAboveRange: Math.round((above / values.length) * 100),
        timeBelowRange: Math.round((below / values.length) * 100),
        highestReading: Math.max(...values),
        lowestReading: Math.min(...values),
        readingCount: values.length,
        estimatedA1c: Math.round(((avg + 46.7) / 28.7) * 10) / 10,
      };
    }),

  getPatientThresholds: protectedProcedure
    .input(z.object({ patientId: z.string() }))
    .query(async ({ ctx, input }): Promise<PatientThresholds> => {
      console.log('[Biometrics] Getting thresholds');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data } = await sb
        .from('clinic_patient_thresholds')
        .select('*')
        .eq('patient_id', input.patientId)
        .single();

      if (data) return mapDbToThresholds(data);

      return {
        id: 'default',
        patientId: input.patientId,
        glucoseHigh: 180, glucoseLow: 70,
        glucoseCriticalHigh: 250, glucoseCriticalLow: 54,
        bpSystolicHigh: 140, bpSystolicLow: 90,
        bpDiastolicHigh: 90, bpDiastolicLow: 60,
        updatedAt: new Date().toISOString(),
      };
    }),

  updatePatientThresholds: protectedProcedure
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
    .mutation(async ({ ctx, input }): Promise<PatientThresholds> => {
      console.log('[Biometrics] Updating thresholds');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const upsertData: Record<string, unknown> = {
        clinician_id: ctx.user.id,
        patient_id: input.patientId,
      };
      if (input.glucoseHigh !== undefined) upsertData.glucose_high = input.glucoseHigh;
      if (input.glucoseLow !== undefined) upsertData.glucose_low = input.glucoseLow;
      if (input.glucoseCriticalHigh !== undefined) upsertData.glucose_critical_high = input.glucoseCriticalHigh;
      if (input.glucoseCriticalLow !== undefined) upsertData.glucose_critical_low = input.glucoseCriticalLow;
      if (input.bpSystolicHigh !== undefined) upsertData.bp_systolic_high = input.bpSystolicHigh;
      if (input.bpSystolicLow !== undefined) upsertData.bp_systolic_low = input.bpSystolicLow;
      if (input.bpDiastolicHigh !== undefined) upsertData.bp_diastolic_high = input.bpDiastolicHigh;
      if (input.bpDiastolicLow !== undefined) upsertData.bp_diastolic_low = input.bpDiastolicLow;
      if (input.updatedBy !== undefined) upsertData.updated_by = input.updatedBy;

      const { data, error } = await sb
        .from('clinic_patient_thresholds')
        .upsert(upsertData, { onConflict: 'patient_id' })
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update thresholds' });
      }

      return mapDbToThresholds(data);
    }),

  getCategories: protectedProcedure.query(async ({ ctx }): Promise<string[]> => {
    const sb = createServerSupabaseClient(ctx.sessionToken);
    const { data } = await sb.from('clinic_biometric_types').select('category').not('category', 'is', null);
    const categories = new Set<string>();
    (data ?? []).forEach((row: Record<string, unknown>) => {
      if (row.category) categories.add(row.category as string);
    });
    return Array.from(categories).sort();
  }),
});
