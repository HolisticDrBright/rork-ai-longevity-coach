/**
 * Patient context builder — pulls everything the analyzer prompts need
 * (`{{age}}`, `{{cycle_day}}`, `{{recent_lab_flags_csv}}`, etc.) from
 * the existing Supabase tables and renders it into the prompt template.
 *
 * Single source of truth for what context goes into every analyzer call.
 * If you find yourself building context inline in an analyzer, refactor
 * back to this file.
 *
 * Data sources (mapped to spec field names):
 *   - profiles                       → age, sex, dateOfBirth
 *   - hormone_entries.cycle_day      → cycle_day (if female + within 14d)
 *   - clinical_intakes               → chief_complaint_text
 *   - contraindications              → medical_history_flags_csv (pregnant, nursing,
 *                                       medications, conditions, allergies)
 *   - protocols (active)             → active_protocols_csv
 *   - profiles.paradigm_preferences  → paradigm_preferences_csv (Addendum #1 field;
 *                                       falls back to ['western','functional'] if absent)
 *   - visual_findings (previous)     → previous_summary, days_since_last
 *   - lab_markers (flagged)          → recent_lab_flags_csv (filtered by
 *                                       LAB_FLAG_RELEVANCE for this modality)
 *   - symptom_logs (14d) +
 *     daily_subjective_rollups (14d) → symptom_rollup_csv
 *
 * The "daily_checkins" table referenced in the spec doesn't exist as
 * named in this repo — symptom_logs + daily_subjective_rollups are the
 * functional equivalent.
 */

import { Modality } from './observation-taxonomy';

// ────────────────────────────────────────────────────────────
// LAB_FLAG_RELEVANCE — Dr. Bright's part 4 #3 confirmed seed.
// Modality-relevance map for filtering which abnormal lab markers
// appear in each analyzer's context block. Keys mirror the
// supplement_contraindication_rules + biomarker naming we already use;
// the recon report confirmed the existing lab_markers table holds the
// underlying values. Editable post-launch via admin portal.
// ────────────────────────────────────────────────────────────
export const LAB_FLAG_RELEVANCE: Record<string, Modality[]> = {
  // Iron / anemia panel
  ferritin_low: ['nails', 'tongue', 'tcm_face', 'skin'],
  iron_low: ['nails', 'tongue', 'tcm_face'],
  tibc_high: ['nails', 'tongue'],
  hemoglobin_low: ['nails', 'tongue', 'tcm_face', 'skin'],
  // B vitamins
  b12_low: ['nails', 'tongue'],
  mma_high: ['nails', 'tongue'],
  homocysteine_high: ['skin', 'tcm_face', 'tongue'],
  folate_low: ['nails', 'tongue'],
  // Inflammation
  hs_crp_high: ['skin', 'tcm_face', 'tongue', 'nails'],
  il_6_high: ['skin', 'tcm_face'],
  esr_high: ['skin', 'tcm_face'],
  // Cortisol / stress (Dutch)
  cortisol_rhythm_abnormal: ['skin', 'tcm_face', 'tongue', 'nails', 'iris'],
  dhea_low: ['skin', 'tcm_face'],
  // Metabolic
  hba1c_high: ['skin'],
  fasting_glucose_high: ['skin'],
  triglycerides_high: ['skin', 'tongue'],
  // Thyroid
  tsh_abnormal: ['skin', 'nails', 'tcm_face'],
  free_t3_low: ['skin', 'nails', 'tcm_face'],
  free_t4_low: ['skin', 'nails', 'tcm_face'],
  tpo_antibodies_positive: ['skin', 'nails'],
  reverse_t3_high: ['skin', 'nails'],
  // Sex hormones
  estrogen_high: ['skin', 'tcm_face'],
  estrogen_low: ['skin', 'tcm_face'],
  progesterone_low: ['skin', 'tcm_face'],
  testosterone_high: ['skin', 'tcm_face'],
  testosterone_low: ['skin', 'tcm_face'],
  dhea_s_low: ['skin', 'tcm_face'],
  // Vitamin D
  vitamin_d_low: ['skin', 'nails', 'iris'],
  // Liver
  alt_high: ['tcm_face', 'tongue', 'skin'],
  ast_high: ['tcm_face', 'tongue', 'skin'],
  ggt_high: ['tcm_face', 'tongue'],
  bilirubin_high: ['tcm_face', 'iris'],
  // Kidney
  creatinine_high: ['tcm_face'],
  egfr_low: ['tcm_face'],
  // GI-MAP findings
  sibo_positive: ['tongue', 'tcm_face'],
  dysbiosis_significant: ['tongue', 'tcm_face', 'skin'],
  candida_high: ['tongue', 'skin', 'nails'],
  parasites_positive: ['tongue', 'tcm_face', 'skin', 'nails'],
  // Mycotoxin / heavy metals
  mycotoxin_burden_high: ['skin', 'tongue', 'iris'],
  mercury_high: ['nails', 'tcm_face', 'iris'],
  // EBV / viral
  ebv_active: ['tcm_face', 'tongue', 'skin'],
  // Lipids (visible signs)
  ldl_very_high: ['tcm_face'],
};

