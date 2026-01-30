import { z } from "zod";
import { publicProcedure, createTRPCRouter } from "../../create-context";
import type {
  DashboardStats,
  Patient,
  AlertEvent,
  TimelineEvent,
} from "@/types/clinic";
import { patientStore } from "./patients";
import { labDocumentStore, labResultStore } from "./labs";
import { biometricReadingStore } from "./biometrics";
import { alertEventStore, alertRuleStore } from "./alerts";

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

interface PatientWithAlerts extends Patient {
  alertCount: number;
  lastActivity?: string;
  latestAlert?: AlertEvent;
}

export const dashboardRouter = createTRPCRouter({
  getStats: publicProcedure
    .input(z.object({ clinicianId: z.string().optional() }))
    .query(async ({ input }): Promise<DashboardStats> => {
      console.log('[Dashboard] Getting stats');
      
      let patients = Array.from(patientStore.values());
      
      if (input.clinicianId) {
        patients = patients.filter(
          (p) => p.assignedClinicianId === input.clinicianId
        );
      }

      const activePatients = patients.filter((p) => p.status === 'active');

      const alerts = Array.from(alertEventStore.values());
      const criticalAlerts = alerts.filter(
        (a) =>
          a.severity === 'critical' &&
          (a.status === 'new' || a.status === 'viewed')
      );

      const pendingLabDocs = Array.from(labDocumentStore.values()).filter(
        (d) => d.processingStatus === 'pending'
      );

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString();

      const recentLabUploads = Array.from(labDocumentStore.values()).filter(
        (d) => d.uploadedAt >= todayStr
      );

      return {
        totalPatients: patients.length,
        activePatients: activePatients.length,
        criticalAlerts: criticalAlerts.length,
        pendingReviews: pendingLabDocs.length + criticalAlerts.length,
        recentLabUploads: recentLabUploads.length,
        todayEncounters: 0,
      };
    }),

  getRecentActivity: publicProcedure
    .input(
      z.object({
        clinicianId: z.string().optional(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }): Promise<RecentActivity[]> => {
      console.log('[Dashboard] Getting recent activity');
      
      const activities: RecentActivity[] = [];

      const getPatientName = (patientId: string): string => {
        const patient = patientStore.get(patientId);
        return patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown';
      };

      labDocumentStore.forEach((doc) => {
        activities.push({
          id: `lab_doc_${doc.id}`,
          type: 'lab_upload',
          patientId: doc.patientId,
          patientName: getPatientName(doc.patientId),
          title: 'Lab document uploaded',
          description: doc.panelName || doc.fileName,
          timestamp: doc.uploadedAt,
        });
      });

      labResultStore.forEach((result) => {
        activities.push({
          id: `lab_result_${result.id}`,
          type: 'lab_result',
          patientId: result.patientId,
          patientName: getPatientName(result.patientId),
          title: 'Lab result added',
          description: `${result.labTest?.name || 'Lab test'}: ${result.value} ${result.unit}`,
          timestamp: result.createdAt,
          severity: result.status.includes('critical') ? 'critical' : undefined,
        });
      });

      biometricReadingStore.forEach((reading) => {
        if (reading.status !== 'normal') {
          activities.push({
            id: `biometric_${reading.id}`,
            type: 'biometric',
            patientId: reading.patientId,
            patientName: getPatientName(reading.patientId),
            title: 'Abnormal reading logged',
            description: `${reading.biometricType?.name || 'Reading'}: ${reading.value} ${reading.unit}`,
            timestamp: reading.createdAt,
            severity: reading.status.includes('critical') ? 'critical' : 'warning',
          });
        }
      });

      alertEventStore.forEach((alert) => {
        activities.push({
          id: `alert_${alert.id}`,
          type: 'alert',
          patientId: alert.patientId,
          patientName: getPatientName(alert.patientId),
          title: alert.title,
          description: alert.message,
          timestamp: alert.createdAt,
          severity: alert.severity,
        });
      });

      patientStore.forEach((patient) => {
        activities.push({
          id: `patient_${patient.id}`,
          type: 'patient_created',
          patientId: patient.id,
          patientName: `${patient.firstName} ${patient.lastName}`,
          title: 'New patient added',
          timestamp: patient.createdAt,
        });
      });

      activities.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      return activities.slice(0, input.limit);
    }),

  getPendingReviews: publicProcedure
    .input(
      z.object({
        clinicianId: z.string().optional(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }): Promise<PendingReview[]> => {
      console.log('[Dashboard] Getting pending reviews');
      
      const reviews: PendingReview[] = [];

      const getPatientName = (patientId: string): string => {
        const patient = patientStore.get(patientId);
        return patient ? `${patient.firstName} ${patient.lastName}` : 'Unknown';
      };

      labDocumentStore.forEach((doc) => {
        if (doc.processingStatus === 'pending') {
          reviews.push({
            id: doc.id,
            type: 'lab_document',
            patientId: doc.patientId,
            patientName: getPatientName(doc.patientId),
            title: `Review lab: ${doc.panelName || doc.fileName}`,
            priority: 'medium',
            createdAt: doc.uploadedAt,
          });
        }
      });

      alertEventStore.forEach((alert) => {
        if (alert.status === 'new' || alert.status === 'viewed') {
          const priorityMap: Record<string, PendingReview['priority']> = {
            critical: 'critical',
            high: 'high',
            medium: 'medium',
            low: 'low',
            info: 'low',
          };

          reviews.push({
            id: alert.id,
            type: 'alert',
            patientId: alert.patientId,
            patientName: getPatientName(alert.patientId),
            title: alert.title,
            priority: priorityMap[alert.severity] || 'medium',
            createdAt: alert.createdAt,
          });
        }
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

  getPatientList: publicProcedure
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
    .query(async ({ input }): Promise<PatientWithAlerts[]> => {
      console.log('[Dashboard] Getting patient list with alerts');
      
      let patients = Array.from(patientStore.values());

      if (input.clinicianId) {
        patients = patients.filter(
          (p) => p.assignedClinicianId === input.clinicianId
        );
      }

      if (input.search) {
        const searchLower = input.search.toLowerCase();
        patients = patients.filter(
          (p) =>
            p.firstName.toLowerCase().includes(searchLower) ||
            p.lastName.toLowerCase().includes(searchLower) ||
            p.email?.toLowerCase().includes(searchLower)
        );
      }

      if (input.status) {
        patients = patients.filter((p) => p.status === input.status);
      }

      const patientsWithAlerts: PatientWithAlerts[] = patients.map((patient) => {
        const patientAlerts = Array.from(alertEventStore.values()).filter(
          (a) =>
            a.patientId === patient.id &&
            (a.status === 'new' || a.status === 'viewed')
        );

        const sortedAlerts = [...patientAlerts].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        const activities: string[] = [patient.updatedAt];
        
        labDocumentStore.forEach((doc) => {
          if (doc.patientId === patient.id) {
            activities.push(doc.uploadedAt);
          }
        });

        biometricReadingStore.forEach((reading) => {
          if (reading.patientId === patient.id) {
            activities.push(reading.createdAt);
          }
        });

        const lastActivity = activities.sort(
          (a, b) => new Date(b).getTime() - new Date(a).getTime()
        )[0];

        return {
          ...patient,
          alertCount: patientAlerts.length,
          lastActivity,
          latestAlert: sortedAlerts[0],
        };
      });

      if (input.hasAlerts !== undefined) {
        if (input.hasAlerts) {
          patientsWithAlerts.filter((p) => p.alertCount > 0);
        } else {
          patientsWithAlerts.filter((p) => p.alertCount === 0);
        }
      }

      patientsWithAlerts.sort((a, b) => {
        switch (input.sortBy) {
          case 'name':
            return `${a.lastName} ${a.firstName}`.localeCompare(
              `${b.lastName} ${b.firstName}`
            );
          case 'alertCount':
            return b.alertCount - a.alertCount;
          case 'lastActivity':
          default:
            return (
              new Date(b.lastActivity || b.updatedAt).getTime() -
              new Date(a.lastActivity || a.updatedAt).getTime()
            );
        }
      });

      return patientsWithAlerts.slice(0, input.limit);
    }),

  getPatientOverview: publicProcedure
    .input(z.object({ patientId: z.string() }))
    .query(
      async ({
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
        console.log('[Dashboard] Getting patient overview:', input.patientId);
        
        const patient = patientStore.get(input.patientId) || null;

        const alerts = Array.from(alertEventStore.values()).filter(
          (a) => a.patientId === input.patientId
        );
        const activeAlerts = alerts.filter(
          (a) => a.status === 'new' || a.status === 'viewed'
        );

        const labDocs = Array.from(labDocumentStore.values()).filter(
          (d) => d.patientId === input.patientId
        );

        const labResults = Array.from(labResultStore.values()).filter(
          (r) => r.patientId === input.patientId
        );

        const biometrics = Array.from(biometricReadingStore.values()).filter(
          (b) => b.patientId === input.patientId
        );

        const sortedLabResults = [...labResults].sort(
          (a, b) => new Date(b.resultDate).getTime() - new Date(a.resultDate).getTime()
        );

        const sortedBiometrics = [...biometrics].sort(
          (a, b) => new Date(b.readingTime).getTime() - new Date(a.readingTime).getTime()
        );

        const recentAlerts = [...activeAlerts]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 5)
          .map((a) => ({
            ...a,
            rule: a.ruleId ? alertRuleStore.get(a.ruleId) : undefined,
          }));

        const timeline: TimelineEvent[] = [];

        labDocs.forEach((doc) => {
          timeline.push({
            id: doc.id,
            type: 'lab_upload',
            title: 'Lab uploaded',
            description: doc.panelName || doc.fileName,
            date: doc.uploadedAt,
          });
        });

        labResults.slice(0, 10).forEach((result) => {
          timeline.push({
            id: result.id,
            type: 'lab_result',
            title: result.labTest?.name || 'Lab result',
            description: `${result.value} ${result.unit} (${result.status})`,
            date: result.createdAt,
          });
        });

        biometrics.slice(0, 10).forEach((reading) => {
          timeline.push({
            id: reading.id,
            type: 'biometric',
            title: reading.biometricType?.name || 'Reading',
            description: `${reading.value} ${reading.unit}`,
            date: reading.readingTime,
          });
        });

        alerts.slice(0, 10).forEach((alert) => {
          timeline.push({
            id: alert.id,
            type: 'alert',
            title: alert.title,
            description: alert.message,
            date: alert.createdAt,
          });
        });

        timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        return {
          patient,
          alertCount: activeAlerts.length,
          labCount: labResults.length,
          biometricCount: biometrics.length,
          lastLabDate: sortedLabResults[0]?.resultDate,
          lastBiometricDate: sortedBiometrics[0]?.readingTime,
          recentAlerts,
          timeline: timeline.slice(0, 20),
        };
      }
    ),

  getAlertInbox: publicProcedure
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
        input,
      }): Promise<{
        alerts: (AlertEvent & { patientName: string })[];
        total: number;
        page: number;
        totalPages: number;
      }> => {
        console.log('[Dashboard] Getting alert inbox');
        
        let alerts = Array.from(alertEventStore.values());

        if (input.clinicianId) {
          const assignedPatientIds = new Set(
            Array.from(patientStore.values())
              .filter((p) => p.assignedClinicianId === input.clinicianId)
              .map((p) => p.id)
          );
          alerts = alerts.filter((a) => assignedPatientIds.has(a.patientId));
        }

        if (input.severity) {
          alerts = alerts.filter((a) => a.severity === input.severity);
        }

        if (input.status) {
          alerts = alerts.filter((a) => a.status === input.status);
        } else {
          alerts = alerts.filter(
            (a) => a.status === 'new' || a.status === 'viewed'
          );
        }

        alerts.sort((a, b) => {
          const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
          if (severityOrder[a.severity] !== severityOrder[b.severity]) {
            return severityOrder[a.severity] - severityOrder[b.severity];
          }
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        const total = alerts.length;
        const totalPages = Math.ceil(total / input.limit);
        const startIndex = (input.page - 1) * input.limit;
        const paginatedAlerts = alerts.slice(startIndex, startIndex + input.limit);

        const alertsWithPatientName = paginatedAlerts.map((alert) => {
          const patient = patientStore.get(alert.patientId);
          return {
            ...alert,
            patientName: patient
              ? `${patient.firstName} ${patient.lastName}`
              : 'Unknown',
            rule: alert.ruleId ? alertRuleStore.get(alert.ruleId) : undefined,
          };
        });

        return {
          alerts: alertsWithPatientName,
          total,
          page: input.page,
          totalPages,
        };
      }
    ),
});
