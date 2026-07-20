/**
 * Shared clinical content registry — runtime API.
 *
 * Everything reads from the checked-in, generator-produced
 * `registry-content.v1.json` (see expo/scripts/generate-registry-content.mjs).
 * The desktop platform vendors a byte-identical copy; both repos assert the
 * same sha256 so mobile and desktop provably score against identical content.
 *
 * SAFETY INVARIANTS enforced here (and re-enforced in the database):
 *  - Scores are symptom-pattern screening scores; banding uses UNROUNDED
 *    percentages of the ANSWERED maximum — an unanswered/NA/unsure question
 *    is never scored as zero.
 *  - Lab recommendations come only from versioned rules over registry lab IDs.
 *  - Supplement names resolve only to registry products; unknown/invented
 *    names are rejected, never silently created.
 *  - No product is approved today (authoritative list not found ⇒ every
 *    product is pending_verification), so nothing can pass the
 *    approved-products gate until the owner's list is reconciled.
 */
import rawContent from './registry-content.v1.json';
import { sha256Hex } from './sha256';
import type {
  AnswerValue,
  CategoryScreeningScore,
  LabRecommendation,
  LabRecommendationResult,
  RegistryContent,
  RegistryProduct,
  ScoreBand,
  ScreeningResult,
  SeverityValue,
  SubmittedAnswer,
} from './types';

export * from './types';

export const REGISTRY: RegistryContent = rawContent as unknown as RegistryContent;

/**
 * Pinned fingerprint of the canonical content. The desktop repo pins the SAME
 * constant over its vendored copy; tests in both repos recompute and compare.
 */
export const REGISTRY_CONTENT_SHA256 =
  '44f332df9d33c8cb7247f4e608df76623b2ccd6654928985ea642cdb6eb908d8';

/** Recompute the content hash (stable: hash of the pretty-printed JSON). */
export function computeRegistryHash(): string {
  return sha256Hex(JSON.stringify(rawContent, null, 2) + '\n');
}

export const QUESTIONNAIRE = REGISTRY.questionnaire;
export const LAB_CATALOG = REGISTRY.labCatalog;
export const LAB_RULES = REGISTRY.labRules;
export const SUPPLEMENT_REGISTRY = REGISTRY.supplements;
export const PROTOCOL_TEMPLATES = REGISTRY.protocolTemplates;
export const CONSENTS = REGISTRY.consents;
export const INTAKE_MODULES = REGISTRY.intakeModules;
export const SCREENING_SCORE_NAME = REGISTRY.clinicalLanguage.scoreName;
export const SCREENING_DISCLAIMER = REGISTRY.clinicalLanguage.disclaimer;

const QUESTION_INDEX: Map<string, { categoryId: string }> = new Map();
for (const c of QUESTIONNAIRE.categories) {
  for (const q of c.questions) QUESTION_INDEX.set(q.id, { categoryId: c.id });
}

const LAB_INDEX = new Map(LAB_CATALOG.map((l) => [l.id, l]));
const PRODUCT_INDEX = new Map(SUPPLEMENT_REGISTRY.products.map((p) => [p.id, p]));

const isSeverity = (v: AnswerValue): v is SeverityValue =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4;

/* ------------------------------------------------------------- scoring v2 */

function bandFor(percent: number | null, completeness: number): ScoreBand {
  if (
    percent === null ||
    completeness < QUESTIONNAIRE.interpretation.insufficientDataBelowCompleteness
  ) {
    return 'insufficient_data';
  }
  if (percent >= 50) return 'elevated';
  if (percent >= 25) return 'moderate';
  return 'below-threshold';
}

/**
 * scoring.v2 — canonical. Denominator is 4 × ANSWERED questions: special
 * answers (not_applicable / unsure / prefer_not_to_answer) and unanswered
 * questions are excluded from BOTH numerator and denominator, and drive a
 * completeness figure instead. Below the completeness floor a category
 * reports `insufficient_data` with a null score — never a misleading number.
 */