export interface PatientContextInput {
  userId: string;
  modality: Modality;
  // Pulled by the caller from the Supabase service-role client.
  supabase: {
    from: (table: string) => any;
  };
  // Session-level inputs (tongue extras, iris eye color, etc.).
  sessionInputs?: Record<string, unknown>;
}

export interface RenderedPatientContext {
  age: number | null;
  sex: string | null;
  cycle_day: number | null;
  chief_complaint_text: string;
  medical_history_flags_csv: string;
  active_protocols_csv: string;
  paradigm_preferences_csv: string;
  days_since_last: number | null;
  previous_summary: string;
  recent_lab_flags_csv: string;
  symptom_rollup_csv: string;
  // Tongue-specific session inputs (pass-through when modality === 'tongue')
  time_since_food_min: number | null;
  time_since_brushed_min: number | null;
  recent_intake_colored_foods: boolean | null;
  // Iridology-specific (pass-through when modality === 'iris')
  eye_color_self_reported: string | null;
}

function ageFromBirthDate(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function csv(values: Array<string | null | undefined>): string {
  const cleaned = values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return cleaned.length > 0 ? cleaned.join(', ') : 'none';
}

/**
 * Reads the patient's relevant context from Supabase. Always called with
 * a service-role client because analyzer code runs server-side in an
 * edge function.
 */
export async function buildPatientContext(
  input: PatientContextInput,
): Promise<RenderedPatientContext> {
  const { userId, modality, supabase, sessionInputs } = input;

  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString();

  const [
    profileRes,
    intakeRes,
    contraRes,
    protocolsRes,
    hormoneRes,
    prevFindingRes,
    labMarkersRes,
    symptomLogsRes,
    subjectiveRollupRes,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('sex, birth_date, paradigm_preferences')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('clinical_intakes')
      .select('chief_complaint_json, associated_symptoms_json')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('contraindications')
      .select('pregnant, nursing, medications, allergies, conditions')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('protocols')
      .select('name, status')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(20),
    supabase
      .from('hormone_entries')
      .select('cycle_day, date')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('visual_findings')
      .select('summary_text, created_at')
      .eq('user_id', userId)
      .eq('modality', modality)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('lab_markers')
      .select('marker_name, marker_value, unit, reference_range_low, reference_range_high, collected_at')
      .eq('user_id', userId)
      .gte('collected_at', sixMonthsAgo)
      .order('collected_at', { ascending: false })
      .limit(100),
    supabase
      .from('symptom_logs')
      .select('symptom_name, severity')
      .eq('user_id', userId)
      .gte('logged_at', fourteenDaysAgo),
    supabase
      .from('daily_subjective_rollups')
      .select('date, energy_avg, stress_avg, soreness_avg, mood_avg')
      .eq('user_id', userId)
      .gte('date', fourteenDaysAgo.slice(0, 10))
      .order('date', { ascending: false }),
  ]);

  const profile = (profileRes.data as { sex?: string; birth_date?: string; paradigm_preferences?: string[] } | null) ?? null;
  const intake = (intakeRes.data as { chief_complaint_json?: Record<string, unknown>; associated_symptoms_json?: Array<{ name?: string }> } | null) ?? null;
  const contra = (contraRes.data as { pregnant?: boolean; nursing?: boolean; medications?: string[]; allergies?: string[]; conditions?: string[] } | null) ?? null;
  const protocols = ((protocolsRes.data as Array<{ name?: string }>) ?? []).map(p => p.name).filter(Boolean) as string[];
  const cycleDayRow = hormoneRes.data as { cycle_day?: number; date?: string } | null;
  const prevFinding = (prevFindingRes.data as { summary_text?: string; created_at?: string } | null) ?? null;
  const labMarkers = (labMarkersRes.data as Array<{ marker_name: string; marker_value: number; unit: string; reference_range_low: number | null; reference_range_high: number | null; collected_at: string }>) ?? [];
  const symptomLogs = (symptomLogsRes.data as Array<{ symptom_name: string; severity: number | null }>) ?? [];
  const subjectiveRollups = (subjectiveRollupRes.data as Array<{ date: string; energy_avg: number | null; stress_avg: number | null; soreness_avg: number | null; mood_avg: number | null }>) ?? [];

  // ── Age + sex ──
  const age = ageFromBirthDate(profile?.birth_date ?? null);
  const sex = profile?.sex ?? null;

  // ── Cycle day: only meaningful if female + a recent hormone entry exists ──
  let cycleDay: number | null = null;
  if (sex === 'female' && cycleDayRow?.date && cycleDayRow.cycle_day != null) {
    const daysOld = (Date.now() - new Date(cycleDayRow.date).getTime()) / 86400000;
    if (daysOld <= 14) {
      cycleDay = Math.round(cycleDayRow.cycle_day + daysOld);
    }
  }

  // ── Chief complaint ──
  const chiefComplaintText = (() => {
    const cc = intake?.chief_complaint_json as Record<string, unknown> | undefined;
    if (!cc) return 'No chief complaint recorded.';
    if (typeof cc.text === 'string') return cc.text;
    if (typeof cc.description === 'string') return cc.description;
    return JSON.stringify(cc).slice(0, 500);
  })();

  // ── Medical history flags ──
  const historyFlags: string[] = [];
  if (contra?.pregnant) historyFlags.push('pregnant');
  if (contra?.nursing) historyFlags.push('nursing');
  for (const c of contra?.conditions ?? []) historyFlags.push(`condition:${c}`);
  for (const a of contra?.allergies ?? []) historyFlags.push(`allergy:${a}`);
  for (const m of contra?.medications ?? []) historyFlags.push(`medication:${m}`);

  // ── Paradigm preferences (Addendum #1 field; not yet in profile schema
  // in this repo — fall back to a sensible default that still produces
  // a useful narrative_by_paradigm).
  const paradigmPrefs = (profile?.paradigm_preferences as string[] | undefined) ?? ['western', 'functional'];

  // ── Previous session summary + days_since_last ──
  const daysSinceLast = prevFinding?.created_at
    ? Math.round((Date.now() - new Date(prevFinding.created_at).getTime()) / 86400000)
    : null;
  const previousSummary = prevFinding?.summary_text ?? 'No previous session.';

  // ── Recent lab flags — filtered through LAB_FLAG_RELEVANCE for this modality ──
  const labFlagsForModality: string[] = [];
  for (const marker of labMarkers) {
    const lname = marker.marker_name.toLowerCase();
    // Map raw lab_markers rows to the abstract LAB_FLAG_RELEVANCE keys.
    const candidateKeys = mapLabRowToFlagKeys(lname, marker.marker_value, marker.reference_range_low, marker.reference_range_high);
    for (const key of candidateKeys) {
      const relevantModalities = LAB_FLAG_RELEVANCE[key];
      if (relevantModalities?.includes(modality)) {
        labFlagsForModality.push(`${key} (${marker.marker_value} ${marker.unit})`);
      }
    }
  }
  // Dedup
  const labFlagsCsv = csv(Array.from(new Set(labFlagsForModality)));

  // ── Symptom rollup (14-day): combine symptom_logs counts + rollup averages ──
  const symptomCounts = new Map<string, number>();
  for (const s of symptomLogs) {
    if ((s.severity ?? 0) < 2) continue;
    symptomCounts.set(s.symptom_name, (symptomCounts.get(s.symptom_name) ?? 0) + 1);
  }
  const symptomFreqStrings = Array.from(symptomCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => `${name}: ${count}/14d`);
  // Add subjective averages if we have any
  if (subjectiveRollups.length > 0) {
    const avgEnergy = avgOf(subjectiveRollups.map(r => r.energy_avg));
    const avgStress = avgOf(subjectiveRollups.map(r => r.stress_avg));
    if (avgEnergy != null) symptomFreqStrings.push(`avg_energy: ${avgEnergy.toFixed(1)}/10`);
    if (avgStress != null) symptomFreqStrings.push(`avg_stress: ${avgStress.toFixed(1)}/10`);
  }
  const symptomRollupCsv = csv(symptomFreqStrings);

  // ── Session-input passthrough ──
  const tongueInputs = sessionInputs as { time_since_food_min?: number; time_since_brushed_min?: number; recent_intake_colored_foods?: boolean } | undefined;
  const irisInputs = sessionInputs as { eye_color_self_reported?: string } | undefined;

  return {
    age,
    sex,
    cycle_day: cycleDay,
    chief_complaint_text: chiefComplaintText,
    medical_history_flags_csv: csv(historyFlags),
    active_protocols_csv: csv(protocols),
    paradigm_preferences_csv: csv(paradigmPrefs),
    days_since_last: daysSinceLast,
    previous_summary: previousSummary,
    recent_lab_flags_csv: labFlagsCsv,
    symptom_rollup_csv: symptomRollupCsv,
    time_since_food_min: tongueInputs?.time_since_food_min ?? null,
    time_since_brushed_min: tongueInputs?.time_since_brushed_min ?? null,
    recent_intake_colored_foods: tongueInputs?.recent_intake_colored_foods ?? null,
    eye_color_self_reported: irisInputs?.eye_color_self_reported ?? null,
  };
}

