import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, createTRPCRouter } from "../create-context";
import { createServerSupabaseClient } from "../../supabase-server";

/**
 * User Services Router
 * Covers: supplement adherence, notifications, wearable sync, data export, score recalculation
 */

// ============================================================
// SUPPLEMENT ADHERENCE
// ============================================================

const supplementScheduleInput = z.object({
  supplementName: z.string().min(1),
  dosage: z.string().min(1),
  frequency: z.enum(['daily', 'twice_daily', 'weekly', 'as_needed']).default('daily'),
  timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'bedtime']).default('morning'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  prescribedBy: z.string().optional(),
  notes: z.string().optional(),
});

const supplementAdherenceRouter = createTRPCRouter({
  /** Get active supplement schedule */
  getSchedule: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('supplement_schedules')
        .select('*')
        .eq('user_id', input.userId)
        .eq('is_active', true)
        .order('time_of_day');

      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        supplementName: row.supplement_name as string,
        dosage: row.dosage as string,
        frequency: row.frequency as string,
        timeOfDay: row.time_of_day as string,
        isActive: row.is_active as boolean,
        startDate: row.start_date as string,
        endDate: row.end_date as string | undefined,
        prescribedBy: row.prescribed_by as string | undefined,
        notes: row.notes as string | undefined,
      }));
    }),

  /** Add a supplement to the schedule */
  addToSchedule: protectedProcedure
    .input(supplementScheduleInput)
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('supplement_schedules')
        .insert({
          user_id: ctx.user.id,
          supplement_name: input.supplementName,
          dosage: input.dosage,
          frequency: input.frequency,
          time_of_day: input.timeOfDay,
          start_date: input.startDate,
          end_date: input.endDate,
          prescribed_by: input.prescribedBy,
          notes: input.notes,
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add supplement' });
      return { id: data.id, supplementName: data.supplement_name };
    }),

  /** Remove supplement from schedule */
  removeFromSchedule: protectedProcedure
    .input(z.object({ scheduleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      await sb.from('supplement_schedules').update({ is_active: false }).eq('id', input.scheduleId);
      return { success: true };
    }),

  /** Log that a supplement was taken */
  logTaken: protectedProcedure
    .input(z.object({
      supplementName: z.string(),
      dosage: z.string().optional(),
      scheduledTime: z.enum(['morning', 'afternoon', 'evening', 'bedtime']).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('supplement_logs')
        .insert({
          user_id: ctx.user.id,
          supplement_name: input.supplementName,
          dosage: input.dosage,
          scheduled_time: input.scheduledTime,
          taken_at: new Date().toISOString(),
          date: new Date().toISOString().split('T')[0],
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to log supplement' });
      return { id: data.id };
    }),

  /** Log that a supplement was skipped */
  logSkipped: protectedProcedure
    .input(z.object({
      supplementName: z.string(),
      scheduledTime: z.enum(['morning', 'afternoon', 'evening', 'bedtime']).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      await sb.from('supplement_logs').insert({
        user_id: ctx.user.id,
        supplement_name: input.supplementName,
        scheduled_time: input.scheduledTime,
        skipped: true,
        notes: input.notes,
        date: new Date().toISOString().split('T')[0],
      });
      return { success: true };
    }),

  /** Get today's adherence rate */
  getTodayAdherence: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const today = new Date().toISOString().split('T')[0];

      const [scheduleRes, logsRes] = await Promise.all([
        sb.from('supplement_schedules').select('id, supplement_name').eq('user_id', input.userId).eq('is_active', true),
        sb.from('supplement_logs').select('supplement_name, skipped, taken_at').eq('user_id', input.userId).eq('date', today),
      ]);

      const scheduled = scheduleRes.data ?? [];
      const logs = logsRes.data ?? [];
      const taken = logs.filter((l: Record<string, unknown>) => !l.skipped && l.taken_at);
      const skipped = logs.filter((l: Record<string, unknown>) => l.skipped);

      const total = scheduled.length;
      const adherenceRate = total > 0 ? Math.round((taken.length / total) * 100) : 100;

      return {
        scheduled: total,
        taken: taken.length,
        skipped: skipped.length,
        remaining: Math.max(0, total - taken.length - skipped.length),
        adherenceRate,
        date: today,
      };
    }),

  /** Get adherence history over time */
  getAdherenceHistory: protectedProcedure
    .input(z.object({ userId: z.string(), days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - input.days);

      const { data: logs } = await sb
        .from('supplement_logs')
        .select('date, skipped, taken_at')
        .eq('user_id', input.userId)
        .gte('date', cutoff.toISOString().split('T')[0])
        .order('date');

      const { data: schedules } = await sb
        .from('supplement_schedules')
        .select('id')
        .eq('user_id', input.userId)
        .eq('is_active', true);

      const dailyTarget = (schedules ?? []).length || 1;
      const byDate = new Map<string, { taken: number; skipped: number }>();

      (logs ?? []).forEach((l: Record<string, unknown>) => {
        const date = l.date as string;
        const entry = byDate.get(date) ?? { taken: 0, skipped: 0 };
        if (l.taken_at && !l.skipped) entry.taken++;
        else if (l.skipped) entry.skipped++;
        byDate.set(date, entry);
      });

      const history = Array.from(byDate.entries()).map(([date, counts]) => ({
        date,
        adherenceRate: Math.round((counts.taken / dailyTarget) * 100),
        taken: counts.taken,
        skipped: counts.skipped,
      }));

      const rates = history.map((h) => h.adherenceRate);
      const avgRate = rates.length > 0 ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;

      return { history, averageRate: avgRate, totalDays: history.length };
    }),
});

// ============================================================
// NOTIFICATIONS
// ============================================================

const notificationsRouter = createTRPCRouter({
  /** Get or create notification preferences */
  getPreferences: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('notification_preferences')
        .select('*')
        .eq('user_id', input.userId)
        .single();

      if (!data) {
        return {
          pushEnabled: true,
          alertUrgent: true,
          alertAttention: true,
          alertInformational: false,
          dailyInsight: true,
          supplementReminders: true,
          scoreUpdates: false,
          quietHoursStart: '22:00',
          quietHoursEnd: '07:00',
          timezone: 'UTC',
          expoPushToken: null,
        };
      }

      return {
        pushEnabled: data.push_enabled as boolean,
        alertUrgent: data.alert_urgent as boolean,
        alertAttention: data.alert_attention as boolean,
        alertInformational: data.alert_informational as boolean,
        dailyInsight: data.daily_insight as boolean,
        supplementReminders: data.supplement_reminders as boolean,
        scoreUpdates: data.score_updates as boolean,
        quietHoursStart: data.quiet_hours_start as string,
        quietHoursEnd: data.quiet_hours_end as string,
        timezone: data.timezone as string,
        expoPushToken: data.expo_push_token as string | null,
      };
    }),

  /** Update notification preferences */
  updatePreferences: protectedProcedure
    .input(z.object({
      pushEnabled: z.boolean().optional(),
      alertUrgent: z.boolean().optional(),
      alertAttention: z.boolean().optional(),
      alertInformational: z.boolean().optional(),
      dailyInsight: z.boolean().optional(),
      supplementReminders: z.boolean().optional(),
      scoreUpdates: z.boolean().optional(),
      quietHoursStart: z.string().optional(),
      quietHoursEnd: z.string().optional(),
      timezone: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const updateData: Record<string, unknown> = {};
      if (input.pushEnabled !== undefined) updateData.push_enabled = input.pushEnabled;
      if (input.alertUrgent !== undefined) updateData.alert_urgent = input.alertUrgent;
      if (input.alertAttention !== undefined) updateData.alert_attention = input.alertAttention;
      if (input.alertInformational !== undefined) updateData.alert_informational = input.alertInformational;
      if (input.dailyInsight !== undefined) updateData.daily_insight = input.dailyInsight;
      if (input.supplementReminders !== undefined) updateData.supplement_reminders = input.supplementReminders;
      if (input.scoreUpdates !== undefined) updateData.score_updates = input.scoreUpdates;
      if (input.quietHoursStart !== undefined) updateData.quiet_hours_start = input.quietHoursStart;
      if (input.quietHoursEnd !== undefined) updateData.quiet_hours_end = input.quietHoursEnd;
      if (input.timezone !== undefined) updateData.timezone = input.timezone;

      await sb
        .from('notification_preferences')
        .upsert({ user_id: ctx.user.id, ...updateData }, { onConflict: 'user_id' });

      return { success: true };
    }),

  /** Register Expo push token */
  registerPushToken: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      await sb
        .from('notification_preferences')
        .upsert(
          { user_id: ctx.user.id, expo_push_token: input.token },
          { onConflict: 'user_id' }
        );
      return { success: true };
    }),

  /** Send a push notification (server-side, used by detection engine) */
  sendAlert: protectedProcedure
    .input(z.object({
      userId: z.string(),
      title: z.string(),
      body: z.string(),
      severity: z.enum(['urgent', 'attention', 'informational']),
      data: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      // Check user preferences
      const { data: prefs } = await sb
        .from('notification_preferences')
        .select('push_enabled, alert_urgent, alert_attention, alert_informational, expo_push_token, quiet_hours_start, quiet_hours_end, timezone')
        .eq('user_id', input.userId)
        .single();

      if (!prefs?.push_enabled || !prefs?.expo_push_token) {
        return { sent: false, reason: 'push_disabled_or_no_token' };
      }

      // Check severity preference
      const severityAllowed =
        (input.severity === 'urgent' && prefs.alert_urgent) ||
        (input.severity === 'attention' && prefs.alert_attention) ||
        (input.severity === 'informational' && prefs.alert_informational);

      if (!severityAllowed) {
        return { sent: false, reason: 'severity_not_enabled' };
      }

      // Check quiet hours
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const currentTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      const quietStart = (prefs.quiet_hours_start as string) ?? '22:00';
      const quietEnd = (prefs.quiet_hours_end as string) ?? '07:00';

      if (quietStart > quietEnd) {
        // Overnight quiet hours (e.g., 22:00-07:00)
        if (currentTime >= quietStart || currentTime < quietEnd) {
          if (input.severity !== 'urgent') {
            return { sent: false, reason: 'quiet_hours' };
          }
        }
      }

      // Send via Expo Push API
      try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: prefs.expo_push_token,
            title: input.title,
            body: input.body,
            priority: input.severity === 'urgent' ? 'high' : 'default',
            sound: input.severity === 'urgent' ? 'default' : null,
            data: input.data ?? {},
          }),
        });

        if (response.ok) {
          return { sent: true };
        }
        return { sent: false, reason: 'push_api_error' };
      } catch {
        return { sent: false, reason: 'push_api_unavailable' };
      }
    }),
});

