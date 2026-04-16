/**
 * Longevity Protocol Generator
 *
 * Rule-based deterministic generator that produces a 6-month longevity protocol
 * targeting the 12 Hallmarks of Aging, personalized to intake data.
 *
 * This matches the exact JSON schema specified for the longevity module. It can
 * be swapped for an Anthropic API call (claude-opus-4-6) by replacing
 * `generateProtocolFromIntake` — the input/output contract is identical.
 */

import type { IntakeInput } from './schemas';

export type HallmarkId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface Supplement { name: string; brand?: string; dose: string; timing: string; duration: string; purpose: string; hallmark: HallmarkId }
export interface PeptideRx { name: string; dose: string; route: 'subcutaneous' | 'intramuscular' | 'oral' | 'nasal' | 'topical'; cycle: string; purpose: string; hallmark: HallmarkId }
export interface MonthPlan {
  month: 1 | 2 | 3 | 4 | 5 | 6;
  theme: string;
  hallmarksTargeted: HallmarkId[];
  supplements: Supplement[];
  peptides: PeptideRx[];
  diet: { type: string; macros?: { protein?: string; carbs?: string; fat?: string }; notes: string };
  fasting: { protocol: string; frequency: string; cycleSyncNotes?: string };
  exercise: { strength: string; cardio: string; hiit: string; frequency: string; intensity: string };
  modalities: { modality: string; frequency: string; duration: string; purpose: string }[];
  lifestyle: string[];
  labsToOrder: string[];
  checkInNotes: string;
}

export interface ProtocolOutput {
  summary: {
    targetBiologicalAgeReduction: number;
    hallmarksAddressed: HallmarkId[];
    primaryRootCauses: string[];
    expectedOutcomes: string[];
    contraindicationsFlagged: string[];
  };
  months: MonthPlan[];
  pulsingCalendar: { item: string; category: string; schedule: string; days: number[]; color: string }[];
  safetyNotes: string[];
  practitionerReviewRequired: string[];
}

// ───────────────────────────────────────────────────────────────
// Helper: personalization flags
// ───────────────────────────────────────────────────────────────

function buildFlags(intake: IntakeInput) {
  const age = intake.chronologicalAge ?? 0;
  const bioAge = intake.biologicalAge ?? age;
  const bioAgeAccelerated = bioAge > age;
  const bioAgeGap = Math.max(0, bioAge - age);

  const conditions = (intake.conditions ?? []).map(c => c.toLowerCase());
  const sensitivities = (intake.sensitivities ?? []).map(s => s.toLowerCase());
  const oppositions = (intake.oppositions ?? []).map(o => o.toLowerCase());
  const modalities = (intake.modalities ?? []).map(m => m.toLowerCase());

  const opposesInjections = oppositions.some(o => o.includes('injection') || o.includes('peptide'));
  const opposesMeat = oppositions.some(o => o.includes('meat') || o.includes('vegan'));
  const capsuleLimit = (() => {
    const limitOpp = oppositions.find(o => /capsule\s*limit/i.test(o) || /pill\s*limit/i.test(o));
    if (!limitOpp) return null;
    const match = limitOpp.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
  })();

  const hasCancer = conditions.some(c => c.includes('cancer') || c.includes('malignancy') || c.includes('tumor'));
  const immunocompromised = conditions.some(c => c.includes('immunocompromised') || c.includes('transplant') || c.includes('hiv'));
  const hasDiabetes = conditions.some(c => c.includes('diabetes') || c.includes('diabetic'));
  const hasThyroid = conditions.some(c => c.includes('thyroid') || c.includes('hashimoto') || c.includes('graves'));
  const hasCardiovascular = conditions.some(c => c.includes('cardio') || c.includes('heart') || c.includes('hypertension'));
  const pregnantOrNursing = conditions.some(c => c.includes('pregnan') || c.includes('nursing') || c.includes('lactat'));

  const femalePreMeno = intake.sex === 'female' && intake.menstrualStatus === 'pre_menopause';

  const labs = intake.labs ?? {};
  const nutrEval = labs.nutrEval as Record<string, any> | undefined;
  const genetics = labs.genetics3x4 as Record<string, any> | undefined;
  const truAge = labs.truAge as Record<string, any> | undefined;
  const giMap = labs.giMap as Record<string, any> | undefined;

  const mthfrVariant = genetics?.mthfr === 'C677T' || genetics?.mthfr === 'A1298C' || genetics?.mthfr === 'compound_het';
  const comtSlow = genetics?.comt === 'slow' || genetics?.comt === 'val158met_met_met';
  const apoeRisk = genetics?.apoe === 'e3/e4' || genetics?.apoe === 'e4/e4';

  const gutDysbiosis = Boolean(giMap?.dysbiosis || giMap?.zonulin_elevated);
  const truAgeOrganAccel: string[] = Array.isArray(truAge?.acceleratedOrgans) ? truAge.acceleratedOrgans : [];

  return {
    age, bioAge, bioAgeAccelerated, bioAgeGap,
    conditions, sensitivities, oppositions, modalities,
    opposesInjections, opposesMeat, capsuleLimit,
    hasCancer, immunocompromised, hasDiabetes, hasThyroid, hasCardiovascular, pregnantOrNursing,
    femalePreMeno,
    nutrEval, mthfrVariant, comtSlow, apoeRisk,
    gutDysbiosis, truAgeOrganAccel,
    preferredBrand: (ingredient: string): string | undefined => {
      const brands = intake.preferredBrands ?? [];
      if (/nad|resveratrol|sirtuin/i.test(ingredient) && brands.includes('Healthgevity')) return 'Healthgevity';
      if (/glutathione|methylene\s*blue|mito/i.test(ingredient) && brands.includes('Quicksilver')) return 'Quicksilver';
      if (/c60/i.test(ingredient) && brands.includes('C60 Wizard Sciences')) return 'C60 Wizard Sciences';
      if (/stem|regen/i.test(ingredient) && brands.includes('StemRegen')) return 'StemRegen';
      if (/bpc|tb500|peptide/i.test(ingredient) && brands.includes('LVLUP')) return 'LVLUP';
      if (brands.includes('NOVOS')) return 'NOVOS';
      return brands[0];
    },
  };
}

