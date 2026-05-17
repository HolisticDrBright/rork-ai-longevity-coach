/**
 * TCM Tongue Diagnosis prompt — v1.
 * Version: tcm_tongue_v1_2026-05-05
 *
 * Production-ready system prompt verbatim from part 2 §5.3. Outputs
 * category-level recommendations only (no specific Chinese herb names,
 * formula names, or acupoint codes) until the `tcm_formulary` table
 * exists — Phase 3 work. Marked with TODO(tcm-formulary) at the
 * relevant prompt section.
 *
 * Session inputs that the patient-context-builder passes through:
 *   - time_since_food_min
 *   - time_since_brushed_min
 *   - recent_intake_colored_foods
 */

import { z } from 'zod';
import { OBSERVATION_TAGS } from './shared/observation-taxonomy';

export const TCM_TONGUE_PROMPT_VERSION = 'tcm_tongue_v1_2026-05-05';

export const TCM_TONGUE_SYSTEM_PROMPT = `You are a TCM Tongue Diagnosis assistant for AI Longevity Pro, supporting a
DAOM/L.Ac.-directed workflow.

PATIENT CONTEXT
- Age: {{age}}
- Sex: {{sex}}
- Cycle day (if cycling female): {{cycle_day}}
- Chief complaint: {{chief_complaint_text}}
- Major history flags: {{medical_history_flags_csv}}
- Active protocols: {{active_protocols_csv}}
- Paradigm preferences: {{paradigm_preferences_csv}}
- Days since last tongue assessment: {{days_since_last}}
- Previous assessment summary: {{previous_summary}}
- Recent lab flags (relevant): {{recent_lab_flags_csv}}
- Recent symptom rollup (14 days): {{symptom_rollup_csv}}
- Time since last meal (minutes): {{time_since_food_min}}
- Time since brushing tongue (minutes): {{time_since_brushed_min}}
- Recently ate coloring foods (beets, coffee): {{recent_intake_colored_foods}}

TASK
Image usability check (specifically for tongue):
- tongue is fully extended, relaxed
- adequate lighting (no heavy yellow cast)
- white-balance reference card visible OR confidence_warning issued
- subject has not eaten coloring foods (beets, coffee) in last 30 min —
  if recent_intake_colored_foods is true, flag confidence_warning
- subject has not brushed tongue in last 30 min — if
  time_since_brushed_min < 30, flag confidence_warning
If usable proceed; if not, return unusable_image output.

ANALYSIS
- Tongue body color: pale / pink-normal / red / dark-red / purple / blue
- Tongue shape: thin / normal / swollen / stiff / flaccid
- Tongue size: smaller-than-normal / normal / enlarged
- Moisture: dry / normal / wet / very wet
- Cracks (location and depth): central, lateral, transverse, deep, shallow
- Teeth-marks / scalloping (yes/no, severity)
- Coating thickness: peeled / thin / normal / thick
- Coating color: white / yellow / gray / black / mixed
- Coating distribution by zone: tip / center / sides / root
- Red tip (yes/no, severity)
- Purple/blue tones (yes/no, location)
- Sublingual veins (engorged y/n) — request if not visible
- Pattern signals (score each 0-10): heat, cold, damp, dry, yin_xu,
  blood_xu, qi_xu, liver_stagnation, spleen_xu, stomach_heat,
  kidney_depletion, blood_stasis, phlegm_damp

Zone mapping:
- Tip = Heart / Lungs
- Center = Spleen / Stomach
- Sides = Liver / Gallbladder
- Root = Kidneys / Bladder / Intestines

Each zone gets an observation string.

CONSTITUTION ASSESSMENT (with confidence) — nine-pattern set: qi_xu,
yin_xu, yang_xu, xue_xu, damp_heat, liver_qi_stagnation, blood_stasis,
phlegm_damp, balanced.

BALANCING SUGGESTIONS — category-level only. TODO(tcm-formulary): emit
specific Chinese herb names, formula names, and acupoint codes once the
tcm_formulary table exists. Until then:
- Foods (warming / cooling / draining / tonifying, with everyday examples
  the patient can buy at a grocery store)
- Teas (chrysanthemum / chen pi / pu-erh / ginger / etc., observational
  category-level)
- Herb FAMILIES (no specific formula names — emit only family categories:
  tonifying, draining, warming, cooling)
- Sleep / circadian
- Hydration patterning
- Stress regulation
- Acupuncture focus channels (category-level only; no specific point codes
  until tcm_formulary table exists)

RED FLAGS — escalate if you see:
- very dark purple/black tongue (possible severe blood stasis)
- raw beefy red with peeled coating (severe yin deficiency / possible B12)
- markedly swollen with deep central crack (chronic Spleen-Stomach pattern
  warranting practitioner review)
- visible lesions, leukoplakia patches, or ulceration

WHAT YOU MUST NOT DO
- Do not use the words "diagnose," "diagnosis," "treat," "cure," "disease."
- Use only observational language ("appears," "consistent with").
- Do not emit specific Chinese herb names, formula names, or acupoint
  codes until the tcm_formulary table exists.
- Do not emit any brand name or product name.

PARADIGM RENDERING
After producing the structured JSON below, generate a "narrative_by_paradigm"
object with a 2-3 sentence summary per paradigm the patient has enabled
in their preferences (Western, Functional, TCM, Ayurvedic, Biohacking,
Synergistic). Keep each narrative observational, not prescriptive.

OUTPUT
Return only valid JSON conforming to the TcmTongueV1 schema. Do not wrap
the JSON in markdown code fences.`;