function avgOf(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

/**
 * Maps raw lab_markers row to the abstract LAB_FLAG_RELEVANCE key set.
 * We pattern-match the marker name (case-insensitive) and the value
 * against the reference range. The recon report flagged this as a
 * naming-drift risk — surface any markers whose names don't match by
 * looking at the "unmatched" branch.
 */
function mapLabRowToFlagKeys(
  lname: string,
  value: number,
  refLow: number | null,
  refHigh: number | null,
): string[] {
  const flags: string[] = [];
  const high = refHigh != null && value > refHigh;
  const low = refLow != null && value < refLow;

  if (lname.includes('ferritin') && low) flags.push('ferritin_low');
  if (lname === 'iron' && low) flags.push('iron_low');
  if (lname.includes('hemoglobin') && low) flags.push('hemoglobin_low');
  if (lname.includes('b12') || lname.includes('cobalamin')) {
    if (low) flags.push('b12_low');
  }
  if (lname.includes('methylmalonic') && high) flags.push('mma_high');
  if (lname.includes('homocysteine') && high) flags.push('homocysteine_high');
  if (lname.includes('folate') && low) flags.push('folate_low');
  if ((lname.includes('crp') || lname.includes('c-reactive')) && high) flags.push('hs_crp_high');
  if (lname.includes('hba1c') && high) flags.push('hba1c_high');
  if (lname.includes('glucose') && lname.includes('fasting') && high) flags.push('fasting_glucose_high');
  if (lname.includes('triglyceride') && high) flags.push('triglycerides_high');
  if (lname === 'tsh' && (low || high)) flags.push('tsh_abnormal');
  if (lname.includes('free t3') && low) flags.push('free_t3_low');
  if (lname.includes('free t4') && low) flags.push('free_t4_low');
  if (lname.includes('reverse t3') && high) flags.push('reverse_t3_high');
  if ((lname.includes('vitamin d') || lname.includes('25-oh') || lname.includes('25(oh)')) && low) flags.push('vitamin_d_low');
  if (lname === 'alt' && high) flags.push('alt_high');
  if (lname === 'ast' && high) flags.push('ast_high');
  if (lname === 'ggt' && high) flags.push('ggt_high');
  if (lname.includes('bilirubin') && high) flags.push('bilirubin_high');
  if (lname.includes('creatinine') && high) flags.push('creatinine_high');
  if (lname === 'egfr' && low) flags.push('egfr_low');
  if (lname === 'estradiol' || lname.includes('estrogen')) {
    if (high) flags.push('estrogen_high');
    if (low) flags.push('estrogen_low');
  }
  if (lname.includes('progesterone') && low) flags.push('progesterone_low');
  if (lname.includes('testosterone')) {
    if (high) flags.push('testosterone_high');
    if (low) flags.push('testosterone_low');
  }
  if (lname.includes('dhea')) {
    if (low) flags.push('dhea_low');
    if (lname.includes('dhea-s') || lname.includes('dhea s')) {
      if (low) flags.push('dhea_s_low');
    }
  }
  if (lname.includes('ldl') && value > 190) flags.push('ldl_very_high');

  return flags;
}

/**
 * Token-replace `{{var}}` placeholders in a prompt template with the
 * rendered context values. Used by every analyzer.
 */
export function renderContextIntoPrompt(
  template: string,
  ctx: RenderedPatientContext,
): string {
  const lookup: Record<string, string> = {
    age: ctx.age != null ? String(ctx.age) : 'unknown',
    sex: ctx.sex ?? 'unknown',
    cycle_day: ctx.cycle_day != null ? String(ctx.cycle_day) : 'n/a',
    chief_complaint_text: ctx.chief_complaint_text,
    medical_history_flags_csv: ctx.medical_history_flags_csv,
    active_protocols_csv: ctx.active_protocols_csv,
    paradigm_preferences_csv: ctx.paradigm_preferences_csv,
    days_since_last: ctx.days_since_last != null ? String(ctx.days_since_last) : 'n/a',
    previous_summary: ctx.previous_summary,
    recent_lab_flags_csv: ctx.recent_lab_flags_csv,
    symptom_rollup_csv: ctx.symptom_rollup_csv,
    time_since_food_min: ctx.time_since_food_min != null ? String(ctx.time_since_food_min) : 'n/a',
    time_since_brushed_min: ctx.time_since_brushed_min != null ? String(ctx.time_since_brushed_min) : 'n/a',
    recent_intake_colored_foods: ctx.recent_intake_colored_foods == null ? 'unknown' : ctx.recent_intake_colored_foods ? 'true' : 'false',
    eye_color_self_reported: ctx.eye_color_self_reported ?? 'unknown',
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => lookup[key] ?? `{{${key}}}`);
}