type Flags = ReturnType<typeof buildFlags>;

// ───────────────────────────────────────────────────────────────
// Month 1: Foundation & Baseline Optimization
// ───────────────────────────────────────────────────────────────

function buildMonth1(flags: Flags): MonthPlan {
  const { preferredBrand, femalePreMeno, mthfrVariant, nutrEval, pregnantOrNursing, hasCancer } = flags;

  const supplements: Supplement[] = [
    { name: 'NAD+ Precursor (NMN or NR)', brand: preferredBrand('NAD+'), dose: '250-500 mg', timing: 'morning, empty stomach', duration: '6 months', purpose: 'NAD+ restoration for sirtuin/PARP function', hallmark: 3 },
    { name: 'C60 in Olive Oil', brand: preferredBrand('C60'), dose: '1-2 tsp', timing: 'morning with food', duration: '6 months', purpose: 'Broad-spectrum free radical scavenging', hallmark: 1 },
    { name: 'Protect+10 Foundational Multi', brand: 'Healthgevity', dose: 'per label', timing: 'with breakfast', duration: '6 months', purpose: 'Micronutrient coverage to prime longevity pathways', hallmark: 1 },
    { name: 'Magnesium Glycinate', dose: '300-400 mg', timing: 'evening', duration: '6 months', purpose: 'Sleep, DNA repair cofactor, stress modulation', hallmark: 1 },
    { name: 'Omega-3 (EPA/DHA)', dose: '2-3 g EPA+DHA', timing: 'with meals', duration: '6 months', purpose: 'Resolve inflammaging via SPM precursors', hallmark: 11 },
    { name: 'Vitamin D3/K2', dose: '5000 IU D3 + 180 mcg MK-7', timing: 'morning with fat', duration: '6 months', purpose: 'Immunomodulation, epigenetic regulation', hallmark: 3 },
  ];

  if (mthfrVariant) {
    supplements.push({ name: 'Methylated B Complex (5-MTHF, methyl-B12)', dose: '1 capsule', timing: 'morning', duration: '6 months', purpose: 'Bypass MTHFR variant for methylation support', hallmark: 3 });
  }

  if (nutrEval?.zinc_low) supplements.push({ name: 'Zinc Picolinate', dose: '15-30 mg', timing: 'with dinner', duration: 'Month 1 repletion', purpose: 'NutrEval-flagged zinc repletion', hallmark: 1 });
  if (nutrEval?.b12_low) supplements.push({ name: 'Methylcobalamin B12', dose: '1000 mcg', timing: 'morning sublingual', duration: 'Month 1 repletion', purpose: 'NutrEval-flagged B12 repletion', hallmark: 3 });

  const peptides: PeptideRx[] = [];
  // Senolytic priming (Rejuvenate) - skip if active cancer
  if (!hasCancer && !pregnantOrNursing) {
    supplements.push({ name: 'Rejuvenate Senolytic Stack (Fisetin + Quercetin)', brand: 'Healthgevity', dose: 'Fisetin 500 mg, Quercetin 500 mg', timing: 'morning, 2 consecutive days per week', duration: 'Weeks 1-2 senolytic priming', purpose: 'Clear senescent cells to reduce SASP inflammation', hallmark: 7 });
  }

  return {
    month: 1,
    theme: 'Foundation & Baseline Optimization',
    hallmarksTargeted: [1, 3, 7, 9, 11],
    supplements,
    peptides,
    diet: { type: 'mediterranean', macros: { protein: '1.2-1.6 g/kg', carbs: '40-50%', fat: '30-35%' }, notes: 'Whole foods, 30+ plants per week, pastured protein, limit seed oils and ultraprocessed.' },
    fasting: {
      protocol: '16:8 Intermittent Fasting',
      frequency: 'Daily, 5 days/week',
      cycleSyncNotes: femalePreMeno ? 'Women: avoid fasting during menstrual week. Follicular phase (days 1-14): full 16:8 adherence. Luteal (15-28): gentler 14:10.' : undefined,
    },
    exercise: {
      strength: '3 sessions/week, compound lifts, progressive overload',
      cardio: 'Zone 2 cardio 150 min/week (brisk walk, cycling)',
      hiit: 'None yet — introduce Month 3',
      frequency: '5-6 days active movement',
      intensity: 'Low-to-moderate; build base before HIIT',
    },
    modalities: filterModalities(flags, [
      { modality: 'Cold Plunge', frequency: '2-3x/week', duration: '2-3 min at 50-55°F', purpose: 'Norepinephrine, cold shock proteins, brown fat activation' },
      { modality: 'Sauna', frequency: '3-4x/week', duration: '20 min at 170-180°F', purpose: 'Heat shock proteins, cardiovascular conditioning' },
      { modality: 'PEMF', frequency: 'Daily', duration: '20 min', purpose: 'Cellular membrane charge, recovery' },
      { modality: 'Vibration Plate', frequency: 'Daily', duration: '10 min', purpose: 'Lymphatic flow, bone density' },
    ]),
    lifestyle: [
      'Sleep 7-9 hrs nightly; fixed wake time',
      'Morning sunlight exposure within 30 min of waking (5-10 min)',
      '10 min breathwork or meditation daily',
      'Blue-light blockers after sunset',
    ],
    labsToOrder: ['Comprehensive Metabolic Panel', 'CBC', 'Lipid panel with particle size', 'Ferritin', 'hs-CRP', 'Vitamin D'],
    checkInNotes: 'Assess tolerance to foundational stack. Adjust NAD+ if flushing. Confirm sleep + stress foundation before advancing.',
  };
}

