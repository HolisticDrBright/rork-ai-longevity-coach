/**
 * Claude-powered longevity protocol generator.
 *
 * Uses @rork-ai/toolkit-sdk's generateObject() with a Zod schema that
 * matches the shape stored in `longevity_protocols` (months JSONB,
 * summary JSONB, pulsing_calendar JSONB, safety_notes, practitioner_review_required).
 *
 * Behaviour:
 *   - Fail fast on Zod validation errors.
 *   - Retry once with a repair prompt if the first generation fails validation.
 *   - Return timing + model metadata alongside the protocol for observability.
 */

import { z } from 'zod';
import { generateObject } from '@rork-ai/toolkit-sdk';
import { LONGEVITY_SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION } from './systemPrompt';
import type { IntakeInput } from '../../trpc/routes/longevity/schemas';
import type { ProtocolOutput } from '../../trpc/routes/longevity/generator';

const CLAUDE_MODEL = 'claude-opus-4-6';

// ────────────────────────────────────────────────────────────────
// Zod schemas (wire contract — the generated JSON must match these)
// ────────────────────────────────────────────────────────────────

const HallmarkIdSchema = z.number().int().min(1).max(12);

const SupplementSchema = z.object({
  name: z.string(),
  brand: z.string().optional(),
  dose: z.string(),
  timing: z.string(),
  duration: z.string(),
  purpose: z.string(),
  hallmark: HallmarkIdSchema,
});

const PeptideRxSchema = z.object({
  name: z.string(),
  dose: z.string(),
  route: z.enum(['subcutaneous', 'intramuscular', 'oral', 'nasal', 'topical']),
  cycle: z.string(),
  purpose: z.string(),
  hallmark: HallmarkIdSchema,
});

const DietSchema = z.object({
  type: z.string(),
  macros: z.object({
    protein: z.string().optional(),
    carbs: z.string().optional(),
    fat: z.string().optional(),
  }).optional(),
  notes: z.string(),
});

const FastingSchema = z.object({
  protocol: z.string(),
  frequency: z.string(),
  cycleSyncNotes: z.string().optional(),
});

const ExerciseSchema = z.object({
  strength: z.string(),
  cardio: z.string(),
  hiit: z.string(),
  frequency: z.string(),
  intensity: z.string(),
});

const ModalitySchema = z.object({
  modality: z.string(),
  frequency: z.string(),
  duration: z.string(),
  purpose: z.string(),
});

const MonthSchema = z.object({
  month: z.number().int().min(1).max(6),
  theme: z.string(),
  hallmarksTargeted: z.array(HallmarkIdSchema).min(1),
  supplements: z.array(SupplementSchema),
  peptides: z.array(PeptideRxSchema),
  diet: DietSchema,
  fasting: FastingSchema,
  exercise: ExerciseSchema,
  modalities: z.array(ModalitySchema),
  lifestyle: z.array(z.string()),
  labsToOrder: z.array(z.string()),
  checkInNotes: z.string(),
});

const SummarySchema = z.object({
  targetBiologicalAgeReduction: z.number(),
  hallmarksAddressed: z.array(HallmarkIdSchema),
  primaryRootCauses: z.array(z.string()),
  expectedOutcomes: z.array(z.string()),
  contraindicationsFlagged: z.array(z.string()),
});

const PulsingCalendarSchema = z.array(z.object({
  item: z.string(),
  category: z.string(),
  schedule: z.string(),
  days: z.array(z.number().int().min(0).max(179)),
  color: z.enum(['green', 'amber', 'red', 'blue', 'purple']),
}));

export const ProtocolSchema = z.object({
  summary: SummarySchema,
  months: z.array(MonthSchema).length(6),
  pulsingCalendar: PulsingCalendarSchema,
  safetyNotes: z.array(z.string()).min(1),
  practitionerReviewRequired: z.array(z.string()),
});

export type ClaudeProtocol = z.infer<typeof ProtocolSchema>;

// ────────────────────────────────────────────────────────────────
// Generator
// ────────────────────────────────────────────────────────────────

