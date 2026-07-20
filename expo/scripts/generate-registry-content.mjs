#!/usr/bin/env node
/**
 * Generates expo/registry/registry-content.v1.json — the canonical, versioned
 * clinical content registry shared by the backend, the mobile app, and the
 * desktop platform (which vendors a byte-identical copy; parity is enforced
 * by sha256 in both repos' test suites).
 *
 * The 150 questionnaire questions are extracted MECHANICALLY from
 * expo/mocks/questionnaire.ts so IDs and wording cannot drift in transcription.
 * Lab catalog / rules mirror the previously hardcoded mappings in
 * expo/app/(tabs)/insights.tsx (now registry-owned). Supplements are the union
 * of the structured curated catalog (8) and the AI-prompt-only products (7);
 * the product owner's authoritative list was NOT found in either repository,
 * so every product is `pending_verification` — see
 * docs/supplement-reconciliation.md. Nothing here is approved for automatic
 * clinical use.
 *
 * Run: node expo/scripts/generate-registry-content.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const expoRoot = join(here, '..');

/* ------------------------------------------------ questionnaire extraction */

const src = readFileSync(join(expoRoot, 'mocks', 'questionnaire.ts'), 'utf8');

const catRe = /\{\s*id:\s*'([^']+)',\s*name:\s*'((?:[^'\\]|\\.)*)',\s*icon:\s*'([^']+)',\s*description:\s*'((?:[^'\\]|\\.)*)',\s*questions:\s*\[([\s\S]*?)\],\s*\},/g;
const qRe = /\{\s*id:\s*'([^']+)',\s*text:\s*'((?:[^'\\]|\\.)*)',\s*categoryId:\s*'([^']+)'\s*\},?/g;

const unescape = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');

let categories = [];
let cm;
while ((cm = catRe.exec(src)) !== null) {
  const [, id, name, icon, description, questionsBlock] = cm;
  const questions = [];
  let qm;
  qRe.lastIndex = 0;
  while ((qm = qRe.exec(questionsBlock)) !== null) {
    const [, qid, text, categoryId] = qm;
    if (categoryId !== id) throw new Error(`categoryId mismatch for ${qid}`);
    questions.push({ id: qid, text: unescape(text) });
  }
  categories.push({ id, name: unescape(name), icon, description: unescape(description), questions });
}

/*
 * Once the mock became a re-export shim of the registry, the generated JSON
 * itself is the canonical home of the questionnaire. Carry the previously
 * generated categories forward VERBATIM (ids and wording immutable within
 * q.v1); the 15/150 assertions below still guard the invariants.
 */
if (categories.length === 0) {
  const prev = JSON.parse(
    readFileSync(join(expoRoot, 'registry', 'registry-content.v1.json'), 'utf8'),
  );
  categories = prev.questionnaire.categories;
}

const totalQuestions = categories.reduce((n, c) => n + c.questions.length, 0);
if (categories.length !== 15) throw new Error(`expected 15 categories, got ${categories.length}`);
if (totalQuestions !== 150) throw new Error(`expected 150 questions, got ${totalQuestions}`);

/* ---------------------------------------------------------- lab catalog */
/*
 * Panels previously hardcoded in expo/app/(tabs)/insights.tsx. One entry per
 * PANEL (the old code repeated the same panel under different ids per
 * category — those aliases are preserved in labRules.legacyAliasId).
 * vendorVerified=false everywhere: vendor/specimen fields are carried from
 * the panel names and public storefront context, pending owner confirmation.
 * Order links are the original storefront links, review status UNREVIEWED —
 * they must never render as patient-executable order actions.
 */
const labCatalog = [
  { id: 'lab_vibrant_blood_panel', panelName: 'Vibrant Blood Panel', vendor: 'Vibrant America', kind: 'blood', specimen: 'Serum/whole blood draw', orderCode: null, jurisdictions: null, active: true, vendorVerified: false, orderLink: { url: 'https://labs.rupahealth.com/store/storefront_6G8WA4P', reviewStatus: 'unreviewed' } },
  { id: 'lab_gut_zoomer', panelName: 'Gut Zoomer', vendor: 'Vibrant Wellness', kind: 'stool', specimen: 'Stool collection kit', orderCode: null, jurisdictions: null, active: true, vendorVerified: false, orderLink: { url: 'https://holisticdrbright.wellproz.com/patient/product/27874', reviewStatus: 'unreviewed' } },
  { id: 'lab_sibo_breath_test', panelName: 'SIBO Breath Test', vendor: null, kind: 'breath', specimen: 'Lactulose breath kit', orderCode: null, jurisdictions: null, active: true, vendorVerified: false, orderLink: { url: 'https://labs.rupahealth.com/store/storefront_6G8WA4P?storefrontProduct=strprod_GxEadBx', reviewStatus: 'unreviewed' } },
  { id: 'lab_dutch_complete', panelName: 'DUTCH Complete Test', vendor: 'Precision Analytical', kind: 'dried-urine', specimen: 'Dried urine, 4-5 collections', orderCode: null, jurisdictions: null, active: true, vendorVerified: false, orderLink: { url: 'https://labs.rupahealth.com/store/storefront_6G8WA4P?storefrontProduct=strprod_kM2JwrM', reviewStatus: 'unreviewed' } },
  { id: 'lab_food_sensitivity_panel', panelName: 'Food Sensitivity Panel', vendor: null, kind: 'blood', specimen: 'Blood spot or draw (vendor-dependent)', orderCode: null, jurisdictions: null, active: true, vendorVerified: false, orderLink: { url: 'https://labs.rupahealth.com/store/storefront_6G8WA4P?storefrontProduct=strprod_aOpW617', reviewStatus: 'unreviewed' } },
  { id: 'lab_cyrex_array_5', panelName: 'Cyrex Array 5 - Autoimmune Panel', vendor: 'Cyrex Laboratories', kind: 'blood', specimen: 'Serum draw', orderCode: null, jurisdictions: null, active: true, vendorVerified: false, orderLink: { url: 'https://labs.rupahealth.com/store/storefront_6G8WA4P?storefrontProduct=strprod_L7gqJJx', reviewStatus: 'unreviewed' } },
  { id: 'lab_cyrex_array_12', panelName: 'Cyrex Array 12 - Pathogens', vendor: 'Cyrex Laboratories', kind: 'blood', specimen: 'Serum draw', orderCode: null, jurisdictions: null, active: true, vendorVerified: false, orderLink: { url: 'https://labs.rupahealth.com/store/storefront_6G8WA4P?storefrontProduct=strprod_8OJNqgO', reviewStatus: 'unreviewed' } },
  { id: 'lab_mycotoxin_panel', panelName: 'Mycotoxin Panel', vendor: null, kind: 'urine', specimen: 'First-morning urine', orderCode: null, jurisdictions: null, active: true, vendorVerified: false, orderLink: { url: 'https://labs.rupahealth.com/store/storefront_6G8WA4P?storefrontProduct=strprod_exV5p2O', reviewStatus: 'unreviewed' } },
  { id: 'lab_heavy_metals_panel', panelName: 'Heavy Metals Test', vendor: null, kind: 'urine', specimen: 'Urine (provocation per practitioner)', orderCode: null, jurisdictions: null, active: true, vendorVerified: false, orderLink: { url: 'https://labs.rupahealth.com/store/storefront_6G8WA4P?storefrontProduct=strprod_2xvd6e7', reviewStatus: 'unreviewed' } },
  { id: 'lab_tri_mercury', panelName: 'Tri-Mercury Test', vendor: 'Quicksilver Scientific', kind: 'multi', specimen: 'Blood + hair + urine tri-test', orderCode: null, jurisdictions: null, active: true, vendorVerified: false, orderLink: { url: 'https://labs.rupahealth.com/store/storefront_6G8WA4P?storefrontProduct=strprod_nxnq6BO', reviewStatus: 'unreviewed' } },
  { id: 'lab_3x4_genetics', panelName: '3x4 Genetic Testing', vendor: '3X4 Genetics', kind: 'cheek-swab', specimen: 'Buccal swab. Practitioner code BBRI003 (carried from legacy copy; unverified)', orderCode: null, jurisdictions: null, active: true, vendorVerified: false, orderLink: { url: 'https://3x4genetics.com', reviewStatus: 'unreviewed' } },
  { id: 'env_emf_home_assessment', panelName: 'EMF Home Assessment', vendor: null, kind: 'environmental-assessment', specimen: 'Professional home/work environment assessment — not a laboratory test', orderCode: null, jurisdictions: null, active: true, vendorVerified: false, orderLink: { url: null, reviewStatus: 'not_applicable' } },
];

/* --------------------------------------------------------------- lab rules */
/* categoryId -> labId with priority + why, mirroring the legacy mapping. */
const rule = (categoryId, labId, priority, why, legacyAliasId) => ({ categoryId, labId, priority, why, legacyAliasId });
const labRules = {
  version: 'labrules.v1',
  triggerBand: 'moderate',
  notes: 'Rules fire when a category screening score reaches the moderate band (>=25). Elevated (>=50) raises rank, never adds panels. Derived from the legacy insights.tsx mapping; clinical review pending.',
  rules: [
    rule('gallbladder', 'lab_vibrant_blood_panel', 'primary', 'Assesses liver and gallbladder function markers', 'vibrant_blood'),
    rule('leaky_gut', 'lab_gut_zoomer', 'primary', 'Gut health panel including intestinal permeability markers', 'gut_zoomer'),
    rule('gut_digestive', 'lab_gut_zoomer', 'primary', 'Full microbiome analysis with pathogen and dysbiosis markers', 'gut_zoomer_digestive'),
    rule('gut_digestive', 'lab_sibo_breath_test', 'conditional', 'If bloating is a primary symptom — tests for small intestinal bacterial overgrowth', 'sibo_test'),
    rule('blood_sugar', 'lab_vibrant_blood_panel', 'primary', 'Includes fasting glucose, HbA1c, insulin, and metabolic markers', 'vibrant_blood_sugar'),
    rule('adrenal', 'lab_dutch_complete', 'primary', 'Cortisol rhythm, DHEA, and adrenal metabolites', 'dutch_test_adrenal'),
    rule('hormones', 'lab_dutch_complete', 'primary', 'Full sex hormone panel with metabolites and androgens', 'dutch_test_hormones'),
    rule('thyroid', 'lab_vibrant_blood_panel', 'primary', 'Full thyroid panel: TSH, Free T3, Free T4, Reverse T3, TPO & TG antibodies', 'vibrant_thyroid'),
    rule('autoimmune', 'lab_food_sensitivity_panel', 'primary', 'Identifies IgG reactions that may accompany autoimmune responses', 'food_sensitivities'),
    rule('autoimmune', 'lab_cyrex_array_5', 'primary', 'Autoimmune reactivity screen across multiple tissues', 'cyrex_array_5'),
    rule('parasites', 'lab_gut_zoomer', 'primary', 'Includes parasite detection and gut pathogen analysis', 'gut_zoomer_parasites'),
    rule('lyme', 'lab_cyrex_array_12', 'primary', 'Borrelia, co-infections, and tick-borne pathogens', 'cyrex_array_12'),
    rule('mold', 'lab_mycotoxin_panel', 'primary', 'Urinary mycotoxin testing for mold exposure', 'mycotoxin_panel'),
    rule('heavy_metals', 'lab_heavy_metals_panel', 'primary', 'Heavy metal panel including lead, mercury, arsenic, cadmium', 'heavy_metals_test'),
    rule('heavy_metals', 'lab_tri_mercury', 'conditional', 'Mercury speciation for dental amalgam and fish exposure', 'tri_mercury'),
    rule('methylation', 'lab_3x4_genetics', 'primary', 'Genetic analysis including MTHFR, COMT, and detox pathways', 'genetic_testing'),
    rule('viral', 'lab_cyrex_array_12', 'primary', 'Includes EBV, CMV, HHV-6, and other chronic viral markers', 'cyrex_array_12_viral'),
    rule('emf', 'env_emf_home_assessment', 'conditional', 'Professional EMF assessment of home and work environment (not a lab test)', 'emf_assessment'),
  ],
};

/* -------------------------------------------------------------- supplements */
/*
 * AUTHORITATIVE LIST STATUS: NOT FOUND. Searched both repositories' working
 * trees, docs, and full git histories (git log -S across all commits) plus
 * session materials. Until the product owner supplies and approves the
 * canonical list, EVERY product is pending_verification and the backend
 * refuses to treat any of them as approved for protocol approval.
 */
const P = (id, name, brand, formulation, doseText, provenance, sourceRef, extras = {}) => ({
  id, name, brand, formulation, doseText,
  // Candidate-matching hints transcribed VERBATIM from the legacy extraction
  // prompt (expo/providers/LabsProvider.tsx). Pending verification like all
  // other product content — they gate prompt matching, never approval.
  indications: extras.indications ?? null,
  doseBounds: extras.doseBounds ?? null,
  ingredients: extras.ingredients ?? null,
  cautions: extras.cautions ?? null,
  interactions: extras.interactions ?? null,
  monitoring: extras.monitoring ?? null,
  approvalState: 'pending_verification',
  provenance,
  sourceRef,
});
const supplements = {
  version: 'supp.v1',
  authoritativeListStatus: 'not_found',
  reconciliationDoc: 'docs/supplement-reconciliation.md',
  products: [
    P('prod_proomega_2000', 'ProOmega 2000', 'Nordic Naturals', 'softgel', '2 softgels daily with meals', 'structured-catalog', 'expo/mocks/curatedProducts.ts', { indications: ['omega-3', 'fish oil', 'EPA/DHA', 'inflammation', 'cardiovascular', 'triglycerides'], ingredients: ['EPA 1125 mg', 'DHA 875 mg', 'Other Omega-3s 180 mg'], cautions: ['Fish allergy (absolute)', 'Bleeding disorders (caution)'], interactions: ['Anticoagulants (moderate)', 'Antihypertensives (minor)'] }),
    P('prod_glucoprime', 'GlucoPrime', 'Healthgevity', 'capsule', '1 capsule 2x daily with meals', 'structured-catalog', 'expo/mocks/curatedProducts.ts', { indications: ['blood sugar', 'insulin resistance', 'glucose', 'HbA1c'], ingredients: ['Dihydroberberine (GlucoVantage) 200 mg', 'Chromium 200 mcg', 'Cinnamon Extract 250 mg'] }),
    P('prod_protect_plus_10', 'Protect+ 10', 'Healthgevity', 'softgel', '1 softgel daily with fat', 'structured-catalog', 'expo/mocks/curatedProducts.ts', { indications: ['foundational multi', 'vitamin D', 'antioxidants'], ingredients: ['Vitamin A 2500 IU', 'Vitamin D3 10000 IU', 'Vitamin E 50 IU', 'Vitamin K2 (MK-7) 100 mcg'], monitoring: ['25-OH vitamin D at recheck — high-dose D3'] }),
    P('prod_liver_sauce', 'Liver Sauce', 'Quicksilver Scientific', 'liposomal liquid', '1 tsp daily on empty stomach', 'structured-catalog', 'expo/mocks/curatedProducts.ts', { indications: ['liver support', 'detox', 'ALT/AST elevation'], ingredients: ['Milk Thistle (Silymarin) 100 mg', 'DIM 50 mg', 'Dandelion Root 75 mg', 'Artichoke Extract 50 mg'] }),
    P('prod_liposomal_glutathione', 'Liposomal Glutathione Complex', 'Quicksilver Scientific', 'liposomal liquid', '1 tsp daily on empty stomach', 'structured-catalog', 'expo/mocks/curatedProducts.ts', { indications: ['glutathione', 'oxidative stress', 'detox'] }),
    P('prod_glutaryl', 'Glutaryl Transdermal Glutathione', 'Auro Wellness', 'transdermal spray', '4 pumps daily on skin', 'structured-catalog', 'expo/mocks/curatedProducts.ts', { indications: ['glutathione', 'detox support'], ingredients: ['Reduced Glutathione (GSH) 100 mg per 4 pumps'] }),
    P('prod_mitocore', 'MitoCore', 'Orthomolecular', 'capsule', '4 capsules daily with breakfast', 'structured-catalog', 'expo/mocks/curatedProducts.ts', { indications: ['mitochondrial support', 'CoQ10', 'energy', 'fatigue'] }),
    P('prod_nac_900_plus', 'NAC 900+', 'Healthgevity', 'capsule', '1-2 capsules daily', 'structured-catalog', 'expo/mocks/curatedProducts.ts', { indications: ['NAC', 'liver support', 'glutathione precursor'] }),
    P('prod_gut_shield', 'Gut Shield', 'Healthgevity', 'powder', '1 scoop daily', 'ai-prompt', 'expo/providers/LabsProvider.tsx (extraction prompt)', { indications: ['gut repair', 'leaky gut', 'IBS', 'gut inflammation'] }),
    P('prod_probiota_histaminx', 'ProBiota HistaminX', 'Seeking Health', 'capsule', '1 capsule daily', 'ai-prompt', 'expo/providers/LabsProvider.tsx (extraction prompt)', { indications: ['probiotics', 'histamine intolerance', 'gut health'] }),
    P('prod_sleep_deep', 'Sleep Deep', 'Healthgevity', 'capsule', '2 capsules before bed', 'ai-prompt', 'expo/providers/LabsProvider.tsx (extraction prompt)', { indications: ['sleep', 'insomnia', 'GABA', 'magnesium'] }),
    P('prod_magnesium_glycinate_300', 'Magnesium Glycinate 300', 'Healthgevity', 'capsule', '1-2 capsules evening', 'ai-prompt', 'expo/providers/LabsProvider.tsx (extraction prompt)', { indications: ['magnesium', 'sleep', 'muscle cramps', 'stress'] }),
    P('prod_methyl_b_complex', 'Methyl B Complex', 'Healthgevity', 'capsule', '1 capsule morning', 'ai-prompt', 'expo/providers/LabsProvider.tsx (extraction prompt)', { indications: ['B vitamins', 'methylation', 'MTHFR', 'homocysteine'] }),
    P('prod_d3_k2_5000', 'D3+K2 5000', 'Healthgevity', 'softgel', '1 softgel morning with fat', 'ai-prompt', 'expo/providers/LabsProvider.tsx (extraction prompt)', { indications: ['vitamin D deficiency', 'bone health', 'immune'], monitoring: ['25-OH vitamin D at recheck'] }),
    P('prod_adrenal_restore', 'Adrenal Restore', 'Healthgevity', 'capsule', '2 capsules morning', 'ai-prompt', 'expo/providers/LabsProvider.tsx (extraction prompt)', { indications: ['adrenal fatigue', 'cortisol', 'HPA axis', 'stress'] }),
  ],
};

/* -------------------------------------------------------- protocol templates */
const protocolTemplates = [
  {
    id: 'tpl_foundation_v1',
    version: 1,
    name: 'Foundational support (draft template)',
    status: 'draft',
    purpose: 'Baseline micronutrient + omega-3 foundation while labs are pending',
    items: [
      { supplementId: 'prod_proomega_2000', doseText: '2 softgels daily with meals', schedule: 'daily', durationDays: 90, monitoring: ['Recheck lipids/omega-3 index at 90 days'] },
      { supplementId: 'prod_protect_plus_10', doseText: '1 softgel daily with fat', schedule: 'daily', durationDays: 90, monitoring: ['25-OH vitamin D at 90 days'] },
    ],
  },
  {
    id: 'tpl_gut_restore_v1',
    version: 1,
    name: 'Gut restoration starter (draft template)',
    status: 'draft',
    purpose: 'Support intestinal lining and microbiome while awaiting stool panel review',
    items: [
      { supplementId: 'prod_gut_shield', doseText: '1 scoop daily', schedule: 'daily', durationDays: 60, monitoring: ['Symptom diary weekly'] },
      { supplementId: 'prod_probiota_histaminx', doseText: '1 capsule daily', schedule: 'daily', durationDays: 60, monitoring: ['Histamine symptom check at 2 weeks'] },
    ],
  },
];

/* -------------------------------------------------------------- consents */
const consents = [
  { id: 'consent_privacy', version: '2026-07.v1', title: 'Privacy & data use', required: true, summary: 'How your health information is stored, protected, and used to provide care. No diagnosis is made from screening questionnaires.' },
  { id: 'consent_communications', version: '2026-07.v1', title: 'Communications', required: true, summary: 'Secure portal messaging is the default channel. You choose whether reminders may use other channels.' },
  { id: 'consent_telehealth', version: '2026-07.v1', title: 'Telehealth', required: false, summary: 'Applies when you book video visits: technology limits, privacy, and emergency guidance.' },
  { id: 'consent_clinical_care', version: '2026-07.v1', title: 'Clinical care relationship', required: true, summary: 'Screening scores and drafts are reviewed by your practitioner before anything becomes a recommendation or order.' },
  { id: 'consent_recording_ai', version: '2026-07.v1', title: 'Visit recording & AI assistance', required: false, summary: 'Optional, revocable consent for visit recording and AI-drafted notes; nothing is enabled without it.' },
];

/* ----------------------------------------------------------- intake modules */
const intakeModules = [
  { id: 'mod_account', title: 'Account & preferences', kind: 'account', order: 1 },
  { id: 'mod_consents', title: 'Consents', kind: 'consents', order: 2 },
  { id: 'mod_concerns_goals', title: 'Concerns & goals', kind: 'concerns-goals', order: 3 },
  { id: 'mod_medical_history', title: 'Medical history', kind: 'medical-history', order: 4 },
  { id: 'mod_lifestyle', title: 'Lifestyle & environment', kind: 'lifestyle', order: 5 },
  { id: 'mod_symptom_screening', title: 'Symptom-pattern screening', kind: 'questionnaire', order: 6, sections: categories.map((c, i) => ({ order: i + 1, categoryId: c.id })) },
  { id: 'mod_records_upload', title: 'Records & prior labs', kind: 'uploads', order: 7 },
  { id: 'mod_review_submit', title: 'Review & submit', kind: 'review', order: 8 },
];

/* ------------------------------------------------------------------ output */
const content = {
  registryVersion: '2026.07.20-v1',
  generated: 'node expo/scripts/generate-registry-content.mjs (deterministic; do not hand-edit the JSON)',
  clinicalLanguage: {
    scoreName: 'symptom-pattern screening score',
    disclaimer: 'A symptom-pattern screening score is not a diagnosis, a medical probability, or confirmation of any condition. It only prioritizes which functional patterns to review with your practitioner.',
  },
  questionnaire: {
    id: 'symptom-pattern-screening',
    version: 'q.v1',
    effectiveDate: '2026-07-20',
    scoringVersion: 'scoring.v2',
    legacyScoringVersion: 'scoring.v1-legacy',
    answerScale: {
      type: 'severity-0-4',
      options: [
        { value: 0, label: 'Never' },
        { value: 1, label: 'Rarely' },
        { value: 2, label: 'Sometimes' },
        { value: 3, label: 'Often' },
        { value: 4, label: 'Almost always' },
      ],
      specialAnswers: [
        { value: 'not_applicable', label: 'Not applicable' },
        { value: 'unsure', label: 'Unsure' },
        { value: 'prefer_not_to_answer', label: 'Prefer not to answer' },
      ],
    },
    interpretation: {
      bands: [
        { id: 'below-threshold', label: 'Below screening threshold', min: 0 },
        { id: 'moderate', label: 'Moderate symptom-pattern screening score', min: 25 },
        { id: 'elevated', label: 'Elevated symptom-pattern screening score', min: 50 },
      ],
      insufficientDataBelowCompleteness: 0.5,
    },
    categories,
  },
  labCatalog,
  labRules,
  supplements,
  protocolTemplates,
  consents,
  intakeModules,
};

const json = JSON.stringify(content, null, 2) + '\n';
const outPath = join(expoRoot, 'registry', 'registry-content.v1.json');
writeFileSync(outPath, json);
const hash = createHash('sha256').update(json).digest('hex');
console.log(`wrote ${outPath}`);
console.log(`categories=${categories.length} questions=${totalQuestions} labs=${labCatalog.length} rules=${labRules.rules.length} products=${supplements.products.length}`);
console.log(`sha256=${hash}`);