// ───────────────────────────────────────────────────────────────
// Month 2: mTOR Inhibition & Telomere Support
// ───────────────────────────────────────────────────────────────

function buildMonth2(flags: Flags): MonthPlan {
  const { preferredBrand, opposesInjections, immunocompromised, hasCancer, pregnantOrNursing, femalePreMeno } = flags;

  const supplements: Supplement[] = [
    { name: 'Spermidine (Prime Time)', dose: '5-10 mg', timing: 'evening', duration: '6 months', purpose: 'Autophagy inducer, cardiovascular support', hallmark: 4 },
    { name: 'Telomere Prime', brand: preferredBrand('telomere'), dose: 'per label', timing: 'morning', duration: '3 months', purpose: 'Telomerase activation support', hallmark: 2 },
    { name: 'Resveratrol + Pterostilbene', dose: '250-500 mg combined', timing: 'morning with fat', duration: '6 months', purpose: 'Sirtuin activation, NAD+ synergy', hallmark: 3 },
    { name: 'Astragalus Extract (TA-65 equivalent)', dose: '250-500 mg', timing: 'morning', duration: '3 months', purpose: 'Telomerase activation', hallmark: 2 },
  ];

  const peptides: PeptideRx[] = [];
  if (!opposesInjections && !hasCancer && !pregnantOrNursing) {
    peptides.push({ name: 'Epitalon', dose: '10 mg/day', route: 'subcutaneous', cycle: '10 days on, then off until next year', purpose: 'Telomerase activation, pineal gland support', hallmark: 2 });
  } else if (opposesInjections) {
    supplements.push({ name: 'Oral Epitalon Bioregulator', dose: 'per label', timing: 'morning empty stomach', duration: '20 days', purpose: 'Oral alternative to injectable Epitalon', hallmark: 2 });
  }

  return {
    month: 2,
    theme: 'mTOR Inhibition & Telomere Support',
    hallmarksTargeted: [2, 3, 4, 5],
    supplements,
    peptides,
    diet: { type: 'mediterranean', notes: 'Continue month 1 diet with added 1-2 low-calorie days/week (800-1000 kcal) to amplify mTOR inhibition. Increase cruciferous vegetables.' },
    fasting: {
      protocol: '16:8 Daily + Weekly Extended (24h once every 2 weeks)',
      frequency: 'Daily 16:8, 24h fast bi-weekly',
      cycleSyncNotes: femalePreMeno ? '24h fasts only during follicular phase (days 3-10). No extended fasts during luteal or menstrual week.' : undefined,
    },
    exercise: {
      strength: '3-4 sessions/week, progressive overload continues',
      cardio: 'Zone 2 cardio 180 min/week',
      hiit: 'Begin 1 session/week (short intervals, low-volume)',
      frequency: '5-6 days active',
      intensity: 'Moderate; introduce metabolic demand',
    },
    modalities: filterModalities(flags, [
      { modality: 'Sauna', frequency: '4x/week', duration: '20-30 min', purpose: 'HSP70 induction, mTOR modulation' },
      { modality: 'Cold Plunge', frequency: '3x/week', duration: '3 min', purpose: 'AMPK activation' },
      { modality: 'PEMF', frequency: 'Daily', duration: '20 min', purpose: 'Recovery' },
    ]),
    lifestyle: ['Journal sleep architecture weekly', 'Weight & waist circumference check every 2 weeks'],
    labsToOrder: [],
    checkInNotes: immunocompromised
      ? 'PRACTITIONER REVIEW: patient immunocompromised — rapamycin and high-dose senolytics contraindicated this month.'
      : 'Monitor energy, mood during extended fasts. Adjust if hypoglycemia symptoms arise.',
  };
}

