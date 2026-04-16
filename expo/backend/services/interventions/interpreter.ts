/**
 * LLM interpreter for intervention outcomes.
 *
 * Given a high-confidence outcome row (or a cohort effectiveness row with
 * n_patients ≥ 20), produce a plausibility check + paradigm framings +
 * responder hypothesis + suggested validation. Persists to
 * intervention_outcome_hypotheses.
 *
 * Mirrors the pattern hypothesizer contract but with a narrower scope —
 * this is "what happened and why might it have happened", not
 * "what might be driving this correlation".
 */

import { z } from 'zod';
import { generateObject } from '@rork-ai/toolkit-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSystemPrompt, SYSTEM_PROMPT_VERSION } from '../patterns/systemPrompt';

const CLAUDE_MODEL = 'claude-opus-4-6';

const ParadigmSchema = z.enum([
  'western', 'functional', 'naturopathic', 'tcm', 'ayurvedic', 'biohacking', 'synergistic',
]);

const InterpretationSchema = z.object({
  plausibility: z.enum(['plausible', 'unlikely', 'needs_investigation']),
  paradigm: ParadigmSchema,
  mechanism: z.string().min(20).max(600),
  rationale: z.string().min(40).max(1200),
  responder_hypothesis: z.string().optional(),
  suggested_validation: z.string().optional(),
  llm_confidence: z.number().min(0).max(1),
});

const MultiSchema = z.object({
  interpretations: z.array(InterpretationSchema).min(1),
});

type Paradigm = z.infer<typeof ParadigmSchema>;

const INTERPRETER_PREAMBLE = `You are interpreting an observed change in a patient's biomarker, symptom, or wearable metric following an intervention (supplement, peptide, protocol, lifestyle change).

INPUTS:
- The intervention (label only, no patient-identifying info)
- Baseline and response values + effect size + confound flags
- The requested paradigm lenses for interpretation

YOUR JOB:
1. Plausibility — does the direction and magnitude make mechanistic sense for this intervention and this outcome given the time window? Flag if the effect appears too fast or too large or in the wrong direction for the known biology.
2. Per-paradigm mechanism — why might this intervention have produced this outcome in this paradigm's framing.
3. Responder hypothesis — what patient characteristics might explain strong or weak response (genetics, sex, age, concurrent conditions, concurrent interventions).
4. Suggested validation — what follow-up test or tracking would confirm the finding.

HARD CONSTRAINTS: no fabricated citations, no specific doses, no causal claims beyond "associated with / observed alongside". Tag confound flags the user provided — if 'concurrent_peptide' or 'protocol_overlap' is flagged, say so explicitly.`;

export interface InterpreterInput {
  sourceType: 'patient_outcome' | 'cohort_effectiveness';
  sourceId: string;
  interventionLabel: string;
  outcomeLabel: string;
  baselineValue: number | null;
  responseValue: number | null;
  delta: number | null;
  deltaPct: number | null;
  direction: string;
  effectSize: number | null;
  confidence: string;
  confoundFlags: string[];
  paradigms: Paradigm[];
  cohortContext?: Record<string, unknown>;
}

export async function interpretOutcome(
  sb: SupabaseClient,
  input: InterpreterInput,
): Promise<{ generated: number; failed: number }> {
  const systemPrompt = INTERPRETER_PREAMBLE + '\n\n' + buildSystemPrompt(input.paradigms);
  const userText = `INTERVENTION: ${input.interventionLabel}
OUTCOME: ${input.outcomeLabel}
Baseline → Response: ${input.baselineValue ?? '—'} → ${input.responseValue ?? '—'}
Delta: ${input.delta ?? '—'} (${input.deltaPct?.toFixed(1) ?? '—'}%)
Direction: ${input.direction}
Effect size (Hedges g): ${input.effectSize?.toFixed(3) ?? '—'}
Confidence: ${input.confidence}
Confound flags: ${input.confoundFlags.length ? input.confoundFlags.join(', ') : 'none'}

${input.cohortContext ? `COHORT CONTEXT\n${JSON.stringify(input.cohortContext, null, 2)}\n` : ''}
Return: { interpretations: Array<{ plausibility, paradigm, mechanism, rationale, responder_hypothesis?, suggested_validation?, llm_confidence }> } — one entry per requested paradigm in order: ${input.paradigms.join(', ')}.`;

  try {
    const raw = await generateObject({
      messages: [
        { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
        { role: 'user', content: [{ type: 'text', text: userText }] },
      ] as any,
      schema: MultiSchema as any,
    });
    const parsed = MultiSchema.parse(raw);

    let generated = 0, failed = 0;
    for (const it of parsed.interpretations) {
      const { error } = await sb.from('intervention_outcome_hypotheses').insert({
        source_type: input.sourceType,
        source_id: input.sourceId,
        paradigm: it.paradigm,
        plausibility: it.plausibility,
        mechanism: it.mechanism,
        rationale: it.rationale,
        responder_hypothesis: it.responder_hypothesis,
        suggested_validation: it.suggested_validation,
        llm_confidence: it.llm_confidence,
        model: CLAUDE_MODEL,
        system_prompt_version: SYSTEM_PROMPT_VERSION,
      });
      if (error) failed++;
      else generated++;
    }
    return { generated, failed };
  } catch {
    return { generated: 0, failed: input.paradigms.length };
  }
}
