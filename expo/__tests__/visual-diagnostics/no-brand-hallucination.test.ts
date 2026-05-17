/**
 * Negative test: the Copy Generator must never mention a product or
 * brand that isn't in its `allowed_products` input.
 *
 * Per Dr. Bright's verbatim requirement: "Do not let the LLM emit
 * product names. Run the negative test." This file is the gate that
 * keeps any future regression from silently shipping a hallucinated
 * brand to a patient.
 *
 * Strategy: rather than calling a live LLM in CI (slow, flaky, costs
 * money), we exercise the runtime validator
 * (validateCopyAgainstAllowedProducts) against a fixture of synthetic
 * LLM outputs — both legitimate and adversarial. The same validator is
 * called in production after every Copy Generator response, so a green
 * test here proves the runtime gate would catch the same hallucinations
 * we test for.
 *
 * If you add a new copy-generation prompt variant or a new modality,
 * extend the FIXTURES list below with at least one positive and one
 * negative example.
 */

import { describe, test, expect } from 'vitest';
import {
  validateCopyAgainstAllowedProducts,
  type CopyValidationInput,
} from '../../backend/ai/prompts/visual-diagnostics/recommendation-copy-v1';

const CATALOG: Array<{ brand_name: string; product_name: string }> = [
  { brand_name: 'SkinMedica', product_name: 'TNS Advanced+ Serum' },
  { brand_name: 'SkinMedica', product_name: 'HA5 Rejuvenating Hydrator' },
  { brand_name: 'EltaMD', product_name: 'UV Clear Broad-Spectrum SPF 46' },
  { brand_name: 'EltaMD', product_name: 'UV Daily Tinted Sunscreen' },
  { brand_name: 'Skinceuticals', product_name: 'CE Ferulic' },
  { brand_name: 'Skinceuticals', product_name: 'Phloretin CF' },
  { brand_name: 'iS Clinical', product_name: 'Active Serum' },
  { brand_name: 'Obagi', product_name: 'Professional-C Serum 20%' },
  { brand_name: 'Alastin', product_name: 'Restorative Skin Complex' },
  { brand_name: 'Revision Skincare', product_name: 'Nectifirm Advanced' },
];

interface Fixture {
  name: string;
  copy: string;
  allowed: Array<{ brand_name: string; product_name: string }>;
  expectOk: boolean;
  expectMentions?: string[]; // substrings that must appear in violations
}

const FIXTURES: Fixture[] = [
  // ── Legitimate ──
  {
    name: 'legitimate: mentions only allowed product (full phrase)',
    copy: 'Your barrier strength score of 65 is consistent with mild dehydration. SkinMedica HA5 Rejuvenating Hydrator may help support hydration; discuss with your practitioner.',
    allowed: [{ brand_name: 'SkinMedica', product_name: 'HA5 Rejuvenating Hydrator' }],
    expectOk: true,
  },
  {
    name: 'legitimate: mentions allowed product by product name only',
    copy: 'Patterns suggest oxidative stress. CE Ferulic in the morning routine may support antioxidant defense per Dr. Bright. Always confirm with your provider.',
    allowed: [{ brand_name: 'Skinceuticals', product_name: 'CE Ferulic' }],
    expectOk: true,
  },
  {
    name: 'legitimate: no products mentioned (empty allowed_products case)',
    copy: 'Your barrier score appears within range. No specific product is being suggested at this time; continue your current routine and review at your next session.',
    allowed: [],
    expectOk: true,
  },
  {
    name: 'legitimate: two allowed products in same paragraph',
    copy: 'Findings show photodamage. EltaMD UV Clear Broad-Spectrum SPF 46 daily and CE Ferulic in the morning may support repair and prevention. Discuss with Dr. Bright.',
    allowed: [
      { brand_name: 'EltaMD', product_name: 'UV Clear Broad-Spectrum SPF 46' },
      { brand_name: 'Skinceuticals', product_name: 'CE Ferulic' },
    ],
    expectOk: true,
  },

  // ── Adversarial: hallucinated brands/products ──
  {
    name: 'hallucinated: invents a brand not in catalog',
    copy: 'Your skin appears dry. Cetaphil Gentle Cleanser may help. Please review with your practitioner.',
    allowed: [{ brand_name: 'SkinMedica', product_name: 'HA5 Rejuvenating Hydrator' }],
    expectOk: false,
    expectMentions: ['Cetaphil Gentle Cleanser'],
  },
  {
    name: 'hallucinated: known brand but wrong product (SkinMedica + invented product)',
    copy: 'Your barrier is compromised. SkinMedica Ultra Repair Serum is consistent with what you need. Discuss with Dr. Bright.',
    allowed: [{ brand_name: 'SkinMedica', product_name: 'HA5 Rejuvenating Hydrator' }],
    expectOk: false,
  },
  {
    name: 'hallucinated: catalog brand mentioned when allowed list has different brand',
    copy: 'For photodamage, Obagi Professional-C Serum 20% may help support repair. Discuss with your practitioner.',
    allowed: [{ brand_name: 'Skinceuticals', product_name: 'CE Ferulic' }],
    expectOk: false,
    expectMentions: ['Obagi'],
  },
  {
    name: 'hallucinated: catalog product when allowed_products is empty',
    copy: 'Findings suggest you should try EltaMD UV Clear Broad-Spectrum SPF 46 daily.',
    allowed: [],
    expectOk: false,
    expectMentions: ['EltaMD'],
  },
  {
    name: 'hallucinated: substitutes a different SkinMedica product than allowed',
    copy: 'Your hydration score is low. SkinMedica TNS Advanced+ Serum supports repair.',
    allowed: [{ brand_name: 'SkinMedica', product_name: 'HA5 Rejuvenating Hydrator' }],
    expectOk: false,
    expectMentions: ['TNS Advanced+ Serum'],
  },

  // ── Edge cases ──
  {
    name: 'edge case: mention of Dr. Bright (stop phrase) is not flagged as product',
    copy: 'Findings consistent with mild barrier disruption. Discuss with Dr. Bright at your next visit; no product change is being suggested.',
    allowed: [],
    expectOk: true,
  },
  {
    name: 'edge case: Vitamin C mention is not flagged as product',
    copy: 'Pattern consistent with oxidative stress. A topical Vitamin C product may help; discuss specific options with your practitioner.',
    allowed: [],
    expectOk: true,
  },
];

describe('Copy Generator — no brand hallucination', () => {
  for (const fx of FIXTURES) {
    test(fx.name, () => {
      const input: CopyValidationInput = {
        copy: fx.copy,
        allowedProducts: fx.allowed,
        knownProducts: CATALOG,
      };
      const result = validateCopyAgainstAllowedProducts(input);

      if (fx.expectOk) {
        expect(
          result.ok,
          `expected OK but got violations: ${result.violations.join('; ')}`,
        ).toBe(true);
      } else {
        expect(result.ok, 'expected validator to REJECT this copy').toBe(false);
        expect(result.violations.length).toBeGreaterThan(0);
        if (fx.expectMentions) {
          for (const mention of fx.expectMentions) {
            const found = result.violations.some(v => v.includes(mention));
            expect(
              found,
              `expected a violation mentioning "${mention}", got: ${result.violations.join('; ')}`,
            ).toBe(true);
          }
        }
      }
    });
  }

  test('validator returns ok:true for purely observational copy with no proper nouns', () => {
    const result = validateCopyAgainstAllowedProducts({
      copy: 'Findings are consistent with mild dehydration. Continue your current routine; reassess at your next visit.',
      allowedProducts: [],
      knownProducts: CATALOG,
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