// ───────────────────────────────────────────────────────────────
// Month 3: Mitochondrial Optimization
// ───────────────────────────────────────────────────────────────

function buildMonth3(flags: Flags): MonthPlan {
  const { preferredBrand, opposesInjections, hasCancer, pregnantOrNursing, modalities, femalePreMeno } = flags;

  const supplements: Supplement[] = [
    { name: 'MitoCore / Mitochondrial Complex', brand: preferredBrand('mito'), dose: 'per label', timing: 'morning with fat', duration: '6 months', purpose: 'CoQ10, PQQ, ALCAR, R-ALA for electron transport chain support', hallmark: 6 },
    { name: 'Methylene Blue (USP grade)', brand: preferredBrand('methylene blue'), dose: '10-20 mg', timing: 'morning', duration: '3 months, then cycle 5 on / 2 off', purpose: 'Cytochrome c oxidase support, redox cycling', hallmark: 6 },
    { name: 'PQQ Standalone', dose: '20 mg', timing: 'morning', duration: '3 months', purpose: 'Mitochondrial biogenesis', hallmark: 6 },
    { name: 'CoQ10 Ubiquinol', dose: '200-300 mg', timing: 'morning with fat', duration: '6 months', purpose: 'ETC support, statin-resistant form', hallmark: 6 },
  ];

  const peptides: PeptideRx[] = [];
  if (!opposesInjections && !hasCancer && !pregnantOrNursing) {
    peptides.push(
      { name: 'SS-31 (Elamipretide)', dose: '5-10 mg', route: 'subcutaneous', cycle: '5 days on, 2 off, 4 weeks total', purpose: 'Cardiolipin stabilization, ETC optimization', hallmark: 6 },
      { name: 'MOTS-c', dose: '5-10 mg', route: 'subcutaneous', cycle: '2x/week, 4 weeks', purpose: 'AMPK activation, mitochondrial biogenesis', hallmark: 6 },
      { name: 'Humanin', dose: '1-3 mg', route: 'subcutaneous', cycle: '3x/week, 4 weeks', purpose: 'Cytoprotection, insulin sensitivity', hallmark: 6 },
    );
  }

  const hasRedLight = modalities.some(m => m.includes('red light') || m.includes('photobiomodulation'));
  const modalList = [
    hasRedLight
      ? { modality: 'Red Light Therapy (660/850 nm)', frequency: 'Daily', duration: '10-20 min', purpose: 'Mitochondrial photobiomodulation, synergy with methylene blue' }
      : { modality: 'Red Light Therapy (if available)', frequency: 'Daily if accessible', duration: '10-20 min', purpose: 'Mitochondrial ATP boost' },
    { modality: 'Sauna', frequency: '4x/week', duration: '20-30 min', purpose: 'HSP activation' },
    { modality: 'HBOT', frequency: '5x/week if available', duration: '60 min at 1.5-2 ATA', purpose: 'Hyperoxia-driven mitochondrial repair' },
    { modality: 'Vibration Plate', frequency: 'Daily', duration: '10 min', purpose: 'Circulation, lymphatics' },
  ];

  return {
    month: 3,
    theme: 'Mitochondrial Optimization',
    hallmarksTargeted: [3, 6, 11],
    supplements,
    peptides,
    diet: { type: 'mediterranean', notes: 'Emphasize B-vitamin-dense foods, pastured organ meats (or algae-based for vegans), add 1 tsp creatine monohydrate daily.' },
    fasting: {
      protocol: '16:8 Daily + 24h fast 2x/month',
      frequency: '5 days/week 16:8, 24h every 2 weeks',
      cycleSyncNotes: femalePreMeno ? 'Continue cycle-sync: extended fasts only in follicular phase.' : undefined,
    },
    exercise: {
      strength: '4 sessions/week, heavy compound lifts',
      cardio: 'Zone 2 at least 150 min/week',
      hiit: '2 sessions/week, 4x4 intervals or sprint intervals',
      frequency: '6 days',
      intensity: 'Moderate-high; HIIT is the mitochondrial biogenesis driver this month',
    },
    modalities: filterModalities(flags, modalList),
    lifestyle: ['Grounding/earthing 20 min daily when possible', 'Maintain consistent circadian rhythm'],
    labsToOrder: ['Organic Acids Test (OAT) if mitochondrial dysfunction suspected', 'Lactate-to-Pyruvate ratio'],
    checkInNotes: 'Track HRV and recovery scores. If HRV declining, reduce HIIT volume.',
  };
}

// ───────────────────────────────────────────────────────────────
// Month 4: Healing & Repair
// ───────────────────────────────────────────────────────────────