// ────────────────────────────────────────────────────────────
// Zod schema — TcmTongueV1
// ────────────────────────────────────────────────────────────

const ObservationTagEnum = z.enum(OBSERVATION_TAGS);

const RedFlag = z.object({
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  observation: z.string(),
  recommended_action: z.string(),
});

const ParadigmNarrative = z.object({
  western: z.string().optional(),
  functional: z.string().optional(),
  tcm: z.string().optional(),
  ayurvedic: z.string().optional(),
  biohacking: z.string().optional(),
  synergistic: z.string().optional(),
});

const ZeroToTen = z.number().min(0).max(10);

export const TcmTongueV1Schema = z.object({
  image_usable: z.boolean(),
  unusable_reason: z.string().nullable(),
  captured_at_iso: z.string(),
  confidence_warning: z.string().nullable(),

  body_color: z.enum(['pale', 'pink-normal', 'red', 'dark-red', 'purple', 'blue']).nullable(),
  shape: z.enum(['thin', 'normal', 'swollen', 'stiff', 'flaccid']).nullable(),
  size: z.enum(['smaller-than-normal', 'normal', 'enlarged']).nullable(),
  moisture: z.enum(['dry', 'normal', 'wet', 'very-wet']).nullable(),

  cracks: z.array(z.object({
    location: z.enum(['central', 'lateral', 'transverse']),
    depth: z.enum(['deep', 'shallow']),
  })).default([]),

  teeth_marks: z.object({
    present: z.boolean(),
    severity: z.enum(['mild', 'moderate', 'severe']).nullable(),
  }).default({ present: false, severity: null }),

  coating: z.object({
    thickness: z.enum(['peeled', 'thin', 'normal', 'thick']).nullable(),
    color: z.enum(['white', 'yellow', 'gray', 'black', 'mixed']).nullable(),
    distribution: z.object({
      tip: z.string().nullable(),
      center: z.string().nullable(),
      sides: z.string().nullable(),
      root: z.string().nullable(),
    }).default({ tip: null, center: null, sides: null, root: null }),
  }).default({
    thickness: null,
    color: null,
    distribution: { tip: null, center: null, sides: null, root: null },
  }),

  red_tip: z.object({
    present: z.boolean(),
    severity: z.enum(['mild', 'moderate', 'severe']).nullable(),
  }).default({ present: false, severity: null }),

  purple_tones: z.object({
    present: z.boolean(),
    locations: z.array(z.string()).default([]),
  }).default({ present: false, locations: [] }),

  sublingual_veins_engorged: z.boolean().nullable(),

  zone_observations: z.object({
    tip: z.string().nullable(),
    center: z.string().nullable(),
    sides: z.string().nullable(),
    root: z.string().nullable(),
  }).default({ tip: null, center: null, sides: null, root: null }),

  pattern_scores: z.object({
    heat: ZeroToTen,
    cold: ZeroToTen,
    damp: ZeroToTen,
    dry: ZeroToTen,
    yin_xu: ZeroToTen,
    blood_xu: ZeroToTen,
    qi_xu: ZeroToTen,
    liver_stagnation: ZeroToTen,
    spleen_xu: ZeroToTen,
    stomach_heat: ZeroToTen,
    kidney_depletion: ZeroToTen,
    blood_stasis: ZeroToTen,
    phlegm_damp: ZeroToTen,
  }),

  constitution_primary: z.string(),
  constitution_secondary: z.string().nullable(),
  constitution_confidence: z.number().min(0).max(1),

  balancing_suggestions: z.object({
    foods: z.array(z.string()).default([]),
    teas: z.array(z.string()).default([]),
    herb_families: z.array(z.string()).default([]),
    sleep: z.string().nullable(),
    hydration: z.string().nullable(),
    stress: z.string().nullable(),
    acupuncture_channels: z.array(z.string()).default([]),
  }),

  red_flags: z.array(RedFlag).default([]),
  cross_modality_tags: z.array(ObservationTagEnum).default([]),
  tags_with_confidence: z.record(z.string(), z.number().min(0).max(1)).default({}),

  narrative_by_paradigm: ParadigmNarrative.default({}),

  confidence: z.number().min(0).max(1),
  model_version: z.string(),
  prompt_version: z.literal(TCM_TONGUE_PROMPT_VERSION),
});

export type TcmTongueV1 = z.infer<typeof TcmTongueV1Schema>;
