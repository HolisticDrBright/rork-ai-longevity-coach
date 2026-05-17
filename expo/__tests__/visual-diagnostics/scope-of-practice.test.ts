/**
 * Scope-of-practice test: the analyzer prompts MUST instruct the LLM
 * to use observational language ("appears", "consistent with",
 * "observation suggests") and MUST forbid medical-practice language
 * ("diagnose", "treat", "cure", "disease").
 *
 * Per Dr. Bright's verbatim requirement:
 *   "Scope-of-practice language in all analyzer outputs: 'appears,'
 *    'consistent with,' 'observation suggests,' 'pattern of.' Never
 *    'diagnose,' 'treat,' 'cure,' 'disease.'"
 *   "Dr. Bright is DAOM, L.Ac., Functional Medicine certified,
 *    Hypnotherapy certified. Never 'MD,' 'physician,' or 'medical
 *    doctor.' Rx is always 'via prescribing MD/NP partner.'"
 *
 * The test enforces those rules at the prompt level (static text) so
 * the next prompt update can't accidentally regress to medical
 * language. The runtime brand-hallucination validator is the *output*
 * gate; this is the *input* gate.
 */

import { describe, test, expect } from 'vitest';
import {
  SKIN_SYSTEM_PROMPT,
  SKIN_PROMPT_VERSION,
} from '../../backend/ai/prompts/visual-diagnostics/skin-analysis-v1';
import {
  TCM_TONGUE_SYSTEM_PROMPT,
  TCM_TONGUE_PROMPT_VERSION,
} from '../../backend/ai/prompts/visual-diagnostics/tcm-tongue-v1';
import {
  COPY_SYSTEM_PROMPT,
  COPY_PROMPT_VERSION,
} from '../../backend/ai/prompts/visual-diagnostics/recommendation-copy-v1';

const REQUIRED_OBSERVATIONAL_PHRASES = [
  'appears',
  'consistent with',
];

// "diagnose", "treat", "cure", "disease" must each appear in the prompt
// EITHER as a forbidden term inside a "do not" / "never" instruction OR
// not at all. The simplest check: count occurrences of each forbidden
// word and verify it ONLY shows up in negative-instruction lines.
const FORBIDDEN_TERMS = ['diagnose', 'treat', 'cure', 'disease'];

const NEGATIVE_MARKERS = [
  'do not',
  'never',
  "don't",
  'avoid',
  'not a doctor',
];

const PROMPTS: Array<{ name: string; version: string; prompt: string; skipRequired?: boolean }> = [
  { name: 'skin', version: SKIN_PROMPT_VERSION, prompt: SKIN_SYSTEM_PROMPT },
  { name: 'tcm-tongue', version: TCM_TONGUE_PROMPT_VERSION, prompt: TCM_TONGUE_SYSTEM_PROMPT },
  // Copy generator deals with personalized recommendation language; it
  // doesn't necessarily need to use "consistent with" verbatim (that
  // lives in the example_copy_template, which the LLM paraphrases). We
  // still enforce the forbidden-term rule though.
  { name: 'recommendation-copy', version: COPY_PROMPT_VERSION, prompt: COPY_SYSTEM_PROMPT, skipRequired: true },
];

describe('Visual diagnostics prompts — scope of practice', () => {
  for (const { name, version, prompt, skipRequired } of PROMPTS) {
    describe(`${name} (${version})`, () => {
      if (!skipRequired) {
        test('instructs LLM to use observational language', () => {
          const lower = prompt.toLowerCase();
          for (const phrase of REQUIRED_OBSERVATIONAL_PHRASES) {
            expect(
              lower.includes(phrase),
              `prompt is missing required observational phrase "${phrase}"`,
            ).toBe(true);
          }
        });
      }

      test('any mention of forbidden medical-practice terms is inside a negative instruction', () => {
        const lines = prompt.split('\n');
        for (const term of FORBIDDEN_TERMS) {
          for (const line of lines) {
            const lower = line.toLowerCase();
            if (!lower.includes(term)) continue;
            // Term appears — must be in a negative-instruction line
            const isNegative = NEGATIVE_MARKERS.some(marker => lower.includes(marker));
            expect(
              isNegative,
              `forbidden term "${term}" appears in a non-negative line: ${line.trim()}`,
            ).toBe(true);
          }
        }
      });

      test('does NOT call Dr. Bright "MD" / "physician" / "medical doctor"', () => {
        // Match credential context — "Dr. Bright, MD" or "Dr Bright MD"
        // would be a regression. Generic references to "the prescribing
        // MD/NP partner" are allowed.
        const lower = prompt.toLowerCase();
        const forbiddenCredCombos = [
          /dr\.?\s+bright[^\n]*\b(md|physician|medical doctor)\b/i,
          /bright,?\s+md\b/i,
          /bright,?\s+physician/i,
        ];
        for (const re of forbiddenCredCombos) {
          expect(
            re.test(prompt),
            `prompt appears to credential Dr. Bright as MD/physician/medical doctor (matched ${re}): ${prompt.match(re)?.[0]}`,
          ).toBe(false);
        }
        // Also: any standalone reference to "physician" or "medical doctor"
        // for Dr. Bright specifically should not appear. We allow these
        // tokens generically (e.g., "prescribing MD/NP partner").
        // Soft check: prompt must not say "Dr. Bright, MD" anywhere.
        expect(lower).not.toMatch(/dr\.? bright[\s,]+md\b/);
      });

      test('does not promise diagnosis or cure outcomes', () => {
        const lower = prompt.toLowerCase();
        const definitiveClaims = [
          'will diagnose',
          'will cure',
          'will treat',
          'this diagnoses',
          'this treats',
          'this cures',
        ];
        for (const claim of definitiveClaims) {
          expect(lower.includes(claim), `prompt contains definitive claim "${claim}"`).toBe(false);
        }
      });
    });
  }

  test('every prompt has a stable version string', () => {
    for (const { version } of PROMPTS) {
      expect(version).toMatch(/_v\d+_\d{4}-\d{2}-\d{2}$/);
    }
  });
});
