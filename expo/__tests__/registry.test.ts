/**
 * Shared clinical content registry — content integrity, scoring boundaries,
 * golden-fixture parity, and supplement validation.
 *
 * The desktop repo (AI_DESKTOP_PRO) runs the SAME golden fixtures against its
 * vendored registry copy; REGISTRY_CONTENT_SHA256 is pinned identically in
 * both repos, so a drifted copy fails both suites.
 */
import { describe, expect, it } from 'vitest';
import {
  buildSupplementCatalogPromptBlock,
  computeRegistryHash,
  getProtocolTemplate,
  LAB_CATALOG,
  LAB_RULES,
  legacyScoreV1,
  listApprovedProducts,
  listDraftableProducts,
  partitionKnownProductIds,
  PROTOCOL_TEMPLATES,
  QUESTIONNAIRE,
  recommendLabs,
  REGISTRY_CONTENT_SHA256,
  resolveProductByName,
  scoreSubmission,
  SUPPLEMENT_REGISTRY,
  validateSupplementSuggestions,
  type SubmittedAnswer,
} from '../registry';
import goldenFixtures from '../registry/golden-fixtures.v1.json';
import { questionnaireCategories } from '../mocks/questionnaire';

/** Legacy (pre-registry) question IDs, category by category — the migration contract. */
const LEGACY_PREFIXES: Record<string, string> = {
  thyroid: 'thy', adrenal: 'adr', hormones: 'horm', gut_digestive: 'gut',
  gallbladder: 'gb', blood_sugar: 'bs', autoimmune: 'ai', parasites: 'par',
  lyme: 'lyme', mold: 'mold', heavy_metals: 'hm', viral: 'vir',
  methylation: 'meth', emf: 'emf', leaky_gut: 'lg',
};

describe('registry content integrity', () => {
  it('pins the canonical content hash (desktop vendors the same bytes)', () => {
    expect(computeRegistryHash()).toBe(REGISTRY_CONTENT_SHA256);
  });

  it('preserves all 15 categories and 150 question IDs from the legacy questionnaire', () => {
    expect(QUESTIONNAIRE.categories).toHaveLength(15);
    const allIds = QUESTIONNAIRE.categories.flatMap((c) => c.questions.map((q) => q.id));
    expect(allIds).toHaveLength(150);
    expect(new Set(allIds).size).toBe(150);
    for (const c of QUESTIONNAIRE.categories) {
      expect(c.questions).toHaveLength(10);
      const prefix = LEGACY_PREFIXES[c.id];
      expect(prefix, `unknown category ${c.id}`).toBeTruthy();
      c.questions.forEach((q, i) => expect(q.id).toBe(`${prefix}_${i + 1}`));
    }
  });

  it('keeps the legacy mock module as a thin re-export of registry content', () => {
    expect(questionnaireCategories).toHaveLength(15);
    const flatMock = questionnaireCategories.flatMap((c) =>
      c.questions.map((q) => ({ id: q.id, text: q.text, categoryId: q.categoryId })),
    );
    const flatRegistry = QUESTIONNAIRE.categories.flatMap((c) =>
      c.questions.map((q) => ({ id: q.id, text: q.text, categoryId: c.id })),
    );
    expect(flatMock).toEqual(flatRegistry);
  });

  it('every lab rule references an existing, active lab and a real category', () => {
    const labIds = new Set(LAB_CATALOG.map((l) => l.id));
    const categoryIds = new Set(QUESTIONNAIRE.categories.map((c) => c.id));
    for (const r of LAB_RULES.rules) {
      expect(labIds.has(r.labId), `rule lab ${r.labId}`).toBe(true);
      expect(categoryIds.has(r.categoryId), `rule category ${r.categoryId}`).toBe(true);
    }
    // Every category with a legacy mapping keeps at least one rule.
    const covered = new Set(LAB_RULES.rules.map((r) => r.categoryId));
    for (const id of categoryIds) expect(covered.has(id), `category ${id} uncovered`).toBe(true);
  });

  it('no order link is marked reviewed (all carried links await practitioner review)', () => {
    for (const lab of LAB_CATALOG) {
      expect(lab.orderLink.reviewStatus === 'unreviewed' || lab.orderLink.reviewStatus === 'not_applicable').toBe(true);
    }
  });

  it('protocol templates reference registry product IDs only', () => {
    for (const t of PROTOCOL_TEMPLATES) {
      const { unknown } = partitionKnownProductIds(t.items.map((i) => i.supplementId));
      expect(unknown).toEqual([]);
    }
    expect(getProtocolTemplate('tpl_foundation_v1')?.items.length).toBeGreaterThan(0);
    expect(getProtocolTemplate('tpl_invented')).toBeNull();
  });
});

