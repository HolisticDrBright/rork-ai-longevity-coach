import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, createTRPCRouter } from "../../create-context";
import { createServerSupabaseClient } from "../../../supabase-server";
import type {
  DashboardStats,
  Patient,
  AlertEvent,
  TimelineEvent,
} from "@/types/clinic";
import { sanitizeSearchInput } from "../../sanitize";

interface RecentActivity {
  id: string;
  type: 'lab_upload' | 'lab_result' | 'biometric' | 'encounter' | 'care_plan' | 'alert' | 'patient_created';
  patientId: string;
  patientName: string;
  title: string;
  description?: string;
  timestamp: string;
  severity?: string;
}

interface PendingReview {
  id: string;
  type: 'lab_document' | 'alert' | 'care_plan';
  patientId: string;
  patientName: string;
  title: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  createdAt: string;
}

interface PatientWithAlerts {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: 'male' | 'female' | 'other';
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelationship?: string;
  status: 'active' | 'inactive' | 'archived';
  tags: string[];
  assignedClinicianId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  alertCount: number;
  lastActivity?: string;
  latestAlert?: AlertEvent;
}

export const dashboardRouter = createTRPCRouter({
  getStats: protectedProcedure
    .input(z.object({ clinicianId: z.string().optional() }))
    .query(async ({ ctx, input: _input }): Promise<DashboardStats> => {
      console.log('[Dashboard] Getting stats');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const [patientsRes, alertsRes, docsRes] = await Promise.all([
        sb.from('clinic_patients').select('id,status', { count: 'exact' }),
        sb.from('clinic_alert_events').select('id,severity,status').in('status', ['new', 'viewed']),
        sb.from('clinic_lab_documents').select('id,processing_status,uploaded_at').eq('processing_status', 'pending'),
      ]);

      const patients = patientsRes.data ?? [];
      const alerts = alertsRes.data ?? [];
      const pendingDocs = docsRes.data ?? [];

      const activePatients = patients.filter((p: Record<string, unknown>) => p.status === 'active');
      const criticalAlerts = alerts.filter((a: Record<string, unknown>) => a.severity === 'critical');

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString();
      const recentUploads = (docsRes.data ?? []).filter((d: Record<string, unknown>) => (d.uploaded_at as string) >= todayStr);

      return {
        totalPatients: patientsRes.count ?? patients.length,
        activePatients: activePatients.length,
        criticalAlerts: criticalAlerts.length,
        pendingReviews: pendingDocs.length + criticalAlerts.length,
        recentLabUploads: recentUploads.length,
        todayEncounters: 0,
      };
    }),

  getRecentActivity: protectedProcedure
    .input(
      z.object({
        clinicianId: z.string().optional(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }): Promise<RecentActivity[]> => {
      console.log('[Dashboard] Getting recent activity');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: patientsData } = await sb.from('clinic_patients').select('id,first_name,last_name');
      const nameMap = new Map<string, string>();
      (patientsData ?? []).forEach((p: Record<string, unknown>) => {
        nameMap.set(p.id as string, `${String(p.first_name)} ${String(p.last_name)}`);
      });
      const getName = (pid: string) => nameMap.get(pid) ?? 'Unknown';

      const activities: RecentActivity[] = [];

      const [labDocs, alerts, patients] = await Promise.all([
        sb.from('clinic_lab_documents').select('id,patient_id,panel_name,file_name,uploaded_at').order('uploaded_at', { ascending: false }).limit(input.limit),
        sb.from('clinic_alert_events').select('id,patient_id,title,message,severity,created_at').order('created_at', { ascending: false }).limit(input.limit),
        sb.from('clinic_patients').select('id,first_name,last_name,created_at').order('created_at', { ascending: false }).limit(input.limit),
      ]);

      (labDocs.data ?? []).forEach((doc: Record<string, unknown>) => {
        activities.push({
          id: `lab_doc_${String(doc.id)}`,
          type: 'lab_upload',
          patientId: doc.patient_id as string,
          patientName: getName(doc.patient_id as string),
          title: 'Lab document uploaded',
          description: String((doc.panel_name as string) || (doc.file_name as string)),
          timestamp: doc.uploaded_at as string,
        });
      });

      (alerts.data ?? []).forEach((alert: Record<string, unknown>) => {
        activities.push({
          id: `alert_${String(alert.id)}`,
          type: 'alert',
          patientId: alert.patient_id as string,
          patientName: getName(alert.patient_id as string),
          title: alert.title as string,
          description: alert.message as string,
          timestamp: alert.created_at as string,
          severity: alert.severity as string,
        });
      });

      (patients.data ?? []).forEach((p: Record<string, unknown>) => {
        activities.push({
          id: `patient_${String(p.id)}`,
          type: 'patient_created',
          patientId: p.id as string,
          patientName: `${String(p.first_name)} ${String(p.last_name)}`,
          title: 'New patient added',
          timestamp: p.created_at as string,
        });
      });

      activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return activities.slice(0, input.limit);
    }),

  getPendingReviews: protectedProcedure
    .input(
      z.object({
        clinicianId: z.string().optional(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ ctx, input }): Promise<PendingReview[]> => {
      console.log('[Dashboard] Getting pending reviews');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data: patientsData } = await sb.from('clinic_patients').select('id,first_name,last_name');
      const nameMap = new Map<string, string>();
      (patientsData ?? []).forEach((p: Record<string, unknown>) => {
        nameMap.set(p.id as string, `${String(p.first_name)} ${String(p.last_name)}`);
      });
      const getName = (pid: string) => nameMap.get(pid) ?? 'Unknown';

      const reviews: PendingReview[] = [];

      const [pendingDocs, activeAlerts] = await Promise.all([
        sb.from('clinic_lab_documents').select('id,patient_id,panel_name,file_name,uploaded_at').eq('processing_status', 'pending'),
        sb.from('clinic_alert_events').select('id,patient_id,title,severity,created_at').in('status', ['new', 'viewed']),
      ]);

      (pendingDocs.data ?? []).forEach((doc: Record<string, unknown>) => {
        reviews.push({
          id: doc.id as string,
          type: 'lab_document',
          patientId: doc.patient_id as string,
          patientName: getName(doc.patient_id as string),
          title: `Review lab: ${String((doc.panel_name as string) || (doc.file_name as string))}`,
          priority: 'medium',
          createdAt: doc.uploaded_at as string,
        });
      });

      (activeAlerts.data ?? []).forEach((alert: Record<string, unknown>) => {
        const priorityMap: Record<string, PendingReview['priority']> = {
          critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'low',
        };
        reviews.push({
          id: alert.id as string,
          type: 'alert',
          patientId: alert.patient_id as string,
          patientName: getName(alert.patient_id as string),
          title: alert.title as string,
          priority: priorityMap[alert.severity as string] || 'medium',
          createdAt: alert.created_at as string,
        });
      });

      reviews.sort((a, b) => {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      return reviews.slice(0, input.limit);
    }),

  getPatientList: protectedProcedure
    .input(
      z.object({
        clinicianId: z.string().optional(),
        search: z.string().optional(),
        status: z.enum(['active', 'inactive', 'archived']).optional(),
        hasAlerts: z.boolean().optional(),
        sortBy: z.enum(['name', 'lastActivity', 'alertCount']).default('lastActivity'),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }): Promise<PatientWithAlerts[]> => {
      console.log('[Dashboard] Getting patient list with alerts');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      let query = sb.from('clinic_patients').select('*');
      if (input.search) {
        const search = sanitizeSearchInput(input.search);
        query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
      }
      if (input.status) query = query.eq('status', input.status);
      query = query.order('updated_at', { ascending: false }).limit(input.limit);

      const { data: patients } = await query;

      if (!patients || patients.length === 0) return [];

      const patientIds = patients.map((p: Record<string, unknown>) => p.id as string);

      const { data: activeAlerts } = await sb
        .from('clinic_alert_events')
        .select('id,patient_id,title,message,severity,status,trigger_type,trigger_data,created_at')
        .in('patient_id', patientIds)
        .in('status', ['new', 'viewed'])
        .order('created_at', { ascending: false });

      const alertsByPatient = new Map<string, Record<string, unknown>[]>();
      (activeAlerts ?? []).forEach((a: Record<string, unknown>) => {
        const pid = a.patient_id as string;
        const arr = alertsByPatient.get(pid) || [];
        arr.push(a);
        alertsByPatient.set(pid, arr);
      });

      let result: PatientWithAlerts[] = patients.map((p: Record<string, unknown>) => {
        const pid = p.id as string;
        const patientAlerts = alertsByPatient.get(pid) ?? [];
        const latestAlertRow = patientAlerts[0];

        return {
          id: pid,
          firstName: p.first_name as string,
          lastName: p.last_name as string,
          dateOfBirth: p.date_of_birth as string,
          sex: p.sex as 'male' | 'female' | 'other',
          email: p.email as string | undefined,
          phone: p.phone as string | undefined,
          addressLine1: p.address_line1 as string | undefined,
          addressLine2: p.address_line2 as string | undefined,
          city: p.city as string | undefined,
          state: p.state as string | undefined,
          zipCode: p.zip_code as string | undefined,
          country: p.country as string,
          emergencyContactName: p.emergency_contact_name as string | undefined,
          emergencyContactPhone: p.emergency_contact_phone as string | undefined,
          emergencyContactRelationship: p.emergency_contact_relationship as string | undefined,
          status: p.status as 'active' | 'inactive' | 'archived',
          tags: (p.tags as string[]) ?? [],
          assignedClinicianId: p.assigned_clinician_id as string | undefined,
          createdAt: p.created_at as string,
          updatedAt: p.updated_at as string,
          createdBy: p.created_by as string | undefined,
          alertCount: patientAlerts.length,
          lastActivity: p.updated_at as string,
          latestAlert: latestAlertRow ? {
            id: latestAlertRow.id as string,
            patientId: latestAlertRow.patient_id as string,
            triggerType: latestAlertRow.trigger_type as AlertEvent['triggerType'],
            triggerData: (latestAlertRow.trigger_data as Record<string, unknown>) ?? {},
            title: latestAlertRow.title as string,
            message: latestAlertRow.message as string,
            severity: latestAlertRow.severity as AlertEvent['severity'],
            status: latestAlertRow.status as AlertEvent['status'],
            createdAt: latestAlertRow.created_at as string,
          } : undefined,
        };
      });

      if (input.hasAlerts === true) {
        result = result.filter((p) => p.alertCount > 0);
      } else if (input.hasAlerts === false) {
        result = result.filter((p) => p.alertCount === 0);
      }

      result.sort((a, b) => {
        switch (input.sortBy) {
          case 'name':
            return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
          case 'alertCount':
            return b.alertCount - a.alertCount;
          case 'lastActivity':
          default:
            return new Date(b.lastActivity || b.updatedAt).getTime() - new Date(a.lastActivity || a.updatedAt).getTime();
        }
      });

      return result;
    }),

  getPatientOverview: protectedProcedure
    .input(z.object({ patientId: z.string() }))
    .query(
      async ({
        ctx,
        input,
      }): Promise<{
        patient: Patient | null;
        alertCount: number;
        labCount: number;
        biometricCount: number;
        lastLabDate?: string;
        lastBiometricDate?: string;
        recentAlerts: AlertEvent[];
        timeline: TimelineEvent[];
      }> => {
        console.log('[Dashboard] Getting patient overview');
        const sb = createServerSupabaseClient(ctx.sessionToken);

        const [patientRes, alertsRes, labResultsRes, bioReadingsRes, labDocsRes] = await Promise.all([
          sb.from('clinic_patients').select('*').eq('id', input.patientId).single(),
          sb.from('clinic_alert_events').select('*').eq('patient_id', input.patientId).order('created_at', { ascending: false }).limit(20),
          sb.from('clinic_lab_results').select('id,result_date,created_at').eq('patient_id', input.patientId).order('result_date', { ascending: false }),
          sb.from('clinic_biometric_readings').select('id,reading_time,created_at').eq('patient_id', input.patientId).order('reading_time', { ascending: false }),
          sb.from('clinic_lab_documents').select('id,panel_name,file_name,uploaded_at').eq('patient_id', input.patientId).order('uploaded_at', { ascending: false }).limit(10),
        ]);

        let patient: Patient | null = null;
        if (patientRes.data) {
          const p = patientRes.data;
          patient = {
            id: p.id, firstName: p.first_name, lastName: p.last_name,
            dateOfBirth: p.date_of_birth, sex: p.sex,
            email: p.email, phone: p.phone,
            addressLine1: p.address_line1, addressLine2: p.address_line2,
            city: p.city, state: p.state, zipCode: p.zip_code,
            country: p.country,
            emergencyContactName: p.emergency_contact_name,
            emergencyContactPhone: p.emergency_contact_phone,
            emergencyContactRelationship: p.emergency_contact_relationship,
            status: p.status, tags: p.tags ?? [],
            assignedClinicianId: p.assigned_clinician_id,
            createdAt: p.created_at, updatedAt: p.updated_at,
            createdBy: p.created_by,
          };
        }

        const allAlerts = alertsRes.data ?? [];
        const activeAlerts = allAlerts.filter((a: Record<string, unknown>) => a.status === 'new' || a.status === 'viewed');
        const labResults = labResultsRes.data ?? [];
        const bioReadings = bioReadingsRes.data ?? [];

        const recentAlerts: AlertEvent[] = activeAlerts.slice(0, 5).map((a: Record<string, unknown>) => ({
          id: a.id as string,
          ruleId: a.rule_id as string | undefined,
          patientId: a.patient_id as string,
          triggerType: a.trigger_type as AlertEvent['triggerType'],
          triggerData: (a.trigger_data as Record<string, unknown>) ?? {},
          title: a.title as string,
          message: a.message as string,
          severity: a.severity as AlertEvent['severity'],
          status: a.status as AlertEvent['status'],
          createdAt: a.created_at as string,
        }));

        const timeline: TimelineEvent[] = [];

        (labDocsRes.data ?? []).forEach((doc: Record<string, unknown>) => {
          timeline.push({
            id: doc.id as string,
            type: 'lab_upload',
            title: 'Lab uploaded',
            description: (doc.panel_name as string) || (doc.file_name as string),
            date: doc.uploaded_at as string,
          });
        });

        allAlerts.slice(0, 10).forEach((alert: Record<string, unknown>) => {
          timeline.push({
            id: alert.id as string,
            type: 'alert',
            title: alert.title as string,
            description: alert.message as string,
            date: alert.created_at as string,
          });
        });

        timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return {
          patient,
          alertCount: activeAlerts.length,
          labCount: labResults.length,
          biometricCount: bioReadings.length,
          lastLabDate: labResults[0]?.result_date as string | undefined,
          lastBiometricDate: bioReadings[0]?.reading_time as string | undefined,
          recentAlerts,
          timeline: timeline.slice(0, 20),
        };
      }
    ),

  getAlertInbox: protectedProcedure
    .input(
      z.object({
        clinicianId: z.string().optional(),
        severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
        status: z.enum(['new', 'viewed', 'acknowledged', 'snoozed', 'resolved', 'dismissed']).optional(),
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(
      async ({
        ctx,
        input,
      }): Promise<{
        alerts: (AlertEvent & { patientName: string })[];
        total: number;
        page: number;
        totalPages: number;
      }> => {
        console.log('[Dashboard] Getting alert inbox');
        const sb = createServerSupabaseClient(ctx.sessionToken);

        let query = sb.from('clinic_alert_events').select('*', { count: 'exact' });

        if (input.severity) query = query.eq('severity', input.severity);
        if (input.status) {
          query = query.eq('status', input.status);
        } else {
          query = query.in('status', ['new', 'viewed']);
        }

        const offset = (input.page - 1) * input.limit;
        query = query.order('severity').order('created_at', { ascending: false }).range(offset, offset + input.limit - 1);

        const { data, error, count } = await query;
        if (error) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to get alert inbox' });
        }

        const patientIds = [...new Set((data ?? []).map((a: Record<string, unknown>) => a.patient_id as string))];
        const nameMap = new Map<string, string>();
        if (patientIds.length > 0) {
          const { data: patients } = await sb.from('clinic_patients').select('id,first_name,last_name').in('id', patientIds);
          (patients ?? []).forEach((p: Record<string, unknown>) => {
            nameMap.set(p.id as string, `${String(p.first_name)} ${String(p.last_name)}`);
          });
        }

        const total = count ?? 0;
        const alerts = (data ?? []).map((a: Record<string, unknown>) => ({
          id: a.id as string,
          ruleId: a.rule_id as string | undefined,
          patientId: a.patient_id as string,
          triggerType: a.trigger_type as AlertEvent['triggerType'],
          triggerData: (a.trigger_data as Record<string, unknown>) ?? {},
          title: a.title as string,
          message: a.message as string,
          severity: a.severity as AlertEvent['severity'],
          status: a.status as AlertEvent['status'],
          acknowledgedAt: a.acknowledged_at as string | undefined,
          acknowledgedBy: a.acknowledged_by as string | undefined,
          acknowledgmentNotes: a.acknowledgment_notes as string | undefined,
          snoozedUntil: a.snoozed_until as string | undefined,
          resolvedAt: a.resolved_at as string | undefined,
          resolvedBy: a.resolved_by as string | undefined,
          resolutionNotes: a.resolution_notes as string | undefined,
          createdAt: a.created_at as string,
          patientName: nameMap.get(a.patient_id as string) ?? 'Unknown',
        }));

        return {
          alerts,
          total,
          page: input.page,
          totalPages: Math.ceil(total / input.limit),
        };
      }
    ),
});
