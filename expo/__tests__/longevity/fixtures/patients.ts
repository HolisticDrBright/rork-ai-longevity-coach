/**
 * Synthetic test patients for the longevity A/B evaluation harness.
 * Matches `IntakeInput` shape from expo/backend/trpc/routes/longevity/schemas.ts.
 *
 * These fixtures cover the personalization axes we most care about:
 *   - Female pre-menopause with cycle-sync needs + genetic variants
 *   - Post-TRT male optimization
 *   - Post-partum with borderline thyroid
 *   - High cardiovascular risk + aggressive intervention
 *   - Injection-opposed vegan high-stress
 */

import type { IntakeInput } from '../../../backend/trpc/routes/longevity/schemas';

export interface TestPatient {
  fixtureId: string;
  name: string;
  notes: string;
  intake: IntakeInput;
}

export const TEST_PATIENTS: TestPatient[] = [
  {
    fixtureId: 'tp01-female-premeno-mthfr',
    name: 'Amelia · 45F · pre-menopause · bio age 52 · MTHFR het',
    notes:
      'Tests female cycle-sync logic, bio-age-accelerated targeting, MTHFR methylation adjustments, and NutrEval-driven repletion.',
    intake: {
      biologicalAge: 52,
      chronologicalAge: 45,
      weightCurrent: 162,
      weightIdeal: 140,
      height: 66,
      sex: 'female',
      menstrualStatus: 'pre_menopause',
      fitnessLevel: 'recreational',
      dietType: 'mediterranean',
      conditions: [],
      sensitivities: ['niacin flushing'],
      oppositions: [],
      longevityGoals: ['Reverse biological age', 'Improve biomarkers', 'Better sleep'],
      preferredBrands: ['Healthgevity', 'Quicksilver', 'NOVOS'],
      modalities: ['Sauna', 'Cold Plunge', 'Red Light', 'PEMF'],
      topComplaints: ['Low energy', 'Brain fog', 'Stubborn belly fat'],
      lifestyleFactors: ['High stress', 'Parent'],
      labs: {
        nutrEval: {
          zinc_low: true,
          b12_low: true,
          oxidative_stress_elevated: true,
        },
        genetics3x4: { mthfr: 'C677T', comt: 'normal', apoe: 'e3/e3' },
        truAge: { acceleratedOrgans: ['liver'] },
      },
      notes: 'Struggles with stress and sleep; wants non-aggressive start before peptides.',
    },
  },
  {
    fixtureId: 'tp02-male-post-trt-optimization',
    name: 'Marcus · 58M · post-TRT · bio age 48 · optimization',
    notes:
      'Good baseline. Tests optimization path without major contraindications, full modality stack.',
    intake: {
      biologicalAge: 48,
      chronologicalAge: 58,
      weightCurrent: 190,
      weightIdeal: 185,
      height: 72,
      sex: 'male',
      fitnessLevel: 'athletic',
      dietType: 'paleo',
      conditions: [],
      sensitivities: [],
      oppositions: [],
      longevityGoals: ['Athletic performance', 'Healthspan extension', 'Cognitive optimization'],
      preferredBrands: ['LVLUP', 'Quicksilver', 'StemRegen', 'C60 Wizard Sciences'],
      modalities: ['Sauna', 'Cold Plunge', 'Red Light', 'HBOT', 'PEMF', 'Vibration Plate'],
      topComplaints: ['Slower recovery', 'Occasional joint stiffness'],
      lifestyleFactors: ['Athlete'],
      labs: {
        nutrEval: {},
        truAge: { acceleratedOrgans: [] },
      },
      notes: 'On maintenance TRT. Wants aggressive longevity stack including injectables.',
    },
  },
  {
    fixtureId: 'tp03-female-postpartum-thyroid',
    name: 'Priya · 38F · post-partum · bio age 44 · borderline thyroid',
    notes:
      'Tests thyroid-related caveats on fasting and cold therapy, post-partum considerations.',
    intake: {
      biologicalAge: 44,
      chronologicalAge: 38,
      weightCurrent: 148,
      weightIdeal: 132,
      height: 65,
      sex: 'female',
      menstrualStatus: 'pre_menopause',
      fitnessLevel: 'recreational',
      dietType: 'standard',
      conditions: ['Thyroid condition'],
      sensitivities: [],
      oppositions: [],
      longevityGoals: ['Increase energy', 'Better sleep', 'Hormone optimization'],
      preferredBrands: ['Healthgevity', 'NOVOS'],
      modalities: ['Sauna', 'PEMF'],
      topComplaints: ['Exhaustion', 'Poor sleep', 'Brain fog'],
      lifestyleFactors: ['Parent', 'Caregiver', 'High stress'],
      labs: {
        nutrEval: { tsh: 6.2, tsh_elevated: true, iron_low: true },
        genetics3x4: { mthfr: 'normal', comt: 'slow' },
        truAge: { acceleratedOrgans: ['thymus'] },
      },
      notes: 'Nursing. Protocol must be conservative on fasting and injectables.',
    },
  },
  {
    fixtureId: 'tp04-male-cv-risk-apoe4',
    name: 'Walter · 62M · ApoE4 · bio age 68 · CV risk',
    notes:
      'Tests ApoE4 adjustments, cardiovascular caveats on HIIT/sauna, aggressive senolytic + NAD+ start.',
    intake: {
      biologicalAge: 68,
      chronologicalAge: 62,
      weightCurrent: 218,
      weightIdeal: 185,
      height: 71,
      sex: 'male',
      fitnessLevel: 'sedentary',
      dietType: 'standard',
      conditions: ['Cardiovascular disease'],
      sensitivities: [],
      oppositions: [],
      longevityGoals: ['Reverse biological age', 'Improve biomarkers'],
      preferredBrands: ['NOVOS', 'Healthgevity'],
      modalities: ['Sauna', 'PEMF', 'Vibration Plate'],
      topComplaints: ['Fatigue', 'Memory issues', 'High cholesterol'],
      lifestyleFactors: ['High stress'],
      labs: {
        nutrEval: {
          tsh: 3.1,
          glucose_fasting: 108,
          ldl_elevated: true,
          homocysteine_elevated: true,
        },
        genetics3x4: { mthfr: 'A1298C', comt: 'normal', apoe: 'e3/e4' },
        truAge: { acceleratedOrgans: ['heart', 'brain'] },
      },
      notes: 'Physician clearance recommended before HIIT or aggressive fasting.',
    },
  },
  {
    fixtureId: 'tp05-female-vegan-no-injections',
    name: 'Simone · 50F · peri-menopause · vegan · opposes injections',
    notes:
      'Tests injection substitutions (oral/nasal/transdermal), vegan substitutions, high-stress executive pattern.',
    intake: {
      biologicalAge: 49,
      chronologicalAge: 50,
      weightCurrent: 155,
      weightIdeal: 145,
      height: 67,
      sex: 'female',
      menstrualStatus: 'peri_menopause',
      fitnessLevel: 'recreational',
      dietType: 'vegan',
      conditions: [],
      sensitivities: [],
      oppositions: ['No injections', 'No meat (vegan)'],
      longevityGoals: ['Healthspan extension', 'Hormone optimization', 'Better sleep'],
      preferredBrands: ['NOVOS', 'Healthgevity', 'Quicksilver'],
      modalities: ['Red Light', 'Cold Plunge', 'PEMF'],
      topComplaints: ['Hot flashes', 'Insomnia', 'Decision fatigue'],
      lifestyleFactors: ['High stress', 'Frequent travel'],
      labs: {
        nutrEval: { b12_low: true, iron_low: true, zinc_low: true },
        genetics3x4: { mthfr: 'compound_het', comt: 'slow', apoe: 'e3/e3' },
        dutch: { cortisol_pattern: 'low' },
        truAge: { acceleratedOrgans: ['pineal'] },
      },
      notes: 'Explicitly no injectables; everything must be oral, nasal, or transdermal.',
    },
  },
];