export interface ClaudeGenerationResult {
  protocol: ProtocolOutput;
  generationMs: number;
  model: string;
  systemPromptVersion: string;
  attempts: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ClaudeGenerationError {
  phase: 'generation' | 'validation' | 'repair';
  message: string;
  attempts: number;
  generationMs: number;
}

function buildUserPrompt(intake: IntakeInput): string {
  const labsSummary = intake.labs ? JSON.stringify(intake.labs, null, 2) : 'No labs provided.';
  return `PATIENT INTAKE
Chronological age: ${intake.chronologicalAge ?? 'unknown'}
Biological age: ${intake.biologicalAge ?? 'unknown'}
Sex: ${intake.sex ?? 'unknown'}
Menstrual status: ${intake.menstrualStatus ?? 'n/a'}
Weight (current → ideal): ${intake.weightCurrent ?? '?'} → ${intake.weightIdeal ?? '?'} lbs
Height: ${intake.height ?? '?'} in
Fitness level: ${intake.fitnessLevel ?? 'unknown'}
Diet type: ${intake.dietType ?? 'unknown'}

Conditions: ${intake.conditions?.join(', ') || 'none'}
Sensitivities: ${intake.sensitivities?.join(', ') || 'none'}
Oppositions: ${intake.oppositions?.join(', ') || 'none'}
Goals: ${intake.longevityGoals?.join(', ') || 'general longevity'}
Preferred brands: ${intake.preferredBrands?.join(', ') || 'none specified'}
Available modalities: ${intake.modalities?.join(', ') || 'none specified'}
Top complaints: ${intake.topComplaints?.join(', ') || 'none'}
Lifestyle factors: ${intake.lifestyleFactors?.join(', ') || 'none'}

LAB SNAPSHOT
${labsSummary}

${intake.notes ? `ADDITIONAL NOTES\n${intake.notes}` : ''}

Generate the full 6-month protocol as JSON matching the schema. Apply ALL personalization and safety rules from the system prompt.`;
}

async function runGeneration(userPrompt: string, systemPrompt: string): Promise<ClaudeProtocol> {
  const raw = await generateObject({
    messages: [
      { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
      { role: 'user', content: [{ type: 'text', text: userPrompt }] },
    ] as any,
    schema: ProtocolSchema as any,
  });
  // The SDK returns the parsed object; validate again to be safe.
  return ProtocolSchema.parse(raw);
}

/**
 * Public entry point. Swaps in for `generateProtocolFromIntake()` when
 * the feature flag is enabled for this user.
 */
export async function generateProtocolWithClaude(
  intake: IntakeInput,
): Promise<ClaudeGenerationResult> {
  const start = Date.now();
  const userPrompt = buildUserPrompt(intake);

  let attempts = 0;
  let lastError: unknown = null;

  // First attempt.
  try {
    attempts++;
    const protocol = await runGeneration(userPrompt, LONGEVITY_SYSTEM_PROMPT);
    return {
      protocol: protocol as ProtocolOutput,
      generationMs: Date.now() - start,
      model: CLAUDE_MODEL,
      systemPromptVersion: SYSTEM_PROMPT_VERSION,
      attempts,
    };
  } catch (e) {
    lastError = e;
  }

  // Single retry with a repair hint appended.
  try {
    attempts++;
    const repairHint = `\n\nPREVIOUS ATTEMPT FAILED SCHEMA VALIDATION. Error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }\nRespond AGAIN with strictly valid JSON matching the schema. Do not include any commentary.`;
    const protocol = await runGeneration(userPrompt, LONGEVITY_SYSTEM_PROMPT + repairHint);
    return {
      protocol: protocol as ProtocolOutput,
      generationMs: Date.now() - start,
      model: CLAUDE_MODEL,
      systemPromptVersion: SYSTEM_PROMPT_VERSION,
      attempts,
    };
  } catch (e) {
    const err: ClaudeGenerationError = {
      phase: 'validation',
      message: e instanceof Error ? e.message : String(e),
      attempts,
      generationMs: Date.now() - start,
    };
    throw err;
  }
}

export { CLAUDE_MODEL };