describe('supplement registry — approval gate', () => {
  it('authoritative list not found ⇒ every product pending_verification, zero approved', () => {
    expect(SUPPLEMENT_REGISTRY.authoritativeListStatus).toBe('not_found');
    expect(SUPPLEMENT_REGISTRY.products).toHaveLength(15);
    for (const p of SUPPLEMENT_REGISTRY.products) {
      expect(p.approvalState).toBe('pending_verification');
    }
    expect(listApprovedProducts()).toEqual([]);
    expect(listDraftableProducts()).toHaveLength(15);
  });

  it('resolves known product names (with or without brand); rejects invented ones', () => {
    expect(resolveProductByName('GlucoPrime')?.id).toBe('prod_glucoprime');
    expect(resolveProductByName('gluco prime')?.id).toBe('prod_glucoprime');
    expect(resolveProductByName('ProOmega 2000 Nordic Naturals')?.id).toBe('prod_proomega_2000');
    expect(resolveProductByName('Adrenal Restore')?.id).toBe('prod_adrenal_restore');
    expect(resolveProductByName('Miracle Detox Ultra')).toBeNull();
    expect(resolveProductByName('')).toBeNull();
  });

  it('partitions invented product IDs out', () => {
    const r = partitionKnownProductIds(['prod_glucoprime', 'prod_fake_x', 'prod_gut_shield']);
    expect(r.known).toEqual(['prod_glucoprime', 'prod_gut_shield']);
    expect(r.unknown).toEqual(['prod_fake_x']);
  });
});

type FixtureCase = {
  name: string;
  answers: SubmittedAnswer[];
  expected?: Record<string, { percent: number | null; rounded: number | null; band: string; answered: number; completeness: number }>;
  expectedLegacyV1?: Record<string, number>;
  expectedElevated?: string[];
  expectedModerateOrHigher?: string[];
  expectedRecommendedLabIds?: string[];
  expectedUnknownQuestionIds?: string[];
  expectedGutZoomerSourceCategories?: string[];
};

