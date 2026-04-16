import { z } from 'zod';

export const MenstrualStatusSchema = z.enum(['pre_menopause', 'peri_menopause', 'post_menopause', 'na']);
export const FitnessLevelSchema = z.enum(['sedentary', 'recreational', 'athletic', 'elite']);
export const DietTypeSchema = z.enum(['carnivore', 'paleo', 'keto', 'mediterranean', 'vegan', 'standard', 'other']);
export const SexSchema = z.enum(['female', 'male', 'other']);
export const LongevityStatusSchema = z.enum(['draft', 'pending_review', 'approved', 'active', 'completed', 'archived']);

export const IntakeInputSchema = z.object({
  biologicalAge: z.number().optional(),
  chronologicalAge: z.number().int().min(0).max(120).optional(),
  weightCurrent: z.number().optional(),
  weightIdeal: z.number().optional(),
  height: z.number().optional(),
  sex: SexSchema.optional(),
  menstrualStatus: MenstrualStatusSchema.optional(),
  bodyComposition: z.record(z.string(), z.number()).optional(),
  fitnessLevel: FitnessLevelSchema.optional(),
  dietType: DietTypeSchema.optional(),
  conditions: z.array(z.string()).default([]),
  sensitivities: z.array(z.string()).default([]),
  oppositions: z.array(z.string()).default([]),
  longevityGoals: z.array(z.string()).default([]),
  preferredBrands: z.array(z.string()).default([]),
  modalities: z.array(z.string()).default([]),
  topComplaints: z.array(z.string()).default([]),
  lifestyleFactors: z.array(z.string()).default([]),
  labs: z.record(z.string(), z.any()).optional(),
  notes: z.string().optional(),
});

export type IntakeInput = z.infer<typeof IntakeInputSchema>;
