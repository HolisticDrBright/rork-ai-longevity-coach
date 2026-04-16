/**
 * Cross-paradigm LLM hypothesizer.
 *
 * Called per `candidate` pattern with a list of requested paradigms.
 * Two-pass execution:
 *   Pass 1 — generate per-paradigm mechanism/rationale in a single call
 *             (one generateObject, returning an array).
 *   Pass 2 — if 'synergistic' is requested, generate the synthesis in a
 *             second call that receives Pass 1's output.
 *
 * Persists each paradigm as its own row in `pattern_hypotheses` (unique
 * index on (pattern_id, paradigm)). On failure the call throws with a
 * structured error that the router surfaces to Sentry.
 */

import { z } from 'zod';
import { generateObject } from '@rork-ai/toolkit-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSystemPrompt, SYSTEM_PROMPT_VERSION } from './systemPrompt';

const CLAUDE_MODEL = 'claude-opus-4-6';

export type Paradigm =
  | 'western' | 'functional' | 'naturopathic'
  | 'tcm' | 'ayurvedic' | 'biohacking' | 'synergistic';

const PARADIGM_VALUES: Paradigm[] = [
  'western', 'functional', 'naturopathic', 'tcm', 'ayurvedic', 'biohacking', 'synergistic',
];

// ────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────

const ParadigmHypothesisSchema = z.object({
  paradigm: z.enum(PARADIGM_VALUES as [Paradigm, ...Paradigm[]]),
  mechanism: z.string().min(20).max(400),
  rationale: z.string().min(40).max(1200),
  safety_concerns: z.array(z.string()).default([]),
  supporting_references: z.array(z.string()).default([]),
  llm_confidence: z.number().min(0).max(1),
});

const Pass1Schema = z.object({
  hypotheses: z.array(ParadigmHypothesisSchema).min(1),
});

const SynergisticSchema = z.object({
  mechanism: z.string().min(40).max(800),
  rationale: z.string().min(60).max(1500),
  referenced_paradigms: z.array(z.enum(PARADIGM_VALUES as [Paradigm, ...Paradigm[]])).min(1),
  paradigm_conflicts: z.string().optional(),
  recommended_lens_weighting: z.record(z.string(), z.number()),
  safety_override: z.string().nullable(),
  llm_confidence: z.number().min(0).max(1),
});

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface HypothesizerInput {
  patternId: string;
  kind: string;
  leftEntity: { label: string; type?: string; paradigm_tag?: string };
  rightEntity: { label: string; type?: string; paradigm_tag?: string };
  method: string;
  timeLagDays: number;
  effectSize: number;
  pValue: number;
  qValue: number;
  nPatients: number;
  cohortSummary?: Record<string, unknown>;
  requestedParadigms: Paradigm[];
}

export interface HypothesizerResult {
  generated: Paradigm[];
  failed: Paradigm[];
  latencyMs: number;
}

function userPrompt(input: HypothesizerInput): string {
  return `STATISTICAL FINDING
Kind: ${input.kind}
Left entity: ${input.leftEntity.label} (${input.leftEntity.type ?? 'unknown type'})
Right entity: ${input.rightEntity.label} (${input.rightEntity.type ?? 'unknown type'})
Method: ${input.method}
Time lag: ${input.timeLagDays} days
Effect size: ${input.effectSize.toFixed(3)}
p-value: ${input.pValue.toExponential(2)} · q-value (BH): ${input.qValue.toExponential(2)}
n_patients in cohort: ${input.nPatients}

${input.cohortSummary ? `COHORT SUMMARY\n${JSON.stringify(input.cohortSummary, null, 2)}\n` : ''}
Generate a mechanistic hypothesis for each of the requested paradigms. If a paradigm does not map plausibly, say so in its mechanism field rather than invent a framing.`;
}

// ────────────────────────────────────────────────────────────
// Pass 1 — per-paradigm mechanisms
// ────────────────────────────────────────────────────────────

