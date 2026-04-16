import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../../create-context';
import { createServerSupabaseClient } from '../../../supabase-server';
import { IntakeInputSchema, LongevityStatusSchema } from './schemas';
import { generateProtocolFromIntake } from './generator';

export const longevityRouter = createTRPCRouter({
  // ── Intake management ───────────────────────────────────────

  createIntake: protectedProcedure
    .input(IntakeInputSchema)
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('longevity_intakes')
        .insert({
          user_id: ctx.user.id,
          biological_age: input.biologicalAge,
          chronological_age: input.chronologicalAge,
          weight_current: input.weightCurrent,
          weight_ideal: input.weightIdeal,
          height: input.height,
          sex: input.sex,
          menstrual_status: input.menstrualStatus,
          body_composition: input.bodyComposition,
          fitness_level: input.fitnessLevel,
          diet_type: input.dietType,
          conditions: input.conditions,
          sensitivities: input.sensitivities,
          oppositions: input.oppositions,
          longevity_goals: input.longevityGoals,
          preferred_brands: input.preferredBrands,
          modalities: input.modalities,
          top_complaints: input.topComplaints,
          lifestyle_factors: input.lifestyleFactors,
          labs: input.labs ?? {},
          notes: input.notes,
        })
        .select()
        .single();

      if (error || !data) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create intake' });
      return data;
    }),

  updateIntake: protectedProcedure
    .input(z.object({
      intakeId: z.string().uuid(),
      data: IntakeInputSchema.partial(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const dbUpdates: Record<string, any> = {};
      const d = input.data;
      if (d.biologicalAge !== undefined) dbUpdates.biological_age = d.biologicalAge;
      if (d.chronologicalAge !== undefined) dbUpdates.chronological_age = d.chronologicalAge;
      if (d.weightCurrent !== undefined) dbUpdates.weight_current = d.weightCurrent;
      if (d.weightIdeal !== undefined) dbUpdates.weight_ideal = d.weightIdeal;
      if (d.height !== undefined) dbUpdates.height = d.height;
      if (d.sex !== undefined) dbUpdates.sex = d.sex;
      if (d.menstrualStatus !== undefined) dbUpdates.menstrual_status = d.menstrualStatus;
      if (d.fitnessLevel !== undefined) dbUpdates.fitness_level = d.fitnessLevel;
      if (d.dietType !== undefined) dbUpdates.diet_type = d.dietType;
      if (d.conditions !== undefined) dbUpdates.conditions = d.conditions;
      if (d.sensitivities !== undefined) dbUpdates.sensitivities = d.sensitivities;
      if (d.oppositions !== undefined) dbUpdates.oppositions = d.oppositions;
      if (d.longevityGoals !== undefined) dbUpdates.longevity_goals = d.longevityGoals;
      if (d.preferredBrands !== undefined) dbUpdates.preferred_brands = d.preferredBrands;
      if (d.modalities !== undefined) dbUpdates.modalities = d.modalities;
      if (d.topComplaints !== undefined) dbUpdates.top_complaints = d.topComplaints;
      if (d.lifestyleFactors !== undefined) dbUpdates.lifestyle_factors = d.lifestyleFactors;
      if (d.labs !== undefined) dbUpdates.labs = d.labs;
      if (d.notes !== undefined) dbUpdates.notes = d.notes;

      const { data, error } = await sb
        .from('longevity_intakes')
        .update(dbUpdates)
        .eq('id', input.intakeId)
        .eq('user_id', ctx.user.id)
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update intake' });
      return data;
    }),

  getLatestIntake: protectedProcedure
    .query(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('longevity_intakes')
        .select('*')
        .eq('user_id', ctx.user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    }),

  getIntake: protectedProcedure
    .input(z.object({ intakeId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('longevity_intakes')
        .select('*')
        .eq('id', input.intakeId)
        .single();
      if (error || !data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Intake not found' });
      return data;
    }),

  // ── Protocol generation ─────────────────────────────────────

  generateProtocol: protectedProcedure
    .input(z.object({ intakeId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);

      // 1. Fetch intake
      const { data: intakeRow, error: intakeError } = await sb
        .from('longevity_intakes')
        .select('*')
        .eq('id', input.intakeId)
        .single();

      if (intakeError || !intakeRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Intake not found' });
      }

      // 2. Build intake input for generator
      const intakeInput = {
        biologicalAge: intakeRow.biological_age,
        chronologicalAge: intakeRow.chronological_age,
        weightCurrent: intakeRow.weight_current,
        weightIdeal: intakeRow.weight_ideal,
        height: intakeRow.height,
        sex: intakeRow.sex as any,
        menstrualStatus: intakeRow.menstrual_status as any,
        bodyComposition: intakeRow.body_composition,
        fitnessLevel: intakeRow.fitness_level as any,
        dietType: intakeRow.diet_type as any,
        conditions: intakeRow.conditions ?? [],
        sensitivities: intakeRow.sensitivities ?? [],
        oppositions: intakeRow.oppositions ?? [],
        longevityGoals: intakeRow.longevity_goals ?? [],
        preferredBrands: intakeRow.preferred_brands ?? [],
        modalities: intakeRow.modalities ?? [],
        topComplaints: intakeRow.top_complaints ?? [],
        lifestyleFactors: intakeRow.lifestyle_factors ?? [],
        labs: intakeRow.labs ?? {},
        notes: intakeRow.notes,
      };

      // 3. Generate protocol (deterministic; swap with Anthropic API call here if desired)
      const generated = generateProtocolFromIntake(intakeInput);

      // 4. Find the next version number
      const { data: existing } = await sb
        .from('longevity_protocols')
        .select('version')
        .eq('intake_id', input.intakeId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersion = (existing?.version ?? 0) + 1;

      // 5. Determine initial status
      const needsReview = generated.practitionerReviewRequired.length > 0;
      const initialStatus = needsReview ? 'pending_review' : 'draft';

      // 6. Save
      const { data: savedProtocol, error: saveError } = await sb
        .from('longevity_protocols')
        .insert({
          intake_id: input.intakeId,
          user_id: ctx.user.id,
          version: nextVersion,
          months: generated.months,
          summary: generated.summary,
          pulsing_calendar: generated.pulsingCalendar,
          safety_notes: generated.safetyNotes,
          practitioner_review_required: generated.practitionerReviewRequired,
          status: initialStatus,
        })
        .select()
        .single();

      if (saveError || !savedProtocol) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to save protocol' });
      }

      return savedProtocol;
    }),

  // ── Protocol retrieval ──────────────────────────────────────

  getProtocol: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('longevity_protocols')
        .select('*')
        .eq('id', input.protocolId)
        .single();
      if (error || !data) throw new TRPCError({ code: 'NOT_FOUND', message: 'Protocol not found' });
      return data;
    }),

  getLatestProtocol: protectedProcedure
    .query(async ({ ctx }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('longevity_protocols')
        .select('*')
        .eq('user_id', ctx.user.id)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    }),

  listProtocols: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('longevity_protocols')
        .select('*')
        .eq('user_id', ctx.user.id)
        .order('generated_at', { ascending: false })
        .limit(input?.limit ?? 10);
      return data ?? [];
    }),

  updateProtocolStatus: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      status: LongevityStatusSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const updates: Record<string, any> = { status: input.status };
      if (input.status === 'active') updates.started_at = new Date().toISOString();
      if (input.status === 'completed' || input.status === 'archived') updates.completed_at = new Date().toISOString();

      const { data, error } = await sb
        .from('longevity_protocols')
        .update(updates)
        .eq('id', input.protocolId)
        .eq('user_id', ctx.user.id)
        .select()
        .single();

      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update status' });
      return data;
    }),

  // ── Practitioner actions ────────────────────────────────────

  addPractitionerNotes: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid(), notes: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('longevity_protocols')
        .update({ practitioner_notes: input.notes })
        .eq('id', input.protocolId)
        .select()
        .single();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add notes' });
      return data;
    }),

  approveProtocol: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('longevity_protocols')
        .update({
          practitioner_approved: true,
          approved_at: new Date().toISOString(),
          approved_by: ctx.user.id,
          status: 'approved',
        })
        .eq('id', input.protocolId)
        .select()
        .single();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to approve protocol' });
      return data;
    }),

  // ── Progress tracking ───────────────────────────────────────

  logProgress: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      month: z.number().int().min(1).max(6),
      day: z.number().int().optional(),
      itemKey: z.string(),
      itemCategory: z.enum(['supplement', 'peptide', 'fasting', 'exercise', 'modality', 'lifestyle', 'lab']).optional(),
      taken: z.boolean(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data, error } = await sb
        .from('longevity_protocol_progress')
        .insert({
          protocol_id: input.protocolId,
          user_id: ctx.user.id,
          month: input.month,
          day: input.day,
          item_key: input.itemKey,
          item_category: input.itemCategory,
          taken: input.taken,
          notes: input.notes,
        })
        .select()
        .single();
      if (error) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to log progress' });
      return data;
    }),

  getProgress: protectedProcedure
    .input(z.object({
      protocolId: z.string().uuid(),
      month: z.number().int().min(1).max(6).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      let query = sb
        .from('longevity_protocol_progress')
        .select('*')
        .eq('protocol_id', input.protocolId)
        .eq('user_id', ctx.user.id)
        .order('logged_at', { ascending: false });

      if (input.month) query = query.eq('month', input.month);

      const { data } = await query;
      return data ?? [];
    }),

  getProgressStats: protectedProcedure
    .input(z.object({ protocolId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const sb = createServerSupabaseClient(ctx.sessionToken);
      const { data } = await sb
        .from('longevity_protocol_progress')
        .select('month, item_category, taken')
        .eq('protocol_id', input.protocolId)
        .eq('user_id', ctx.user.id);

      const rows = data ?? [];
      const total = rows.length;
      const taken = rows.filter((r: any) => r.taken).length;

      const byMonth: Record<number, { total: number; taken: number }> = {};
      for (const row of rows) {
        const m = (row as any).month;
        if (!byMonth[m]) byMonth[m] = { total: 0, taken: 0 };
        byMonth[m].total++;
        if ((row as any).taken) byMonth[m].taken++;
      }

      return {
        total,
        taken,
        adherencePercent: total > 0 ? Math.round((taken / total) * 100) : 0,
        byMonth: Object.entries(byMonth).map(([month, stats]) => ({
          month: Number(month),
          total: stats.total,
          taken: stats.taken,
          percent: stats.total > 0 ? Math.round((stats.taken / stats.total) * 100) : 0,
        })),
      };
    }),
});