function buildMonth4(flags: Flags): MonthPlan {
  const { opposesInjections, hasCancer, pregnantOrNursing, gutDysbiosis, femalePreMeno, preferredBrand } = flags;

  const supplements: Supplement[] = [
    { name: 'StemRegen', brand: 'StemRegen', dose: 'per label', timing: 'morning empty stomach', duration: '90 days', purpose: 'Endogenous stem cell mobilization', hallmark: 8 },
    { name: 'Collagen Peptides (Type I & III)', dose: '15-20 g', timing: 'morning in coffee/smoothie', duration: '6 months', purpose: 'Connective tissue matrix support', hallmark: 12 },
    { name: 'Curcumin (Theracurmin or Meriva)', dose: '500-1000 mg', timing: 'with meals', duration: '6 months', purpose: 'NF-kB inhibition, anti-fibrotic', hallmark: 11 },
  ];

  if (gutDysbiosis) {
    supplements.push(
      { name: 'Targeted Probiotic (multi-strain)', brand: preferredBrand('probiotic'), dose: '20-50 billion CFU', timing: 'empty stomach AM', duration: '3 months', purpose: 'GI-MAP guided microbiome repair', hallmark: 10 },
      { name: 'L-Glutamine', dose: '5 g', timing: 'between meals', duration: '90 days', purpose: 'Intestinal mucosa repair', hallmark: 10 },
    );
  }

  const peptides: PeptideRx[] = [];
  if (!opposesInjections && !hasCancer && !pregnantOrNursing) {
    peptides.push(
      { name: 'BPC-157', dose: '250-500 mcg', route: 'subcutaneous', cycle: 'Daily for 30 days', purpose: 'Systemic tissue healing, gut mucosal repair', hallmark: 10 },
      { name: 'TB-500 (Thymosin Beta-4)', dose: '2-5 mg', route: 'subcutaneous', cycle: '2x/week for 30 days', purpose: 'Cell migration, regeneration, anti-fibrotic', hallmark: 8 },
    );
  } else if (opposesInjections) {
    supplements.push({ name: 'Oral BPC-157', dose: '500 mcg', timing: 'twice daily', duration: '30 days', purpose: 'Oral alternative for gut-focused healing', hallmark: 10 });
  }

  return {
    month: 4,
    theme: 'Healing, Repair & Stem Cell Activation',
    hallmarksTargeted: [8, 10, 11, 12],
    supplements,
    peptides,
    diet: { type: 'mediterranean', notes: 'Focus on collagen-rich foods (bone broth, organ meats, skin-on fish). Add fermented foods if GI-MAP supports. Consider 5-day fasting-mimicking diet in week 2.' },
    fasting: {
      protocol: 'Monthly 48-hour fast (week 2 or 3)',
      frequency: 'One 48h fast + continue 16:8 daily',
      cycleSyncNotes: femalePreMeno ? '48h fast strictly in follicular phase, day 5-9 ideal.' : undefined,
    },
    exercise: {
      strength: '3 sessions/week (deload one week for recovery)',
      cardio: 'Zone 2 150 min/week',
      hiit: '1 session/week',
      frequency: '5 days',
      intensity: 'Moderate; emphasize recovery to let stem cell + peptide work drive adaptation',
    },
    modalities: filterModalities(flags, [
      { modality: 'HBOT', frequency: '5x/week if accessible', duration: '60 min', purpose: 'Stem cell mobilization synergy with StemRegen' },
      { modality: 'Red Light Therapy', frequency: 'Daily', duration: '15-20 min', purpose: 'Tissue healing' },
      { modality: 'Sauna', frequency: '3-4x/week', duration: '20 min', purpose: 'Heat shock, recovery' },
      { modality: 'Cold Plunge', frequency: '2-3x/week', duration: '2-3 min', purpose: 'Anti-inflammatory' },
    ]),
    lifestyle: ['Prioritize 8+ hrs sleep during 48h fast period', 'Gentle yoga or mobility work daily'],
    labsToOrder: [],
    checkInNotes: 'Track recovery metrics closely. Expect best sleep and skin quality improvements this month.',
  };
}

// ───────────────────────────────────────────────────────────────
// Month 5: Deep Regeneration & Cognitive
// ───────────────────────────────────────────────────────────────