async function runPass1(
  input: HypothesizerInput,
  nonSynergistic: Paradigm[],
): Promise<{ hypotheses: z.infer<typeof Pass1Schema>['hypotheses']; latencyMs: number }> {
  const start = Date.now();
  const systemPrompt = buildSystemPrompt(nonSynergistic)
    + `\n\nRETURN: { hypotheses: Array<{ paradigm, mechanism, rationale, safety_concerns, supporting_references, llm_confidence }> } — one entry per requested paradigm, in this order: ${nonSynergistic.join(', ')}.`;

  const raw = await generateObject({
    messages: [
      { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
      {
        role: 'user',
        content: [{ type: 'text', text:
          userPrompt(input) + `\n\nRequested paradigms (non-synergistic): ${nonSynergistic.join(', ')}`,
        }],
      },
    ] as any,
    schema: Pass1Schema as any,
  });
  const parsed = Pass1Schema.parse(raw);
  return { hypotheses: parsed.hypotheses, latencyMs: Date.now() - start };
}

// ────────────────────────────────────────────────────────────
// Pass 2 — synergistic synthesis
// ────────────────────────────────────────────────────────────

async function runSynergistic(
  input: HypothesizerInput,
  pass1Hypotheses: z.infer<typeof Pass1Schema>['hypotheses'],
): Promise<{ synthesis: z.infer<typeof SynergisticSchema>; latencyMs: number }> {
  const start = Date.now();
  const systemPrompt = buildSystemPrompt(['synergistic'])
    + `\n\nRETURN: { mechanism, rationale, referenced_paradigms, paradigm_conflicts?, recommended_lens_weighting, safety_override, llm_confidence }. The recommended_lens_weighting must be a map from paradigm name to weight in [0,1], summing approximately to 1.0.`;

  const pass1Text = pass1Hypotheses.map(h =>
    `- ${h.paradigm}:\n  mechanism: ${h.mechanism}\n  rationale: ${h.rationale}\n  safety_concerns: ${JSON.stringify(h.safety_concerns)}\n  confidence: ${h.llm_confidence}`
  ).join('\n');

  const raw = await generateObject({
    messages: [
      { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
      {
        role: 'user',
        content: [{ type: 'text', text:
          userPrompt(input) + `\n\nPASS 1 HYPOTHESES\n${pass1Text}\n\nSynthesize across these lenses.`,
        }],
      },
    ] as any,
    schema: SynergisticSchema as any,
  });
  const parsed = SynergisticSchema.parse(raw);
  return { synthesis: parsed, latencyMs: Date.now() - start };
}

// ────────────────────────────────────────────────────────────
// Public entry point
// ────────────────────────────────────────────────────────────

export async function generateHypotheses(
  sb: SupabaseClient,
  input: HypothesizerInput,
  options: { upsert?: boolean } = { upsert: true },
): Promise<HypothesizerResult> {
  const requested = [...new Set(input.requestedParadigms)];
  const nonSynergistic = requested.filter(p => p !== 'synergistic');
  const wantsSynergistic = requested.includes('synergistic');
  const start = Date.now();
  const generated: Paradigm[] = [];
  const failed: Paradigm[] = [];

  // Pass 1
  let pass1Hypotheses: z.infer<typeof Pass1Schema>['hypotheses'] = [];
  let pass1LatencyMs = 0;
  if (nonSynergistic.length > 0) {
    try {
      const result = await runPass1(input, nonSynergistic);
      pass1Hypotheses = result.hypotheses;
      pass1LatencyMs = result.latencyMs;

      if (options.upsert) {
        for (const h of pass1Hypotheses) {
          const { error } = await sb.from('pattern_hypotheses').upsert({
            pattern_id: input.patternId,
            paradigm: h.paradigm,
            mechanism: h.mechanism,
            rationale: h.rationale,
            safety_concerns: h.safety_concerns,
            supporting_references: h.supporting_references,
            llm_confidence: h.llm_confidence,
            model: CLAUDE_MODEL,
            system_prompt_version: SYSTEM_PROMPT_VERSION,
            latency_ms: pass1LatencyMs,
          }, { onConflict: 'pattern_id,paradigm' });
          if (error) {
            failed.push(h.paradigm as Paradigm);
          } else {
            generated.push(h.paradigm as Paradigm);
          }
        }
      } else {
        generated.push(...pass1Hypotheses.map(h => h.paradigm as Paradigm));
      }
    } catch (e) {
      for (const p of nonSynergistic) failed.push(p);
    }
  }

  // Pass 2 — only if at least one paradigm succeeded
  if (wantsSynergistic && pass1Hypotheses.length > 0) {
    try {
      const { synthesis, latencyMs } = await runSynergistic(input, pass1Hypotheses);
      if (options.upsert) {
        const { error } = await sb.from('pattern_hypotheses').upsert({
          pattern_id: input.patternId,
          paradigm: 'synergistic',
          mechanism: synthesis.mechanism,
          rationale: synthesis.rationale,
          referenced_paradigms: synthesis.referenced_paradigms,
          paradigm_conflicts: synthesis.paradigm_conflicts,
          recommended_lens_weighting: synthesis.recommended_lens_weighting,
          safety_override: synthesis.safety_override,
          llm_confidence: synthesis.llm_confidence,
          model: CLAUDE_MODEL,
          system_prompt_version: SYSTEM_PROMPT_VERSION,
          latency_ms: latencyMs,
        }, { onConflict: 'pattern_id,paradigm' });
        if (error) failed.push('synergistic');
        else generated.push('synergistic');
      } else {
        generated.push('synergistic');
      }
    } catch (e) {
      failed.push('synergistic');
    }
  } else if (wantsSynergistic) {
    failed.push('synergistic');
  }

  return { generated, failed, latencyMs: Date.now() - start };
}

export { CLAUDE_MODEL, SYSTEM_PROMPT_VERSION };
