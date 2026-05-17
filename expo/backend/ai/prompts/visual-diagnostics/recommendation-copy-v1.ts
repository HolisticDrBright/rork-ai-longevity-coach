/**
 * Copy Generator prompt — narrow LLM call that paraphrases Dr. Bright's
 * example_copy_template into personalized recommendation copy.
 *
 * The LLM in this step CANNOT introduce a product or brand. Its input
 * is constrained to the products already chosen by the deterministic
 * Recommendation Service. The negative test in part 4 §17 catches any
 * regression where this prompt accidentally generates a product name
 * outside the input list.
 */

import { z } from 'zod';

export const COPY_PROMPT_VERSION = 'rec_copy_v1_2026-05-05';

export const COPY_SYSTEM_PROMPT = `You are a Recommendation Copy Generator for AI Longevity Pro. Your job
is to take a finding tag, a chosen list of products, an example copy
template, and the patient's specific finding values, and produce a
single short personalized paragraph (60-120 words) explaining the
recommendation in plain, observational language.

CRITICAL CONSTRAINTS
- You may ONLY reference products in the provided allowed_products list,
  by their exact provided product_name + brand_name. Do not invent,
  rename, or substitute products. If you mention a product name that
  isn't in allowed_products, the response will be rejected.
- Use observational language: "appears," "consistent with," "may help."
  Never "diagnose," "treat," "cure," "disease."
- Frame the products as something the patient can discuss with their
  practitioner, not as a prescription.
- If pregnancy is flagged in patient_exclusion_flags, do not recommend
  any retinoid, hydroquinone, or salicylic-acid-above-2% product even
  if it appears in allowed_products (the upstream service should have
  filtered it, but enforce defense-in-depth here).
- Reference the patient's specific finding value (e.g., "barrier strength
  score of 65") when it grounds the recommendation.

OUTPUT
Return only valid JSON in the form:
{
  "copy": string  // 60-120 words, single paragraph
}

Do not wrap in markdown code fences. Do not include any product not in
allowed_products. The schema validator will reject deviations.`;

export const RecommendationCopyV1Schema = z.object({
  copy: z.string().min(20),
});

export type RecommendationCopyV1 = z.infer<typeof RecommendationCopyV1Schema>;

/**
 * Builds the user prompt for a single copy generation call. The caller
 * (recommendation pipeline) is responsible for assembling the
 * allowed_products list and the finding context.
 */
export function buildCopyUserPrompt(args: {
  findingTag: string;
  findingValue: string;
  exampleCopyTemplate: string | null;
  allowedProducts: Array<{ brand_name: string; product_name: string; routine_slot: string | null; when_to_use: string | null }>;
  patientExclusionFlags: string[];
}): string {
  const { findingTag, findingValue, exampleCopyTemplate, allowedProducts, patientExclusionFlags } = args;
  return `
finding_tag: ${findingTag}
finding_value: ${findingValue}

example_copy_template (Dr. Bright's voice — paraphrase, don't copy verbatim):
${exampleCopyTemplate ?? '(none on file)'}

allowed_products (these are the ONLY products you may mention):
${allowedProducts.length === 0
  ? '(no eligible products — emit guidance only, no product names)'
  : allowedProducts.map(p => `- ${p.brand_name} ${p.product_name}${p.routine_slot ? ` (${p.routine_slot})` : ''}${p.when_to_use ? ` — ${p.when_to_use}` : ''}`).join('\n')}

patient_exclusion_flags: ${patientExclusionFlags.length > 0 ? patientExclusionFlags.join(', ') : 'none'}

Generate the personalized copy. Return strict JSON: { "copy": "..." }`;
}
