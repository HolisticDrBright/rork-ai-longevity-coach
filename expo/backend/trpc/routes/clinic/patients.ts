import { z } from "zod";
import { publicProcedure, createTRPCRouter } from "../../create-context";
import type {
  Patient,
  PatientHealthHistory,
  PaginatedResponse,
  PatientTimeline,
  TimelineEvent,
  Medication,
  Allergy,
} from "@/types/clinic";

const medicationSchema = z.object({
  name: z.string(),
  dose: z.string(),
  frequency: z.string(),
  prescriber: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const allergySchema = z.object({
  allergen: z.string(),
  reaction: z.string(),
  severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening']),
});

const patientStore: Map<string, Patient> = new Map();
const healthHistoryStore: Map<string, PatientHealthHistory> = new Map();

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export const patientsRouter = createTRPCRouter({
  list: publicProcedure
    .input(
      z.object({
        page: z.number().min(1).default(1),
        limit: z.number().min(1).max(100).default(20),
        search: z.string().optional(),
        status: z.enum(['active', 'inactive', 'archived']).optional(),
        tags: z.array(z.string()).optional(),
        assignedClinicianId: z.string().optional(),
        hasAlerts: z.boolean().optional(),
      })
    )
    .query(async ({ input }): Promise<PaginatedResponse<Patient>> => {
      console.log('[Patients] Listing patients with filters:', input);
      
      let patients = Array.from(patientStore.values());

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

      if (input.tags && input.tags.length > 0) {
        patients = patients.filter((p) =>
          input.tags!.some((tag) => p.tags.includes(tag))
        );
      }

      if (input.assignedClinicianId) {
        patients = patients.filter(
          (p) => p.assignedClinicianId === input.assignedClinicianId
        );
      }

      patients.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      const total = patients.length;
      const totalPages = Math.ceil(total / input.limit);
      const startIndex = (input.page - 1) * input.limit;
      const paginatedPatients = patients.slice(
        startIndex,
        startIndex + input.limit
      );

      return {
        data: paginatedPatients,
        total,
        page: input.page,
        limit: input.limit,
        totalPages,
      };
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }): Promise<Patient | null> => {
      console.log('[Patients] Getting patient by ID:', input.id);
      return patientStore.get(input.id) || null;
    }),

  create: publicProcedure
    .input(
      z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        dateOfBirth: z.string(),
        sex: z.enum(['male', 'female', 'other']),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        addressLine1: z.string().optional(),
        addressLine2: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zipCode: z.string().optional(),
        country: z.string().default('US'),
        emergencyContactName: z.string().optional(),
        emergencyContactPhone: z.string().optional(),
        emergencyContactRelationship: z.string().optional(),
        tags: z.array(z.string()).default([]),
        assignedClinicianId: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<Patient> => {
      console.log('[Patients] Creating new patient:', input.firstName, input.lastName);
      
      const now = new Date().toISOString();
      const patient: Patient = {
        id: generateId(),
        ...input,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      patientStore.set(patient.id, patient);

      const healthHistory: PatientHealthHistory = {
        id: generateId(),
        patientId: patient.id,
        conditions: [],
        pastConditions: [],
        familyHistory: [],
        currentMedications: [],
        pastMedications: [],
        allergies: [],
        pregnant: false,
        nursing: false,
        updatedAt: now,
      };
      healthHistoryStore.set(patient.id, healthHistory);

      console.log('[Patients] Patient created successfully:', patient.id);
      return patient;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
        dateOfBirth: z.string().optional(),
        sex: z.enum(['male', 'female', 'other']).optional(),
        email: z.string().email().optional().nullable(),
        phone: z.string().optional().nullable(),
        addressLine1: z.string().optional().nullable(),
        addressLine2: z.string().optional().nullable(),
        city: z.string().optional().nullable(),
        state: z.string().optional().nullable(),
        zipCode: z.string().optional().nullable(),
        country: z.string().optional(),
        emergencyContactName: z.string().optional().nullable(),
        emergencyContactPhone: z.string().optional().nullable(),
        emergencyContactRelationship: z.string().optional().nullable(),
        status: z.enum(['active', 'inactive', 'archived']).optional(),
        tags: z.array(z.string()).optional(),
        assignedClinicianId: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ input }): Promise<Patient> => {
      console.log('[Patients] Updating patient:', input.id);
      
      const existing = patientStore.get(input.id);
      if (!existing) {
        throw new Error('Patient not found');
      }

      const { id, ...updates } = input;
      const cleanedUpdates = Object.fromEntries(
        Object.entries(updates).filter(([_, v]) => v !== undefined)
      );

      const updated: Patient = {
        ...existing,
        ...cleanedUpdates,
        updatedAt: new Date().toISOString(),
      };

      patientStore.set(id, updated);
      console.log('[Patients] Patient updated successfully:', id);
      return updated;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }): Promise<{ success: boolean }> => {
      console.log('[Patients] Archiving patient:', input.id);
      
      const existing = patientStore.get(input.id);
      if (!existing) {
        throw new Error('Patient not found');
      }

      existing.status = 'archived';
      existing.updatedAt = new Date().toISOString();
      patientStore.set(input.id, existing);

      console.log('[Patients] Patient archived successfully:', input.id);
      return { success: true };
    }),

  getHealthHistory: publicProcedure
    .input(z.object({ patientId: z.string() }))
    .query(async ({ input }): Promise<PatientHealthHistory | null> => {
      console.log('[Patients] Getting health history for patient:', input.patientId);
      return healthHistoryStore.get(input.patientId) || null;
    }),

  updateHealthHistory: publicProcedure
    .input(
      z.object({
        patientId: z.string(),
        conditions: z.array(z.string()).optional(),
        pastConditions: z.array(z.string()).optional(),
        familyHistory: z.array(z.string()).optional(),
        currentMedications: z.array(medicationSchema).optional(),
        pastMedications: z.array(medicationSchema).optional(),
        allergies: z.array(allergySchema).optional(),
        smokingStatus: z.string().optional().nullable(),
        alcoholUse: z.string().optional().nullable(),
        exerciseFrequency: z.string().optional().nullable(),
        dietType: z.string().optional().nullable(),
        sleepHoursAvg: z.number().optional().nullable(),
        stressLevel: z.number().min(1).max(10).optional().nullable(),
        pregnant: z.boolean().optional(),
        nursing: z.boolean().optional(),
        menstrualStatus: z.string().optional().nullable(),
      })
    )
    .mutation(async ({ input }): Promise<PatientHealthHistory> => {
      console.log('[Patients] Updating health history for patient:', input.patientId);
      
      let existing = healthHistoryStore.get(input.patientId);
      if (!existing) {
        existing = {
          id: generateId(),
          patientId: input.patientId,
          conditions: [],
          pastConditions: [],
          familyHistory: [],
          currentMedications: [],
          pastMedications: [],
          allergies: [],
          pregnant: false,
          nursing: false,
          updatedAt: new Date().toISOString(),
        };
      }

      const { patientId, ...updates } = input;
      const cleanedUpdates = Object.fromEntries(
        Object.entries(updates).filter(([_, v]) => v !== undefined)
      );

      const updated: PatientHealthHistory = {
        ...existing,
        ...cleanedUpdates,
        updatedAt: new Date().toISOString(),
      };

      healthHistoryStore.set(patientId, updated);
      console.log('[Patients] Health history updated successfully');
      return updated;
    }),

  getTimeline: publicProcedure
    .input(
      z.object({
        patientId: z.string(),
        limit: z.number().min(1).max(100).default(50),
        types: z
          .array(
            z.enum([
              'lab_upload',
              'lab_result',
              'biometric',
              'encounter',
              'care_plan',
              'alert',
            ])
          )
          .optional(),
      })
    )
    .query(async ({ input }): Promise<PatientTimeline> => {
      console.log('[Patients] Getting timeline for patient:', input.patientId);
      
      const events: TimelineEvent[] = [];

      events.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      return {
        patientId: input.patientId,
        events: events.slice(0, input.limit),
      };
    }),

  exportRecord: publicProcedure
    .input(
      z.object({
        patientId: z.string(),
        format: z.enum(['json', 'pdf']).default('json'),
        sections: z
          .array(
            z.enum([
              'demographics',
              'health_history',
              'encounters',
              'labs',
              'biometrics',
              'care_plans',
            ])
          )
          .optional(),
      })
    )
    .mutation(
      async ({
        input,
      }): Promise<{ downloadUrl: string; expiresAt: string }> => {
        console.log('[Patients] Exporting patient record:', input.patientId);
        
        return {
          downloadUrl: `https://example.com/exports/${input.patientId}`,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        };
      }
    ),

  getTags: publicProcedure.query(async (): Promise<string[]> => {
    console.log('[Patients] Getting all patient tags');
    
    const tagsSet = new Set<string>();
    patientStore.forEach((patient) => {
      patient.tags.forEach((tag) => tagsSet.add(tag));
    });
    return Array.from(tagsSet).sort();
  }),
});

export { patientStore, healthHistoryStore };