export function scoreSubmission(answers: SubmittedAnswer[]): ScreeningResult {
  const byQuestion = new Map<string, AnswerValue>();
  const unknownQuestionIds: string[] = [];
  for (const a of answers) {
    if (!QUESTION_INDEX.has(a.questionId)) {
      unknownQuestionIds.push(a.questionId);
      continue;
    }
    byQuestion.set(a.questionId, a.value); // last write wins per question
  }

  const categories: CategoryScreeningScore[] = QUESTIONNAIRE.categories.map((c) => {
    let answered = 0;
    let special = 0;
    let rawSum = 0;
    for (const q of c.questions) {
      const v = byQuestion.get(q.id);
      if (v === undefined) continue;
      if (isSeverity(v)) {
        answered += 1;
        rawSum += v;
      } else {
        special += 1;
      }
    }
    const total = c.questions.length;
    const unanswered = total - answered - special;
    const maxForAnswered = answered * 4;
    const completeness = total === 0 ? 0 : answered / total;
    const percent = answered > 0 ? (rawSum / maxForAnswered) * 100 : null;
    const band = bandFor(percent, completeness);
    return {
      categoryId: c.id,
      categoryName: c.name,
      answered,
      special,
      unanswered,
      totalQuestions: total,
      rawSum,
      maxForAnswered,
      percent: band === 'insufficient_data' ? null : percent,
      rounded: band === 'insufficient_data' || percent === null ? null : Math.round(percent),
      completeness,
      band,
    };
  });

  return {
    questionnaireVersion: QUESTIONNAIRE.version,
    scoringVersion: QUESTIONNAIRE.scoringVersion,
    registryVersion: REGISTRY.registryVersion,
    categories,
    elevatedCategoryIds: categories.filter((c) => c.band === 'elevated').map((c) => c.categoryId),
    moderateOrHigherCategoryIds: categories
      .filter((c) => c.band === 'elevated' || c.band === 'moderate')
      .map((c) => c.categoryId),
    unknownQuestionIds,
  };
}

/**
 * scoring.v1-legacy — the pre-registry formula (sum / (10×4), unanswered
 * counted as zero). Kept ONLY to reproduce historical results for migrated
 * submissions; never used for new scoring.
 */
export function legacyScoreV1(answers: SubmittedAnswer[]): { categoryId: string; percentage: number }[] {
  const byQuestion = new Map<string, AnswerValue>();
  for (const a of answers) if (QUESTION_INDEX.has(a.questionId)) byQuestion.set(a.questionId, a.value);
  return QUESTIONNAIRE.categories.map((c) => {
    let sum = 0;
    for (const q of c.questions) {
      const v = byQuestion.get(q.id);
      if (v !== undefined && isSeverity(v)) sum += v;
    }
    const max = c.questions.length * 4;
    return { categoryId: c.id, percentage: max > 0 ? Math.round((sum / max) * 100) : 0 };
  });
}

/* ------------------------------------------------------ lab recommendations */

/**
 * Deterministic, versioned rules only: moderate-or-higher categories pull
 * their registry lab entries; elevated raises rank. AI may EXPLAIN these
 * results, never add to them.
 */
export function recommendLabs(result: ScreeningResult): LabRecommendationResult {
  const bandByCategory = new Map(result.categories.map((c) => [c.categoryId, c.band]));
  const byLab = new Map<string, LabRecommendation>();

  for (const r of LAB_RULES.rules) {
    const band = bandByCategory.get(r.categoryId);
    if (band !== 'moderate' && band !== 'elevated') continue;
    const lab = LAB_INDEX.get(r.labId);
    if (!lab || !lab.active) continue;
    const existing = byLab.get(r.labId);
    if (!existing) {
      byLab.set(r.labId, {
        labId: lab.id,
        panelName: lab.panelName,
        vendor: lab.vendor,
        priority: r.priority,
        sourceCategoryIds: [r.categoryId],
        why: r.why,
        highestBand: band,
        orderLinkReviewStatus: lab.orderLink.reviewStatus,
      });
    } else {
      if (!existing.sourceCategoryIds.includes(r.categoryId)) {
        existing.sourceCategoryIds.push(r.categoryId);
      }
      if (r.priority === 'primary') existing.priority = 'primary';
      if (band === 'elevated') existing.highestBand = 'elevated';
    }
  }

  const rank = (rec: LabRecommendation) =>
    (rec.highestBand === 'elevated' ? 0 : 2) + (rec.priority === 'primary' ? 0 : 1);
  const recommendations = [...byLab.values()].sort(
    (a, b) => rank(a) - rank(b) || a.panelName.localeCompare(b.panelName),
  );
  return { ruleVersion: LAB_RULES.version, registryVersion: REGISTRY.registryVersion, recommendations };
}

