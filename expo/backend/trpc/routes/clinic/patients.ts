import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, createTRPCRouter } from "../../create-context";
import { createServerSupabaseClient } from "../../../supabase-server";
import type {
  Patient,
  PatientHealthHistory,
  PaginatedResponse,
  PatientTimeline,
  TimelineEvent,
} from "@/types/clinic";
import { mapDbToPatient, mapDbToHealthHistory } from "./utils";

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

export const patientsRouter = createTRPCRouter({
  list: protectedProcedure
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
    .query(async ({ ctx, input }): Promise<PaginatedResponse<Patient>> => {
      console.log('[Patients] Listing patients, page:', input.page);
      const sb = createServerSupabaseClient(ctx.sessionToken);

      let query = sb.from('clinic_patients').select('*', { count: 'exact' });

      if (input.search) {
        query = query.or(
          `first_name.ilike.%${input.search}%,last_name.ilike.%${input.search}%,email.ilike.%${input.search}%`
        );
      }

      if (input.status) {
        query = query.eq('status', input.status);
      }

      if (input.assignedClinicianId) {
        query = query.eq('assigned_clinician_id', input.assignedClinicianId);
      }

      const offset = (input.page - 1) * input.limit;
      query = query.order('updated_at', { ascending: false }).range(offset, offset + input.limit - 1);

      const { data, error, count } = await query;

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list patients' });
      }

      const total = count ?? 0;
      let patients = (data ?? []).map(mapDbToPatient);

      if (input.tags && input.tags.length > 0) {
        patients = patients.filter((p) =>
          input.tags!.some((tag) => p.tags.includes(tag))
        );
      }

      return {
        data: patients,
        total,
        page: input.page,
        limit: input.limit,
        totalPages: Math.ceil(total / input.limit),
      };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }): Promise<Patient | null> => {
      console.log('[Patients] Getting patient by ID');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from('clinic_patients')
        .select('*')
        .eq('id', input.id)
        .single();

      if (error) return null;
      return mapDbToPatient(data);
    }),

  create: protectedProcedure
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
    .mutation(async ({ ctx, input }): Promise<Patient> => {
      console.log('[Patients] Creating new patient');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from('clinic_patients')
        .insert({
          clinician_id: ctx.user.id,
          first_name: input.firstName,
          last_name: input.lastName,
          date_of_birth: input.dateOfBirth,
          sex: input.sex,
          email: input.email,
          phone: input.phone,
          address_line1: input.addressLine1,
          address_line2: input.addressLine2,
          city: input.city,
          state: input.state,
          zip_code: input.zipCode,
          country: input.country,
          emergency_contact_name: input.emergencyContactName,
          emergency_contact_phone: input.emergencyContactPhone,
          emergency_contact_relationship: input.emergencyContactRelationship,
          tags: input.tags,
          assigned_clinician_id: input.assignedClinicianId,
          created_by: ctx.user.id,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create patient' });
      }

      const patient = mapDbToPatient(data);

      await sb.from('clinic_health_histories').insert({
        clinician_id: ctx.user.id,
        patient_id: patient.id,
      });

      console.log('[Patients] Patient created successfully');
      return patient;
    }),

  update: protectedProcedure
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
    .mutation(async ({ ctx, input }): Promise<Patient> => {
      console.log('[Patients] Updating patient');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { id, ...rest } = input;
      const updateData: Record<string, unknown> = {};
      if (rest.firstName !== undefined) updateData.first_name = rest.firstName;
      if (rest.lastName !== undefined) updateData.last_name = rest.lastName;
      if (rest.dateOfBirth !== undefined) updateData.date_of_birth = rest.dateOfBirth;
      if (rest.sex !== undefined) updateData.sex = rest.sex;
      if (rest.email !== undefined) updateData.email = rest.email;
      if (rest.phone !== undefined) updateData.phone = rest.phone;
      if (rest.addressLine1 !== undefined) updateData.address_line1 = rest.addressLine1;
      if (rest.addressLine2 !== undefined) updateData.address_line2 = rest.addressLine2;
      if (rest.city !== undefined) updateData.city = rest.city;
      if (rest.state !== undefined) updateData.state = rest.state;
      if (rest.zipCode !== undefined) updateData.zip_code = rest.zipCode;
      if (rest.country !== undefined) updateData.country = rest.country;
      if (rest.emergencyContactName !== undefined) updateData.emergency_contact_name = rest.emergencyContactName;
      if (rest.emergencyContactPhone !== undefined) updateData.emergency_contact_phone = rest.emergencyContactPhone;
      if (rest.emergencyContactRelationship !== undefined) updateData.emergency_contact_relationship = rest.emergencyContactRelationship;
      if (rest.status !== undefined) updateData.status = rest.status;
      if (rest.tags !== undefined) updateData.tags = rest.tags;
      if (rest.assignedClinicianId !== undefined) updateData.assigned_clinician_id = rest.assignedClinicianId;

      const { data, error } = await sb
        .from('clinic_patients')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Patient not found' });
      }

      console.log('[Patients] Patient updated successfully');
      return mapDbToPatient(data);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }): Promise<{ success: boolean }> => {
      console.log('[Patients] Archiving patient');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { error } = await sb
        .from('clinic_patients')
        .update({ status: 'archived' })
        .eq('id', input.id);

      if (error) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Patient not found' });
      }

      console.log('[Patients] Patient archived successfully');
      return { success: true };
    }),

  getHealthHistory: protectedProcedure
    .input(z.object({ patientId: z.string() }))
    .query(async ({ ctx, input }): Promise<PatientHealthHistory | null> => {
      console.log('[Patients] Getting health history');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { data, error } = await sb
        .from('clinic_health_histories')
        .select('*')
        .eq('patient_id', input.patientId)
        .single();

      if (error) return null;
      return mapDbToHealthHistory(data);
    }),

  updateHealthHistory: protectedProcedure
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
    .mutation(async ({ ctx, input }): Promise<PatientHealthHistory> => {
      console.log('[Patients] Updating health history');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const { patientId, ...updates } = input;
      const updateData: Record<string, unknown> = {};
      if (updates.conditions !== undefined) updateData.conditions = updates.conditions;
      if (updates.pastConditions !== undefined) updateData.past_conditions = updates.pastConditions;
      if (updates.familyHistory !== undefined) updateData.family_history = updates.familyHistory;
      if (updates.currentMedications !== undefined) updateData.current_medications = updates.currentMedications;
      if (updates.pastMedications !== undefined) updateData.past_medications = updates.pastMedications;
      if (updates.allergies !== undefined) updateData.allergies = updates.allergies;
      if (updates.smokingStatus !== undefined) updateData.smoking_status = updates.smokingStatus;
      if (updates.alcoholUse !== undefined) updateData.alcohol_use = updates.alcoholUse;
      if (updates.exerciseFrequency !== undefined) updateData.exercise_frequency = updates.exerciseFrequency;
      if (updates.dietType !== undefined) updateData.diet_type = updates.dietType;
      if (updates.sleepHoursAvg !== undefined) updateData.sleep_hours_avg = updates.sleepHoursAvg;
      if (updates.stressLevel !== undefined) updateData.stress_level = updates.stressLevel;
      if (updates.pregnant !== undefined) updateData.pregnant = updates.pregnant;
      if (updates.nursing !== undefined) updateData.nursing = updates.nursing;
      if (updates.menstrualStatus !== undefined) updateData.menstrual_status = updates.menstrualStatus;
      updateData.updated_by = ctx.user.id;

      const { data, error } = await sb
        .from('clinic_health_histories')
        .upsert({
          clinician_id: ctx.user.id,
          patient_id: patientId,
          ...updateData,
        }, { onConflict: 'patient_id' })
        .select()
        .single();

      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update health history' });
      }

      console.log('[Patients] Health history updated successfully');
      return mapDbToHealthHistory(data);
    }),

  getTimeline: protectedProcedure
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
    .query(async ({ ctx, input }): Promise<PatientTimeline> => {
      console.log('[Patients] Getting timeline');
      const sb = createServerSupabaseClient(ctx.sessionToken);

      const events: TimelineEvent[] = [];

      const [labDocs, labResults, bioReadings, alerts] = await Promise.all([
        sb.from('clinic_lab_documents').select('id,panel_name,file_name,uploaded_at').eq('patient_id', input.patientId).order('uploaded_at', { ascending: false }).limit(20),
        sb.from('clinic_lab_results').select('id,value,unit,status,result_date,created_at').eq('patient_id', input.patientId).order('created_at', { ascending: false }).limit(20),
        sb.from('clinic_biometric_readings').select('id,value,unit,status,reading_time,created_at').eq('patient_id', input.patientId).order('created_at', { ascending: false }).limit(20),
        sb.from('clinic_alert_events').select('id,title,message,created_at').eq('patient_id', input.patientId).order('created_at', { ascending: false }).limit(20),
      ]);

      (labDocs.data ?? []).forEach((doc: Record<string, unknown>) => {
        events.push({
          id: doc.id as string,
          type: 'lab_upload',
          title: 'Lab uploaded',
          description: (doc.panel_name as string) || (doc.file_name as string),
          date: doc.uploaded_at as string,
        });
      });

      (labResults.data ?? []).forEach((r: Record<string, unknown>) => {
        events.push({
          id: r.id as string,
          type: 'lab_result',
          title: 'Lab result',
          description: `${String(r.value)} ${String(r.unit)} (${String(r.status)})`,
          date: r.created_at as string,
        });
      });

      (bioReadings.data ?? []).forEach((r: Record<string, unknown>) => {
        events.push({
          id: r.id as string,
          type: 'biometric',
          title: 'Biometric reading',
          description: `${String(r.value)} ${String(r.unit)}`,
          date: r.reading_time as string,
        });
      });

      (alerts.data ?? []).forEach((a: Record<string, unknown>) => {
        events.push({
          id: a.id as string,
          type: 'alert',
          title: a.title as string,
          description: a.message as string,
          date: a.created_at as string,
        });
      });

      events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return {
        patientId: input.patientId,
        events: events.slice(0, input.limit),
      };
    }),

  exportRecord: protectedProcedure
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
      async ({ ctx, input }): Promise<{ downloadUrl: string; expiresAt: string }> => {
        const sb = createServerSupabaseClient(ctx.sessionToken);
        const { data: patient } = await sb
          .from('clinic_patients')
          .select('id')
          .eq('id', input.patientId)
          .eq('clinician_id', ctx.user.id)
          .maybeSingle();
        if (!patient) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Patient not found or access denied' });
        }
        console.log('[Patients] Exporting patient record');
        return {
          downloadUrl: `https://example.com/exports/pending`,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        };
      }
    ),

  getTags: protectedProcedure.query(async ({ ctx }): Promise<string[]> => {
    console.log('[Patients] Getting all patient tags');
    const sb = createServerSupabaseClient(ctx.sessionToken);

    const { data } = await sb.from('clinic_patients').select('tags').eq('clinician_id', ctx.user.id);

    const tagsSet = new Set<string>();
    (data ?? []).forEach((row: Record<string, unknown>) => {
      const tags = row.tags as string[] | null;
      (tags ?? []).forEach((tag: string) => tagsSet.add(tag));
    });
    return Array.from(tagsSet).sort();
  }),
});
