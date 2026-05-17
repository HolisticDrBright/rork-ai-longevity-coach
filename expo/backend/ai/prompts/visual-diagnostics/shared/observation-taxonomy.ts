/**
 * Shared observation taxonomy — the contract that lets findings from
 * different modalities combine in the cross-modality correlator.
 *
 * MIRROR: this enum is mirrored into the `cross_modality_tag_taxonomy`
 * documentation table by migration 20260513000006. Keep both in sync:
 * adding a tag here requires a follow-up migration that inserts the new
 * row into the table, and the validator below rejects any tag not in
 * this enum at write time.
 *
 * Tag format: `{namespace}.{slug}`. The Zod validator + DB CHECK constraint
 * keep analyzer outputs honest.
 */

export const OBSERVATION_TAGS = [
  // pattern.* — TCM constitutional / pattern observations
  'pattern.qi_deficiency',
  'pattern.qi_excess',
  'pattern.yin_deficiency',
  'pattern.yang_deficiency',
  'pattern.blood_deficiency',
  'pattern.blood_stasis',
  'pattern.liver_qi_stagnation',
  'pattern.spleen_qi_deficiency',
  'pattern.kidney_yin_deficiency',
  'pattern.kidney_yang_deficiency',
  'pattern.damp_heat',
  'pattern.cold_damp',
  'pattern.phlegm_damp',
  'pattern.stomach_heat',
  'pattern.heat_internal',
  'pattern.cold_internal',
  'pattern.excess_pattern',
  'pattern.deficiency_pattern',
  'pattern.heart_shen_disturbance',
  // lifestyle.* — observable lifestyle / load patterns
  'lifestyle.poor_sleep_appearance',
  'lifestyle.dehydration_signs',
  'lifestyle.high_stress_load',
  'lifestyle.high_inflammation_appearance',
  // nutrient.* — visual patterns commonly associated with nutrient insufficiency
  'nutrient.iron_insufficiency_pattern',
  'nutrient.b12_insufficiency_pattern',
  'nutrient.protein_insufficiency_pattern',
  'nutrient.zinc_insufficiency_pattern',
  'nutrient.biotin_insufficiency_pattern',
  // system.* — terrain / system observations
  'system.circulation_compromise',
  'system.lymphatic_burden',
  'system.detox_pathway_burden',
  'system.gut_dysbiosis_appearance',
  'system.hormonal_imbalance_appearance',
  // aging.* — aging-related visible loads
  'aging.glycation_load',
  'aging.oxidative_stress_load',
  'aging.collagen_decline',
  'aging.uv_exposure_load',
  // redflag.* — escalation tags; route to practitioner queue + clinic_alert_events
  'redflag.requires_in_person_eval',
  'redflag.dermatology_referral',
  'redflag.dermatology_pigmented_lesion',
  'redflag.cardiopulmonary_referral',
  'redflag.hepatic_referral',
] as const;

export type ObservationTag = typeof OBSERVATION_TAGS[number];

const OBSERVATION_TAG_SET: Set<string> = new Set(OBSERVATION_TAGS);

export function isValidObservationTag(tag: string): tag is ObservationTag {
  return OBSERVATION_TAG_SET.has(tag);
}

/**
 * Strips any tag not in the canonical taxonomy. Called from the analyzer
 * post-processing path so a hallucinated tag silently drops rather than
 * blocking the whole session. We do log unknowns to Sentry so prompt
 * drift surfaces.
 */
export function filterToValidTags(tags: string[]): ObservationTag[] {
  return tags.filter((t): t is ObservationTag => OBSERVATION_TAG_SET.has(t));
}

/**
 * Same as above but for the {tag: confidence} jsonb output. Drops unknown
 * keys and clamps confidence to [0, 1].
 */
export function filterToValidTagsWithConfidence(
  tagsWithConfidence: Record<string, number>,
): Record<ObservationTag, number> {
  const out: Partial<Record<ObservationTag, number>> = {};
  for (const [k, v] of Object.entries(tagsWithConfidence)) {
    if (!OBSERVATION_TAG_SET.has(k)) continue;
    const clamped = Math.max(0, Math.min(1, Number(v) || 0));
    out[k as ObservationTag] = clamped;
  }
  return out as Record<ObservationTag, number>;
}

/**
 * Modality enum — keep in sync with visual_session_images.modality CHECK constraint
 * and the patient-context-builder LAB_FLAG_RELEVANCE map.
 */
export const MODALITIES = ['skin', 'tcm_face', 'tongue', 'nails', 'iris'] as const;
export type Modality = typeof MODALITIES[number];

/**
 * Image angle enum — keep in sync with visual_session_images.angle CHECK constraint.
 */
export const ANGLES = [
  'portrait',
  'tongue_extended',
  'hand_palms_down',
  'right_straight',
  'left_straight',
  'right_left_gaze',
  'left_right_gaze',
  'right_upper_gaze',
  'left_lower_gaze',
] as const;
export type Angle = typeof ANGLES[number];