function buildMonth5(flags: Flags): MonthPlan {
  const { opposesInjections, hasCancer, pregnantOrNursing, truAgeOrganAccel, apoeRisk, femalePreMeno, preferredBrand } = flags;

  const supplements: Supplement[] = [
    { name: 'Resveratrol + Pterostilbene (continued)', dose: '250-500 mg', timing: 'morning', duration: 'Month 5-6', purpose: 'Sustained sirtuin activation', hallmark: 3 },
    { name: 'Lion\'s Mane Extract', dose: '1000 mg', timing: 'morning', duration: '6 months', purpose: 'NGF/BDNF support', hallmark: 9 },
    { name: 'Phosphatidylserine', dose: '100-200 mg', timing: 'evening', duration: '3 months', purpose: 'Cognitive and stress-axis support', hallmark: 9 },
  ];

  if (apoeRisk) {
    supplements.push({ name: 'DHA (algae or fish)', dose: '1 g daily', timing: 'with dinner', duration: 'ongoing', purpose: 'ApoE4-specific brain protection', hallmark: 9 });
  }

  const peptides: PeptideRx[] = [];
  if (!opposesInjections && !hasCancer && !pregnantOrNursing) {
    peptides.push(
      { name: 'Semax', dose: '200-600 mcg', route: 'nasal', cycle: 'Daily for 30 days, then 5 on / 2 off', purpose: 'BDNF, cognition, neuroprotection', hallmark: 9 },
      { name: 'Selank', dose: '200-400 mcg', route: 'nasal', cycle: 'Daily for 30 days', purpose: 'Anxiolytic, immune-modulation', hallmark: 9 },
      { name: 'GHK-Cu', dose: '1-2 mg', route: 'subcutaneous', cycle: '3x/week for 30 days', purpose: 'Collagen/extracellular matrix, gene expression remodeling', hallmark: 12 },
    );

    // Organ-targeted bioregulator based on TruAge findings
    const organToPeptide: Record<string, { name: string; purpose: string; hallmark: HallmarkId }> = {
      brain: { name: 'Cortagen (brain bioregulator)', purpose: 'Cerebral cortex gene expression support', hallmark: 9 },
      liver: { name: 'Stamakort (liver bioregulator)', purpose: 'Liver gene expression support', hallmark: 10 },
      heart: { name: 'Chelohart (cardiac bioregulator)', purpose: 'Myocardial tissue support', hallmark: 12 },
      kidney: { name: 'Pielotax (kidney bioregulator)', purpose: 'Renal tissue support', hallmark: 12 },
      thymus: { name: 'Vilon (thymus bioregulator)', purpose: 'Immune senescence reversal', hallmark: 9 },
      pineal: { name: 'Pinealon (pineal bioregulator)', purpose: 'Circadian and melatonin support', hallmark: 2 },
    };

    for (const organ of truAgeOrganAccel) {
      const bioreg = organToPeptide[organ.toLowerCase()];
      if (bioreg) {
        peptides.push({ name: bioreg.name, dose: '10-20 mcg/day oral', route: 'oral', cycle: '20 days on, 5 months off', purpose: bioreg.purpose, hallmark: bioreg.hallmark });
      }
    }
  } else if (opposesInjections) {
    supplements.push({ name: 'Oral Bioregulator Peptide Complex', brand: preferredBrand('bioregulator'), dose: 'per label', timing: 'morning', duration: '20 days', purpose: 'Oral alternative for organ-targeted support', hallmark: 9 });
  }

  return {
    month: 5,
    theme: 'Deep Regeneration & Cognitive Optimization',
    hallmarksTargeted: [2, 3, 9, 12],
    supplements,
    peptides,
    diet: { type: 'mediterranean', notes: 'Add 2-3 cognitive foods daily: wild salmon, blueberries, walnuts, dark leafy greens, MCT oil.' },
    fasting: {
      protocol: 'Monthly 72-hour fast (with medical supervision)',
      frequency: 'One 72h fast + continue 16:8 daily',
      cycleSyncNotes: femalePreMeno ? '72h fast MUST be follicular phase, days 5-10. If menstrual cycle irregular, skip to shorter fast.' : undefined,
    },
    exercise: {
      strength: '3-4 sessions/week, continue progressive overload',
      cardio: 'Zone 2 150 min/week',
      hiit: '1-2 sessions/week',
      frequency: '5-6 days',
      intensity: 'Moderate; include dual-task cognitive-physical exercises',
    },
    modalities: filterModalities(flags, [
      { modality: 'Red Light to scalp', frequency: 'Daily', duration: '10-15 min', purpose: 'Cognitive photobiomodulation' },
      { modality: 'HBOT', frequency: '3-5x/week if available', duration: '60 min', purpose: 'Neurogenesis support' },
      { modality: 'Sauna', frequency: '3x/week', duration: '20 min', purpose: 'BDNF' },
      { modality: 'Cold Plunge', frequency: '2x/week', duration: '3 min', purpose: 'Norepinephrine for focus' },
    ]),
    lifestyle: ['Learn something new weekly (language, instrument)', 'Social connection time daily', 'Nature exposure 2h+/week'],
    labsToOrder: [],
    checkInNotes: 'Expect cognitive and skin improvements. Peak protocol month — monitor for overtraining.',
  };
}

// ───────────────────────────────────────────────────────────────
// Month 6: Reassessment & Maintenance
// ───────────────────────────────────────────────────────────────