describe('scoring.v2 golden fixtures (shared with desktop)', () => {
  const cases = (goldenFixtures as unknown as { cases: FixtureCase[] }).cases;

  it('has the boundary + partial-answer cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(9);
  });

  for (const c of cases) {
    it(c.name, () => {
      const result = scoreSubmission(c.answers);
      expect(result.scoringVersion).toBe('scoring.v2');
      expect(result.questionnaireVersion).toBe('q.v1');

      for (const [categoryId, exp] of Object.entries(c.expected ?? {})) {
        const cat = result.categories.find((x) => x.categoryId === categoryId);
        expect(cat, categoryId).toBeTruthy();
        expect(cat!.band).toBe(exp.band);
        expect(cat!.answered).toBe(exp.answered);
        expect(cat!.completeness).toBeCloseTo(exp.completeness, 10);
        if (exp.percent === null) expect(cat!.percent).toBeNull();
        else expect(cat!.percent).toBeCloseTo(exp.percent, 10);
        expect(cat!.rounded).toBe(exp.rounded);
      }
      if (c.expectedElevated) expect(result.elevatedCategoryIds).toEqual(c.expectedElevated);
      if (c.expectedModerateOrHigher) {
        expect(result.moderateOrHigherCategoryIds).toEqual(c.expectedModerateOrHigher);
      }
      if (c.expectedUnknownQuestionIds) {
        expect(result.unknownQuestionIds).toEqual(c.expectedUnknownQuestionIds);
      }
      if (c.expectedRecommendedLabIds) {
        const labs = recommendLabs(result);
        expect(labs.recommendations.map((r) => r.labId).sort()).toEqual(
          [...c.expectedRecommendedLabIds].sort(),
        );
      }
      if (c.expectedGutZoomerSourceCategories) {
        const gz = recommendLabs(result).recommendations.find((r) => r.labId === 'lab_gut_zoomer');
        expect(gz?.sourceCategoryIds.sort()).toEqual(
          [...c.expectedGutZoomerSourceCategories].sort(),
        );
      }
      for (const [categoryId, legacyExpected] of Object.entries(c.expectedLegacyV1 ?? {})) {
        const legacy = legacyScoreV1(c.answers).find((x) => x.categoryId === categoryId);
        expect(legacy?.percentage).toBe(legacyExpected);
      }
    });
  }

  it('never scores an unanswered question as zero (v2 vs legacy demonstration)', () => {
    const answers: SubmittedAnswer[] = [
      { questionId: 'mold_1', value: 4 },
      { questionId: 'mold_2', value: 4 },
      { questionId: 'mold_3', value: 4 },
      { questionId: 'mold_4', value: 4 },
      { questionId: 'mold_5', value: 4 },
      { questionId: 'mold_6', value: 4 },
    ];
    const v2 = scoreSubmission(answers).categories.find((x) => x.categoryId === 'mold')!;
    expect(v2.percent).toBe(100); // 24/24 of what was actually answered
    expect(v2.completeness).toBeCloseTo(0.6, 10);
    const v1 = legacyScoreV1(answers).find((x) => x.categoryId === 'mold')!;
    expect(v1.percentage).toBe(60); // legacy formula silently treated 4 blanks as zeros
  });

  it('duplicate answers to one question do not double-count (last write wins)', () => {
    const answers: SubmittedAnswer[] = [
      { questionId: 'thy_1', value: 4 },
      { questionId: 'thy_1', value: 0 },
      { questionId: 'thy_2', value: 4 },
    ];
    const cat = scoreSubmission(answers).categories.find((x) => x.categoryId === 'thyroid')!;
    expect(cat.answered).toBe(2);
    expect(cat.rawSum).toBe(4);
  });
});

describe('AI prompt catalog + suggestion validation', () => {
  it('prompt catalog block is generated from the registry and names every draftable product', () => {
    const block = buildSupplementCatalogPromptBlock();
    for (const p of SUPPLEMENT_REGISTRY.products) {
      expect(block).toContain(`${p.name} (${p.brand})`);
      expect(block).toContain(p.doseText);
    }
    // the guardrail language rides along with the catalog
    expect(block).toContain('ONLY name supplement products from this registry catalog');
    expect(block).toContain('Never cite a product that is not in the catalog above');
  });

  it('prompt catalog carries the registry indications as matching hints', () => {
    const block = buildSupplementCatalogPromptBlock();
    expect(block).toContain('for blood sugar, insulin resistance, glucose, HbA1c');
    expect(block).toContain('for adrenal fatigue, cortisol, HPA axis, stress');
  });

  it('validateSupplementSuggestions partitions registry products from invented ones', () => {
    const { validated, unverified } = validateSupplementSuggestions([
      { name: 'GlucoPrime', dose: '1 capsule 2x daily' },
      { name: 'ProOmega 2000 (Nordic Naturals)', dose: '2 softgels' },
      { name: 'Super Longevity Miracle Blend 9000', dose: '1 scoop' },
      { name: 'NAC-900+', dose: '1 capsule' }, // punctuation variant still resolves
    ]);
    expect(validated.map((v) => v.product.id).sort()).toEqual([
      'prod_glucoprime',
      'prod_nac_900_plus',
      'prod_proomega_2000',
    ]);
    expect(unverified.map((u) => u.name)).toEqual(['Super Longevity Miracle Blend 9000']);
  });

  it('validated suggestions expose approvalState so nothing pending can masquerade as approved', () => {
    const { validated } = validateSupplementSuggestions([{ name: 'Sleep Deep' }]);
    expect(validated).toHaveLength(1);
    expect(validated[0].product.approvalState).toBe('pending_verification');
  });
});
