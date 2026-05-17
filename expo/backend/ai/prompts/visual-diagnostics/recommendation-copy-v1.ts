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

// ────────────────────────────────────────────────────────────
// Runtime defense-in-depth: post-validate the copy doesn't mention
// products outside `allowedProducts`.
//
// The system prompt promises violations will be rejected. This is the
// actual gate that enforces it. Called after the LLM returns its copy
// and BEFORE the copy is persisted or shown to the patient.
//
// The validator works by scanning the copy for any brand/product name
// from the FULL catalog (knownProducts) that isn't in the allowed
// subset. Brand names tend to be unique tokens ("SkinMedica", "EltaMD")
// so substring search is sufficient and avoids false positives on
// common English words.
// ────────────────────────────────────────────────────────────

export interface CopyValidationInput {
  copy: string;
  allowedProducts: Array<{ brand_name: string; product_name: string }>;
  /**
   * Optional: the rest of the catalog (brand + product names) the LLM
   * could have seen during prompt-tuning. The validator flags any of
   * these that appear in the copy but aren't in allowedProducts. When
   * omitted the validator only catches mentions of "known" brand-style
   * tokens via the heuristic (any TitleCase two-word phrase).
   */
  knownProducts?: Array<{ brand_name: string; product_name: string }>;
}

export interface CopyValidationResult {
  ok: boolean;
  violations: string[];
}

const STOP_PHRASES = new Set<string>([
  // Common observational phrases the LLM uses that look TitleCase but
  // are not products. Add to this list as needed.
  'Dr. Bright',
  'Dr Bright',
  'Functional Medicine',
  'Vitamin C',
  'Vitamin D',
  'Vitamin A',
  'Vitamin E',
  'Vitamin K',
  'Vitamin B',
  'Omega 3',
  'Zinc Picolinate',
  'AM', 'PM',
]);

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function validateCopyAgainstAllowedProducts(input: CopyValidationInput): CopyValidationResult {
  const { copy, allowedProducts, knownProducts = [] } = input;
  const violations: string[] = [];

  const allowedFullPhrases = new Set(
    allowedProducts.flatMap(p => [
      normalize(`${p.brand_name} ${p.product_name}`),
      normalize(p.product_name),
    ]),
  );
  const allowedBrandNames = new Set(allowedProducts.map(p => normalize(p.brand_name)));
  const normalizedCopy = normalize(copy);

  // 1. Flag any KNOWN brand/product name that appears in the copy but
  //    isn't part of an allowed product.
  for (const kp of knownProducts) {
    const brandNorm = normalize(kp.brand_name);
    const productNorm = normalize(kp.product_name);
    const fullPhrase = normalize(`${kp.brand_name} ${kp.product_name}`);

    // If this catalog entry is itself in the allowed list, skip.
    if (allowedFullPhrases.has(fullPhrase) || allowedFullPhrases.has(productNorm)) continue;

    if (normalizedCopy.includes(fullPhrase)) {
      violations.push(`Mentions disallowed product: ${kp.brand_name} ${kp.product_name}`);
      continue;
    }
    // Brand-name mention is a violation unless that brand has an
    // allowed product. (A brand can be in the catalog with multiple
    // products; only the specific allowed ones may be referenced.)
    if (!allowedBrandNames.has(brandNorm) && normalizedCopy.includes(brandNorm)) {
      // Skip generic-sounding brand tokens that overlap real words
      if (brandNorm.length < 4) continue;
      violations.push(`Mentions disallowed brand: ${kp.brand_name}`);
    }
  }

  // 2. Heuristic: catch TitleCase multi-word phrases that look like
  //    products but aren't in allowedProducts and aren't known catalog
  //    entries. We scan the ORIGINAL copy for "WordCap WordCap" runs
  //    (2-4 capitalized words in a row).
  const allowedFullPhrasesList = Array.from(allowedFullPhrases);
  const titleCaseRuns = copy.match(/\b(?:[A-Z][a-zA-Z0-9]{1,})(?:\s+[A-Z][a-zA-Z0-9]{1,}){1,3}\b/g) ?? [];
  for (const phrase of titleCaseRuns) {
    if (STOP_PHRASES.has(phrase)) continue;
    const phraseNorm = normalize(phrase);
    if (allowedFullPhrases.has(phraseNorm)) continue;
    // Allow if the phrase is a substring of any allowed product's full
    // phrase (handles "EltaMD UV Clear Broad" sliced out of
    // "EltaMD UV Clear Broad-Spectrum SPF 46" because hyphens and
    // numbers break TitleCase runs).
    if (allowedFullPhrasesList.some(p => p.includes(phraseNorm))) continue;
    const tokens = phrase.split(/\s+/);
    const titleCount = tokens.filter(t => /^[A-Z]/.test(t)).length;
    if (titleCount < 2) continue;
    // Avoid flagging sentence-start common nouns
    const firstIsCommon = ['A', 'An', 'The', 'Your', 'Their', 'This', 'That', 'These', 'Those'].includes(tokens[0]);
    if (firstIsCommon) continue;
    violations.push(`Mentions unrecognized product-like phrase: "${phrase}"`);
  }

  return { ok: violations.length === 0, violations: Array.from(new Set(violations)) };
}

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