function buildMonth6(flags: Flags): MonthPlan {
  const { femalePreMeno } = flags;

  const supplements: Supplement[] = [
    { name: 'NAD+ Precursor (maintenance)', dose: '250 mg', timing: 'morning', duration: 'ongoing', purpose: 'Maintain NAD+ levels post-intensive phase', hallmark: 3 },
    { name: 'Omega-3 (maintenance)', dose: '2 g', timing: 'with meals', duration: 'ongoing', purpose: 'Sustained anti-inflammatory', hallmark: 11 },
    { name: 'Vitamin D3/K2', dose: '5000 IU + 180 mcg', timing: 'morning with fat', duration: 'ongoing', purpose: 'Maintenance', hallmark: 3 },
    { name: 'Magnesium Glycinate', dose: '300 mg', timing: 'evening', duration: 'ongoing', purpose: 'Maintenance', hallmark: 1 },
    { name: 'C60', dose: '1 tsp', timing: 'morning', duration: 'ongoing', purpose: 'Maintenance antioxidant', hallmark: 1 },
    { name: 'Spermidine (maintenance)', dose: '5 mg', timing: 'evening', duration: 'ongoing', purpose: 'Sustained autophagy', hallmark: 4 },
  ];

  return {
    month: 6,
    theme: 'Reassessment & Long-Term Maintenance',
    hallmarksTargeted: [1, 3, 4, 11],
    supplements,
    peptides: [],
    diet: { type: 'mediterranean', notes: 'Sustainable maintenance diet based on what worked best in months 1-5. 80/20 rule.' },
    fasting: {
      protocol: '16:8 most days + 24h monthly',
      frequency: '5 days/week 16:8, 24h monthly',
      cycleSyncNotes: femalePreMeno ? 'Maintain cycle-sync indefinitely.' : undefined,
    },
    exercise: {
      strength: '3 sessions/week',
      cardio: 'Zone 2 150 min/week',
      hiit: '1 session/week',
      frequency: '5 days',
      intensity: 'Moderate, sustainable for decades',
    },
    modalities: filterModalities(flags, [
      { modality: 'Sauna', frequency: '2-3x/week', duration: '20 min', purpose: 'Lifetime maintenance' },
      { modality: 'Cold Plunge', frequency: '2x/week', duration: '2 min', purpose: 'Resilience' },
      { modality: 'Red Light', frequency: '3-4x/week', duration: '10 min', purpose: 'Maintenance' },
      { modality: 'PEMF', frequency: 'Daily', duration: '20 min', purpose: 'Recovery' },
    ]),
    lifestyle: ['Reflect on 6-month wins', 'Set next 6-month goals based on reassessment labs'],
    labsToOrder: ['Repeat TruAge Epigenetic Test', 'Repeat NutrEval', 'Repeat NMR lipid panel', 'hs-CRP', 'Fasting insulin + HbA1c', 'DEXA scan'],
    checkInNotes: 'Primary reassessment month. Full lab re-draw to measure biological age reduction and guide next cycle.',
  };
}

// ───────────────────────────────────────────────────────────────
// Modality filter (only include if user has access or says "if available")
// ───────────────────────────────────────────────────────────────

function filterModalities(flags: Flags, modalityList: { modality: string; frequency: string; duration: string; purpose: string }[]) {
  const userMods = flags.modalities;
  return modalityList.filter((m) => {
    const key = m.modality.toLowerCase();
    if (key.includes('if available') || key.includes('if accessible')) return true;
    if (userMods.length === 0) return true; // no preferences → include all
    return userMods.some(um => key.includes(um) || um.includes(key.split(' ')[0]));
  });
}

// ───────────────────────────────────────────────────────────────
// Pulsing calendar (180 days)
// ───────────────────────────────────────────────────────────────

function buildPulsingCalendar(months: MonthPlan[]): ProtocolOutput['pulsingCalendar'] {
  const entries: ProtocolOutput['pulsingCalendar'] = [];

  months.forEach((month) => {
    const monthStart = (month.month - 1) * 30;
    const monthEnd = month.month * 30 - 1;
    const daysInMonth = Array.from({ length: 30 }, (_, i) => monthStart + i);

    month.supplements.forEach((s) => {
      entries.push({
        item: s.name,
        category: 'supplement',
        schedule: `${s.timing} · ${s.dose}`,
        days: daysInMonth,
        color: 'green',
      });
    });

    month.peptides.forEach((p) => {
      const isCycled = /on,\s*\d+\s*off|days?\s*on/i.test(p.cycle);
      entries.push({
        item: p.name,
        category: 'peptide',
        schedule: `${p.cycle} · ${p.dose} ${p.route}`,
        days: daysInMonth,
        color: isCycled ? 'amber' : 'purple',
      });
    });

    if (month.fasting.protocol) {
      const isExtended = /24|48|72|extended/i.test(month.fasting.protocol);
      entries.push({
        item: `Fasting: ${month.fasting.protocol}`,
        category: 'fasting',
        schedule: month.fasting.frequency,
        days: daysInMonth,
        color: isExtended ? 'red' : 'blue',
      });
    }
  });

  return entries;
}

// ───────────────────────────────────────────────────────────────
// Summary & safety builders
// ───────────────────────────────────────────────────────────────