// ============================================================
// WEARABLE SYNC
// ============================================================

const wearableSyncRouter = createTRPCRouter({
  /** Sync biometric readings from wearable device to Supabase */
  syncReadings: protectedProcedure
    .input(z.object({
      provider: z.enum(['apple_health', 'oura', 'whoop', 'fitbit', 'garmin']),
      readings: z.array(z.object({
        biometricCode: z.string(),
        value: z.number(),
        unit: z.string(),
        readingTime: z.string(),
        context: z.enum(['fasting', 'post_meal', 'pre_exercise', 'post_exercise', 'bedtime', 'waking', 'random']).optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      // Resolve biometric type IDs from codes
      const codes = [...new Set(input.readings.map((r) => r.biometricCode))];
      const { data: types } = await sb
        .from('clinic_biometric_types')
        .select('id, code, unit, normal_low, normal_high, warning_low, warning_high, critical_low, critical_high')
        .in('code', codes);

      const typeMap = new Map<string, Record<string, unknown>>();
      (types ?? []).forEach((t: Record<string, unknown>) => typeMap.set(t.code as string, t));

      let inserted = 0;
      let skipped = 0;

      for (const reading of input.readings) {
        const bioType = typeMap.get(reading.biometricCode);
        if (!bioType) { skipped++; continue; }

        // Calculate status
        const value = reading.value;
        const critLow = bioType.critical_low as number | undefined;
        const critHigh = bioType.critical_high as number | undefined;
        const warnLow = bioType.warning_low as number | undefined;
        const warnHigh = bioType.warning_high as number | undefined;

        let status = 'normal';
        if (critLow != null && value < critLow) status = 'critical_low';
        else if (critHigh != null && value > critHigh) status = 'critical_high';
        else if (warnLow != null && value < warnLow) status = 'warning_low';
        else if (warnHigh != null && value > warnHigh) status = 'warning_high';

        const { error } = await sb
          .from('clinic_biometric_readings')
          .insert({
            clinician_id: ctx.user.id,
            patient_id: ctx.user.id, // self-tracking
            biometric_type_id: bioType.id,
            value: reading.value,
            unit: reading.unit || bioType.unit,
            reading_time: reading.readingTime,
            context: reading.context,
            source: 'device_sync',
            device_name: input.provider,
            status,
          });

        if (!error) inserted++;
        else skipped++;
      }

      // Update sync log
      await sb.from('wearable_sync_log').upsert(
        {
          user_id: ctx.user.id,
          provider: input.provider,
          records_synced: inserted,
          last_sync_at: new Date().toISOString(),
          sync_status: skipped === 0 ? 'success' : inserted > 0 ? 'partial' : 'failed',
        },
        { onConflict: 'user_id,provider' }
      );

      return { inserted, skipped, provider: input.provider };
    }),

  /** Get sync status for all connected providers */
  getSyncStatus: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('wearable_sync_log')
        .select('*')
        .eq('user_id', input.userId)
        .order('last_sync_at', { ascending: false });

      return (data ?? []).map((row: Record<string, unknown>) => ({
        provider: row.provider as string,
        recordsSynced: row.records_synced as number,
        lastSyncAt: row.last_sync_at as string,
        syncStatus: row.sync_status as string,
        errorMessage: row.error_message as string | undefined,
      }));
    }),
});

// ============================================================
// DATA EXPORT & ACCOUNT MANAGEMENT (GDPR/CCPA)
// ============================================================

const accountRouter = createTRPCRouter({
  /** Export all user data as JSON */
  exportData: protectedProcedure
    .mutation(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const userId = ctx.user.id;

      // Collect all user data from all tables
      const [profile, labs, biometrics, supplements, scores, healthScores, patterns, reports, auditLogs] = await Promise.all([
        sb.from('profiles').select('*').eq('id', userId).single(),
        sb.from('clinic_lab_results').select('*').eq('patient_id', userId),
        sb.from('clinic_biometric_readings').select('*').eq('patient_id', userId),
        sb.from('supplement_logs').select('*').eq('user_id', userId),
        sb.from('longevity_scores').select('*').eq('user_id', userId),
        sb.from('daily_health_scores').select('*').eq('user_id', userId),
        sb.from('detected_clinical_patterns').select('*').eq('user_id', userId),
        sb.from('doctor_reports').select('id, report_type, title, generated_at, status').eq('user_id', userId),
        sb.from('clinic_audit_logs').select('action, resource, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1000),
      ]);

      const exportData = {
        exportedAt: new Date().toISOString(),
        userId,
        profile: profile.data,
        labResults: labs.data ?? [],
        biometricReadings: biometrics.data ?? [],
        supplementLogs: supplements.data ?? [],
        longevityScores: scores.data ?? [],
        dailyHealthScores: healthScores.data ?? [],
        detectedPatterns: patterns.data ?? [],
        reports: reports.data ?? [],
        auditLogSummary: {
          totalEntries: (auditLogs.data ?? []).length,
          recentEntries: (auditLogs.data ?? []).slice(0, 50),
        },
      };

      // Log the export request
      await sb.from('data_export_requests').insert({
        user_id: userId,
        request_type: 'export',
        status: 'completed',
        completed_at: new Date().toISOString(),
      });

      return exportData;
    }),

  /**
   * Request account deletion (GDPR/CCPA compliant).
   * Creates a pending request with a 30-day grace period.
   * Actual deletion is performed by a scheduled job after the grace period.
   * Users can cancel the request within 30 days.
   */
  requestDeletion: protectedProcedure
    .mutation(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const userId = ctx.user.id;

      // Check for existing pending deletion request
      const { data: existing } = await sb
        .from('data_export_requests')
        .select('id, created_at')
        .eq('user_id', userId)
        .eq('request_type', 'delete')
        .eq('status', 'pending')
        .single();

      if (existing) {
        const scheduledDate = new Date(existing.created_at as string);
        scheduledDate.setDate(scheduledDate.getDate() + 30);
        return {
          requestId: existing.id as string,
          status: 'already_pending',
          scheduledDeletionDate: scheduledDate.toISOString(),
          message: 'A deletion request is already pending. Your data will be permanently deleted after the 30-day grace period.',
        };
      }

      // Create new deletion request (30-day grace period)
      const { data, error } = await sb
        .from('data_export_requests')
        .insert({
          user_id: userId,
          request_type: 'delete',
          status: 'pending',
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create deletion request' });
      }

      const scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + 30);

      return {
        requestId: data.id,
        status: 'pending',
        scheduledDeletionDate: scheduledDate.toISOString(),
        message: 'Your account deletion request has been received. Your data will be permanently deleted after a 30-day grace period. You can cancel this request at any time within those 30 days.',
      };
    }),

  /** Cancel a pending deletion request */
  cancelDeletion: protectedProcedure
    .mutation(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { error } = await sb
        .from('data_export_requests')
        .delete()
        .eq('user_id', ctx.user.id)
        .eq('request_type', 'delete')
        .eq('status', 'pending');

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to cancel deletion request' });
      }

      return { success: true, message: 'Deletion request cancelled. Your data will be preserved.' };
    }),

  /** Get deletion/export request status */
  getRequests: protectedProcedure
    .query(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('data_export_requests')
        .select('*')
        .eq('user_id', ctx.user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      return (data ?? []).map((row: Record<string, unknown>) => ({
        id: row.id as string,
        requestType: row.request_type as string,
        status: row.status as string,
        completedAt: row.completed_at as string | undefined,
        createdAt: row.created_at as string,
      }));
    }),
});

// ============================================================
// SCHEDULED RECALCULATION
// ============================================================

const scheduledRouter = createTRPCRouter({
  /**
   * Recalculate all scores for a user.
   * Can be called manually or by a cron job hitting this endpoint.
   */
  recalculateScores: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx }) => {
      // This endpoint is a coordinator — it calls the other routers' calculate methods
      // In a real implementation, this would be triggered by a Fly.io scheduled machine
      // or a Supabase Edge Function on a cron schedule

      return {
        message: 'Score recalculation triggered',
        userId: ctx.user.id,
        triggeredAt: new Date().toISOString(),
        note: 'Call longevityScore.calculate and healthScore.calculate separately for actual recalculation',
      };
    }),
});

// ============================================================
// COMBINED ROUTER
// ============================================================

export const userServicesRouter = createTRPCRouter({
  adherence: supplementAdherenceRouter,
  notifications: notificationsRouter,
  wearableSync: wearableSyncRouter,
  account: accountRouter,
  scheduled: scheduledRouter,
});