/* --------------------------------------------------- supplement validation */

const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]+/g, '');

const NAME_INDEX = new Map<string, RegistryProduct>();
for (const p of SUPPLEMENT_REGISTRY.products) {
  NAME_INDEX.set(normalizeName(p.name), p);
  NAME_INDEX.set(normalizeName(`${p.name} ${p.brand}`), p);
}

/** Resolve a free-text product name to a registry product, or null. */
export function resolveProductByName(name: string): RegistryProduct | null {
  return NAME_INDEX.get(normalizeName(name)) ?? null;
}

export function getProduct(id: string): RegistryProduct | null {
  return PRODUCT_INDEX.get(id) ?? null;
}

/** Split IDs into known registry products vs unknown/invented. */
export function partitionKnownProductIds(ids: string[]): { known: string[]; unknown: string[] } {
  const known: string[] = [];
  const unknown: string[] = [];
  for (const id of ids) (PRODUCT_INDEX.has(id) ? known : unknown).push(id);
  return { known, unknown };
}

/** Products a protocol may be APPROVED with — approval-state approved only. */
export function listApprovedProducts(): RegistryProduct[] {
  return SUPPLEMENT_REGISTRY.products.filter((p) => p.approvalState === 'approved');
}

/** Registry products usable in DRAFTS (approved + pending, never rejected). */
export function listDraftableProducts(): RegistryProduct[] {
  return SUPPLEMENT_REGISTRY.products.filter(
    (p) => p.approvalState === 'approved' || p.approvalState === 'pending_verification',
  );
}

export function getLab(id: string) {
  return LAB_INDEX.get(id) ?? null;
}

export function getProtocolTemplate(id: string) {
  return PROTOCOL_TEMPLATES.find((t) => t.id === id) ?? null;
}

/* ------------------------------------------- AI prompt catalog + validation */

/**
 * The supplement catalog block for AI prompts, generated from the registry —
 * never hand-maintained in prompt strings. Every line carries the registry
 * product's exact name and brand so model output can be validated back
 * against the registry.
 */
export function buildSupplementCatalogPromptBlock(): string {
  const lines = listDraftableProducts().map((p) => {
    const hints = p.indications?.length ? ` — for ${p.indications.join(', ')}` : '';
    return `- ${p.name} (${p.brand}) — ${p.doseText}${hints}`;
  });
  return [
    'IMPORTANT — Supplement recommendations:',
    'You may ONLY name supplement products from this registry catalog. Use the exact product name and brand:',
    '',
    ...lines,
    '',
    'If none of these products fits a finding, describe the nutrient or intervention generically (e.g. "a magnesium glycinate supplement") WITHOUT inventing a product name, brand, dose beyond standard references, vendor, or purchase link. Never cite a product that is not in the catalog above.',
  ].join('\n');
}

export interface ValidatedSuggestion<T extends { name: string }> {
  suggestion: T;
  /** Canonical registry product the suggestion resolved to. */
  product: RegistryProduct;
}

/**
 * Post-validate AI supplement output against the registry: suggestions that
 * resolve to a registry product are returned with the canonical product
 * attached; everything else is UNVERIFIED — callers must render unverified
 * items as plain informational text (no product identity claim, no vendor,
 * no purchase link) pending practitioner review.
 */
export function validateSupplementSuggestions<T extends { name: string }>(
  suggestions: T[],
): { validated: ValidatedSuggestion<T>[]; unverified: T[] } {
  const validated: ValidatedSuggestion<T>[] = [];
  const unverified: T[] = [];
  for (const s of suggestions) {
    const product = resolveProductByName(s.name);
    if (product) validated.push({ suggestion: s, product });
    else unverified.push(s);
  }
  return { validated, unverified };
}