function buildSummary(flags: Flags, months: MonthPlan[]): ProtocolOutput['summary'] {
  const hallmarks = Array.from(new Set(months.flatMap(m => m.hallmarksTargeted))).sort() as HallmarkId[];

  const rootCauses: string[] = [];
  if (flags.bioAgeAccelerated) rootCauses.push(`Biological age acceleration (+${flags.bioAgeGap.toFixed(1)} years)`);
  if (flags.mthfrVariant) rootCauses.push('Methylation limitation (MTHFR variant)');
  if (flags.comtSlow) rootCauses.push('Slow COMT (catecholamine clearance impaired)');
  if (flags.apoeRisk) rootCauses.push('ApoE4 variant — cardiovascular & cognitive risk');
  if (flags.gutDysbiosis) rootCauses.push('Gut dysbiosis / intestinal permeability');
  if (flags.truAgeOrganAccel.length > 0) rootCauses.push(`Accelerated organ aging: ${flags.truAgeOrganAccel.join(', ')}`);
  if (flags.nutrEval?.oxidative_stress_elevated) rootCauses.push('Elevated oxidative stress markers');
  if (rootCauses.length === 0) rootCauses.push('Optimization-focused protocol — no major dysfunction detected');

  const outcomes: string[] = [
    'Reduced biological age as measured by TruAge reassessment at Month 6',
    'Improved HRV baseline and recovery scores',
    'Optimized inflammatory markers (hs-CRP, homocysteine)',
    'Improved sleep architecture (deep + REM sleep)',
    'Enhanced cognitive clarity and energy',
  ];
  if (flags.truAgeOrganAccel.length > 0) outcomes.push(`Targeted improvement in accelerated organ systems`);
  if (flags.gutDysbiosis) outcomes.push('Restored gut microbiome diversity and barrier function');

  const contraindications: string[] = [];
  if (flags.pregnantOrNursing) contraindications.push('PREGNANT/NURSING: protocol heavily modified; no peptides, fasting, or senolytics until postpartum/post-wean');
  if (flags.hasCancer) contraindications.push('ACTIVE CANCER: senolytics, GH secretagogues, and stem cell peptides deferred until oncology clearance');
  if (flags.immunocompromised) contraindications.push('IMMUNOCOMPROMISED: rapamycin/mTOR inhibition not recommended');
  if (flags.hasDiabetes) contraindications.push('DIABETES: monitor blood glucose closely during fasting and GH-related interventions');
  if (flags.hasThyroid) contraindications.push('THYROID CONDITION: cold therapy and extended fasts require thyroid monitoring');
  if (flags.hasCardiovascular) contraindications.push('CARDIOVASCULAR DISEASE: sauna and HIIT intensity require physician clearance');

  const target = flags.bioAgeAccelerated ? Math.min(flags.bioAgeGap, 5) : 2;

  return {
    targetBiologicalAgeReduction: parseFloat(target.toFixed(1)),
    hallmarksAddressed: hallmarks,
    primaryRootCauses: rootCauses,
    expectedOutcomes: outcomes,
    contraindicationsFlagged: contraindications,
  };
}

function buildPractitionerReview(flags: Flags, months: MonthPlan[]): string[] {
  const items: string[] = [];

  const hasRapamycin = months.some(m => m.supplements.some(s => /rapamycin|sirolimus/i.test(s.name)));
  if (hasRapamycin) items.push('Rapamycin pulse protocol — requires physician prescription and monitoring');

  const hasInjectablePeptides = months.some(m => m.peptides.some(p => p.route === 'subcutaneous' || p.route === 'intramuscular'));
  if (hasInjectablePeptides) items.push('Injectable peptide protocols — require practitioner review and sourcing from compounding pharmacy');

  const hasExtendedFasts = months.some(m => /48|72/.test(m.fasting.protocol));
  if (hasExtendedFasts) items.push('Extended fasts (48-72h) — medical supervision recommended');

  if (flags.pregnantOrNursing) items.push('CRITICAL: Pregnant/nursing — full protocol review required before ANY intervention');
  if (flags.hasCancer) items.push('CRITICAL: Active malignancy — oncology clearance required');
  if (flags.immunocompromised) items.push('CRITICAL: Immunocompromised — modify or remove mTOR inhibitors');

  if (flags.nutrEval?.tsh_elevated && Number(flags.nutrEval?.tsh) > 10) {
    items.push(`CRITICAL LAB: TSH elevated (${flags.nutrEval.tsh}) — thyroid optimization before protocol start`);
  }
  if (flags.nutrEval?.glucose_fasting && Number(flags.nutrEval?.glucose_fasting) > 200) {
    items.push(`CRITICAL LAB: Fasting glucose >200 — diabetes management required before protocol`);
  }

  return items;
}

function buildSafetyNotes(): string[] {
  return [
    'This protocol is educational and informational, not medical advice. Consult a qualified healthcare provider before initiating.',
    'All peptides listed as injectable require prescription and clinical oversight.',
    'Stop any intervention that causes adverse symptoms and consult your practitioner.',
    'Fasting protocols are contraindicated for those with history of eating disorders, pregnancy, or uncontrolled diabetes.',
    'Senolytics and mTOR inhibitors are contraindicated in active cancer.',
    'Dose adjustments may be needed based on body weight, existing medications, and individual tolerance.',
  ];
}

// ───────────────────────────────────────────────────────────────
// Main entry: generate full protocol
// ───────────────────────────────────────────────────────────────

export function generateProtocolFromIntake(intake: IntakeInput): ProtocolOutput {
  const flags = buildFlags(intake);

  const months = [
    buildMonth1(flags),
    buildMonth2(flags),
    buildMonth3(flags),
    buildMonth4(flags),
    buildMonth5(flags),
    buildMonth6(flags),
  ];

  return {
    summary: buildSummary(flags, months),
    months,
    pulsingCalendar: buildPulsingCalendar(months),
    safetyNotes: buildSafetyNotes(),
    practitionerReviewRequired: buildPractitionerReview(flags, months),
  };
}
