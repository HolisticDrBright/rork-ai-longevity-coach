/**
 * Supabase Edge Function: visual-analysis
 *
 * Per-modality analyzer orchestrator. Invoked by the client once an
 * image is uploaded for a given (session_id, modality, angle). One
 * invocation = one Claude vision call = one visual_findings row.
 *
 * Fan-out pattern: the client invokes this function once per modality
 * in parallel. The visual-correlator function watches for all
 * per-modality findings to complete before running cross-modality fusion.
 *
 * Architecture notes:
 *   - Direct Anthropic Messages API fetch. The repo's @rork-ai/toolkit-sdk
 *     is a client-side abstraction and isn't validated for Deno. When
 *     the toolkit SDK adds a server-side path, swap the inner call.
 *   - System prompts are inlined and MUST stay in sync with
 *     expo/backend/ai/prompts/visual-diagnostics/{skin,tcm-tongue}-v1.ts.
 *     Bumping a prompt requires touching both files + the prompt_version
 *     literal.
 *   - Zod schemas are NOT used here for full validation (would need a
 *     Deno-compatible mirror). We do a shape sanity check and trust the
 *     analyzer's output structure for the persist step; downstream
 *     consumers (correlator, dashboard) do their own validation.
 *   - Retry on JSON parse failure (mirror of generate-with-retry.ts):
 *     up to 2 attempts total, on second failure we set
 *     visual_findings.error_msg and bail.
 *
 * Deploy: supabase functions deploy visual-analysis
 * Required env:
 *   ANTHROPIC_API_KEY
 *   ANTHROPIC_MODEL (optional, defaults to claude-opus-4-7)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const ANTHROPIC_MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-4-7';

const STORAGE_BUCKET = 'visual-diagnostics';

// ────────────────────────────────────────────────────────────
// Inlined prompts — MUST stay in sync with
// expo/backend/ai/prompts/visual-diagnostics/{skin,tcm-tongue}-v1.ts
// ────────────────────────────────────────────────────────────

const SKIN_PROMPT_VERSION = 'skin_v1_2026-05-05';
const TCM_TONGUE_PROMPT_VERSION = 'tcm_tongue_v1_2026-05-05';

const SKIN_SYSTEM_PROMPT = `You are a Visual Skin Analysis assistant for AI Longevity Pro, a clinical
decision-support platform directed by Dr. Brandon Bright, DAOM, L.Ac. You are
not a doctor and you do not diagnose. You produce observational pattern
analysis to support a licensed clinician's workflow.

PATIENT CONTEXT (provided by the app):
- Age: {{age}}
- Sex: {{sex}}
- Cycle day (if cycling female): {{cycle_day}}
- Chief complaint (free text): {{chief_complaint_text}}
- Major history flags: {{medical_history_flags_csv}}
- Active protocols: {{active_protocols_csv}}
- Paradigm preferences (patient): {{paradigm_preferences_csv}}
- Days since last skin assessment: {{days_since_last}}
- Previous assessment summary (if any): {{previous_summary}}
- Recent lab flags (relevant): {{recent_lab_flags_csv}}
- Recent symptom rollup (14 days): {{symptom_rollup_csv}}

TASK
First, evaluate whether the supplied portrait image is usable for analysis:
well-lit, in focus, face centered, eyes open, no heavy makeup or filters,
live subject not a photo-of-photo. If unusable, return the unusable_image
output and stop.

If usable, analyze visible skin observations across these dimensions: skin
type tendencies (oily / dry / combination / dehydrated / sensitive /
reactive / acne-prone / mature-aging / resilient), quality observations
(hydration, barrier, elasticity, fine lines, pores, redness, pigmentation,
under-eye, UV / glycation / oxidative stress signs), facial zones (forehead,
temples, glabella, under eyes, cheeks, nose/T-zone, nasolabial folds,
mouth/lips, jawline, chin, neck) each scored 0-100 with a one-line note,
undertone (cool / warm / neutral), six longevity scores (skin_longevity,
barrier_strength, hydration, collagen_support, inflammation,
recovery_capacity) each 0-100, skin age delta years vs chronological.

RECOMMENDATIONS — the LLM does NOT pick products. Emit
recommendation_finding_tags (e.g., barrier_stress_high, hydration_low,
fine_lines_present, elasticity_low, redness_present, dullness_present,
pore_visibility_high, texture_irregular, pigmentation_present,
dark_circles_present, acne_active_present, sensitivity_high, oil_high,
uv_damage_signs, glycation_signs), in_clinic_categories, systemic_categories
(category-level only, no brand names), and medical_history_exclusions.

RED FLAGS — escalate (severity critical/high/medium): pigmented lesion with
asymmetry/irregular borders/multiple colors/>6mm/evolution, non-healing
ulcer, significant unilateral facial asymmetry not explained by lighting,
malar rash patterns, severe acne fulminans.

SCOPE OF PRACTICE — observational language only: "appears," "consistent
with," "observation suggests," "pattern of." Never "diagnose," "treat,"
"cure," "disease." No brand or product names. If pregnancy is flagged,
emit pregnancy in medical_history_exclusions so the Recommendation Service
filters retinoids / hydroquinone / salicylic-acid > 2%.

PARADIGM RENDERING — generate narrative_by_paradigm with a 2-3 sentence
summary per paradigm the patient has enabled.

OUTPUT — return ONLY valid JSON conforming to the SkinAnalysisV1 schema
(no markdown fences). Required keys: image_usable, unusable_reason,
captured_at_iso, skin_type_tendencies, quality_observations, facial_zones,
undertone, longevity_scores, skin_age_delta_years, skin_age_rationale,
cross_modality_tags, tags_with_confidence, recommendation_finding_tags,
in_clinic_categories, systemic_categories, medical_history_exclusions,
red_flags, narrative_by_paradigm, confidence, model_version, prompt_version.`;

const TCM_TONGUE_SYSTEM_PROMPT = `You are a TCM Tongue Diagnosis assistant for AI Longevity Pro, supporting
a DAOM/L.Ac.-directed workflow.

PATIENT CONTEXT
- Age: {{age}}
- Sex: {{sex}}
- Cycle day: {{cycle_day}}
- Chief complaint: {{chief_complaint_text}}
- Major history flags: {{medical_history_flags_csv}}
- Active protocols: {{active_protocols_csv}}
- Paradigm preferences: {{paradigm_preferences_csv}}
- Days since last tongue assessment: {{days_since_last}}
- Previous assessment summary: {{previous_summary}}
- Recent lab flags: {{recent_lab_flags_csv}}
- Recent symptom rollup (14 days): {{symptom_rollup_csv}}
- Time since last meal (minutes): {{time_since_food_min}}
- Time since brushing tongue (minutes): {{time_since_brushed_min}}
- Recently ate coloring foods: {{recent_intake_colored_foods}}

USABILITY — tongue extended + relaxed, adequate lighting, white-balance
reference card visible (else flag confidence_warning), no coloring foods
in last 30 min, no brushing in last 30 min.

ANALYSIS — body color (pale/pink-normal/red/dark-red/purple/blue), shape
(thin/normal/swollen/stiff/flaccid), size, moisture, cracks, teeth marks,
coating thickness + color + zone distribution, red tip, purple tones,
sublingual veins, zone observations (tip = Heart/Lungs, center = Spleen/
Stomach, sides = Liver/GB, root = Kidneys), 13-pattern score block 0-10
(heat, cold, damp, dry, yin_xu, blood_xu, qi_xu, liver_stagnation,
spleen_xu, stomach_heat, kidney_depletion, blood_stasis, phlegm_damp).

CONSTITUTION — nine-pattern set primary + secondary with confidence.

BALANCING — category-level only. TODO(tcm-formulary): emit specific herbs
+ formulas + acupoint codes once tcm_formulary table exists. Until then:
foods (warming/cooling/draining/tonifying with grocery-store examples),
teas, herb FAMILIES (tonifying/draining/warming/cooling), sleep,
hydration, stress, acupuncture channels (category-level).

RED FLAGS — very dark purple/black tongue (blood stasis), raw beefy red
with peeled coating (severe yin xu / possible B12), markedly swollen with
deep central crack, visible lesions / leukoplakia / ulceration.

SCOPE OF PRACTICE — observational only, no specific herb / formula /
acupoint codes until formulary table exists, no brand or product names.

PARADIGM RENDERING — narrative_by_paradigm 2-3 sentences per enabled
paradigm.

OUTPUT — return ONLY valid JSON conforming to TcmTongueV1 schema (no
markdown fences).`;

// ────────────────────────────────────────────────────────────
// LAB_FLAG_RELEVANCE — mirror of patient-context-builder.ts
// ────────────────────────────────────────────────────────────

const LAB_FLAG_RELEVANCE: Record<string, string[]> = {
  ferritin_low: ['nails', 'tongue', 'tcm_face', 'skin'],
  iron_low: ['nails', 'tongue', 'tcm_face'],
  b12_low: ['nails', 'tongue'],
  homocysteine_high: ['skin', 'tcm_face', 'tongue'],
  folate_low: ['nails', 'tongue'],
  hs_crp_high: ['skin', 'tcm_face', 'tongue', 'nails'],
  cortisol_rhythm_abnormal: ['skin', 'tcm_face', 'tongue', 'nails', 'iris'],
  hba1c_high: ['skin'],
  triglycerides_high: ['skin', 'tongue'],
  tsh_abnormal: ['skin', 'nails', 'tcm_face'],
  vitamin_d_low: ['skin', 'nails', 'iris'],
  alt_high: ['tcm_face', 'tongue', 'skin'],
  ast_high: ['tcm_face', 'tongue', 'skin'],
  sibo_positive: ['tongue', 'tcm_face'],
  candida_high: ['tongue', 'skin', 'nails'],
};

// ────────────────────────────────────────────────────────────
// Patient context builder (Deno mirror of the backend version)
// ────────────────────────────────────────────────────────────

interface PatientContext {
  age: string;
  sex: string;
  cycle_day: string;
  chief_complaint_text: string;
  medical_history_flags_csv: string;
  active_protocols_csv: string;
  paradigm_preferences_csv: string;
  days_since_last: string;
  previous_summary: string;
  recent_lab_flags_csv: string;
  symptom_rollup_csv: string;
  time_since_food_min: string;
  time_since_brushed_min: string;
  recent_intake_colored_foods: string;
  eye_color_self_reported: string;
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

async function buildPatientContext(
  sb: ReturnType<typeof createClient>,
  userId: string,
  modality: string,
  sessionInputs: Record<string, unknown> = {},
): Promise<PatientContext> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
  const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString();

  const [profileRes, intakeRes, contraRes, protocolsRes, prevFindingRes, labMarkersRes, symptomLogsRes] = await Promise.all([
    sb.from('profiles').select('sex, birth_date, paradigm_preferences').eq('id', userId).maybeSingle(),
    sb.from('clinical_intakes').select('chief_complaint_json').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('contraindications').select('pregnant, nursing, medications, allergies, conditions').eq('user_id', userId).maybeSingle(),
    sb.from('protocols').select('name').eq('user_id', userId).eq('status', 'active').limit(20),
    sb.from('visual_findings').select('summary_text, created_at').eq('user_id', userId).eq('modality', modality).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('lab_markers').select('marker_name, marker_value, unit, reference_range_low, reference_range_high').eq('user_id', userId).gte('collected_at', sixMonthsAgo).order('collected_at', { ascending: false }).limit(100),
    sb.from('symptom_logs').select('symptom_name, severity').eq('user_id', userId).gte('logged_at', fourteenDaysAgo),
  ]);

  const profile = profileRes.data as { sex?: string; birth_date?: string; paradigm_preferences?: string[] } | null;
  const intake = intakeRes.data as { chief_complaint_json?: Record<string, unknown> } | null;
  const contra = contraRes.data as { pregnant?: boolean; nursing?: boolean; medications?: string[]; allergies?: string[]; conditions?: string[] } | null;
  const protocols = ((protocolsRes.data as Array<{ name?: string }>) ?? []).map(p => p.name).filter(Boolean) as string[];
  const prevFinding = prevFindingRes.data as { summary_text?: string; created_at?: string } | null;
  const labMarkers = (labMarkersRes.data as Array<{ marker_name: string; marker_value: number; unit: string; reference_range_low: number | null; reference_range_high: number | null }>) ?? [];
  const symptomLogs = (symptomLogsRes.data as Array<{ symptom_name: string; severity: number | null }>) ?? [];

  const age = ageFromBirthDate(profile?.birth_date ?? null);
  const sex = profile?.sex ?? 'unknown';

  const ccText = (() => {
    const cc = intake?.chief_complaint_json;
    if (!cc) return 'No chief complaint recorded.';
    if (typeof cc.text === 'string') return cc.text;
    if (typeof cc.description === 'string') return cc.description;
    return JSON.stringify(cc).slice(0, 500);
  })();

  const historyFlags: string[] = [];
  if (contra?.pregnant) historyFlags.push('pregnant');
  if (contra?.nursing) historyFlags.push('nursing');
  for (const c of contra?.conditions ?? []) historyFlags.push(`condition:${c}`);
  for (const m of contra?.medications ?? []) historyFlags.push(`medication:${m}`);

  const paradigmPrefs = profile?.paradigm_preferences ?? ['western', 'functional'];
  const daysSinceLast = prevFinding?.created_at
    ? Math.round((Date.now() - new Date(prevFinding.created_at).getTime()) / 86400000)
    : null;

  // Lab flags filtered by modality
  const labFlagsForModality: string[] = [];
  for (const m of labMarkers) {
    const lname = m.marker_name.toLowerCase();
    const high = m.reference_range_high != null && m.marker_value > m.reference_range_high;
    const low = m.reference_range_low != null && m.marker_value < m.reference_range_low;
    const candidateKeys: string[] = [];
    if (lname.includes('ferritin') && low) candidateKeys.push('ferritin_low');
    if (lname.includes('hemoglobin') && low) candidateKeys.push('hemoglobin_low');
    if (lname.includes('b12') && low) candidateKeys.push('b12_low');
    if (lname.includes('homocysteine') && high) candidateKeys.push('homocysteine_high');
    if ((lname.includes('crp') || lname.includes('c-reactive')) && high) candidateKeys.push('hs_crp_high');
    if (lname.includes('hba1c') && high) candidateKeys.push('hba1c_high');
    if (lname.includes('vitamin d') && low) candidateKeys.push('vitamin_d_low');
    if (lname === 'alt' && high) candidateKeys.push('alt_high');
    if (lname === 'ast' && high) candidateKeys.push('ast_high');
    if (lname === 'tsh' && (low || high)) candidateKeys.push('tsh_abnormal');
    for (const key of candidateKeys) {
      const relevant = LAB_FLAG_RELEVANCE[key];
      if (relevant?.includes(modality)) {
        labFlagsForModality.push(`${key} (${m.marker_value} ${m.unit})`);
      }
    }
  }

  // Symptom rollup
  const symptomCounts = new Map<string, number>();
  for (const s of symptomLogs) {
    if ((s.severity ?? 0) < 2) continue;
    symptomCounts.set(s.symptom_name, (symptomCounts.get(s.symptom_name) ?? 0) + 1);
  }
  const symptomStrings = Array.from(symptomCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => `${name}: ${count}/14d`);

  return {
    age: age != null ? String(age) : 'unknown',
    sex,
    cycle_day: 'n/a',
    chief_complaint_text: ccText,
    medical_history_flags_csv: csv(historyFlags),
    active_protocols_csv: csv(protocols),
    paradigm_preferences_csv: csv(paradigmPrefs),
    days_since_last: daysSinceLast != null ? String(daysSinceLast) : 'n/a',
    previous_summary: prevFinding?.summary_text ?? 'No previous session.',
    recent_lab_flags_csv: csv(Array.from(new Set(labFlagsForModality))),
    symptom_rollup_csv: csv(symptomStrings),
    time_since_food_min: String((sessionInputs as { time_since_food_min?: number }).time_since_food_min ?? 'n/a'),
    time_since_brushed_min: String((sessionInputs as { time_since_brushed_min?: number }).time_since_brushed_min ?? 'n/a'),
    recent_intake_colored_foods: String((sessionInputs as { recent_intake_colored_foods?: boolean }).recent_intake_colored_foods ?? 'unknown'),
    eye_color_self_reported: String((sessionInputs as { eye_color_self_reported?: string }).eye_color_self_reported ?? 'unknown'),
  };
}

function renderPrompt(template: string, ctx: PatientContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => (ctx as unknown as Record<string, string>)[key] ?? `{{${key}}}`);
}

// ────────────────────────────────────────────────────────────
// Anthropic vision call
// ────────────────────────────────────────────────────────────

interface AnthropicVisionResult {
  content: string;
  model: string;
}

async function callAnthropicVision(
  systemPrompt: string,
  userPrompt: string,
  imageBase64: string,
  imageMimeType: string,
): Promise<AnthropicVisionResult> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imageMimeType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: userPrompt,
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic ${res.status}: ${txt.slice(0, 500)}`);
  }
  const json = await res.json();
  const content = json?.content?.[0]?.text;
  if (typeof content !== 'string') throw new Error('Anthropic returned no text content');
  return { content, model: json?.model ?? ANTHROPIC_MODEL };
}

function parseAnalyzerJson(content: string): Record<string, unknown> {
  // Strip markdown fences if the model produced them.
  let stripped = content.trim();
  if (stripped.startsWith('```')) {
    stripped = stripped.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  return JSON.parse(stripped) as Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let body: { session_id?: string; modality?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { session_id: sessionId, modality } = body;
  if (!sessionId || !modality) {
    return new Response(JSON.stringify({ error: 'session_id and modality required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (modality !== 'skin' && modality !== 'tongue') {
    // MVP: only skin + tongue analyzers ship. Other modalities return an
    // intentional 501 so the client UI can render "coming soon" rather
    // than 500.
    return new Response(JSON.stringify({ error: `Modality '${modality}' analyzer not yet implemented (Phase 2)` }), {
      status: 501,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // 1. Load session + the image for this modality
    const { data: sessionData, error: sessionErr } = await sb
      .from('visual_sessions')
      .select('id, user_id, session_inputs_json')
      .eq('id', sessionId)
      .maybeSingle();
    if (sessionErr || !sessionData) throw new Error(`Session ${sessionId} not found: ${sessionErr?.message ?? 'no data'}`);
    const session = sessionData as { id: string; user_id: string; session_inputs_json: Record<string, unknown> };

    const { data: imageData, error: imageErr } = await sb
      .from('visual_session_images')
      .select('storage_key, mime_type')
      .eq('session_id', sessionId)
      .eq('modality', modality)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (imageErr || !imageData) throw new Error(`No image found for session ${sessionId}/${modality}: ${imageErr?.message ?? 'no data'}`);
    const image = imageData as { storage_key: string; mime_type: string };

    // 2. Download image from Storage + base64 encode
    const { data: fileBlob, error: dlErr } = await sb.storage.from(STORAGE_BUCKET).download(image.storage_key);
    if (dlErr || !fileBlob) throw new Error(`Storage download failed: ${dlErr?.message ?? 'no data'}`);
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    // btoa via binary string for Deno
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const imageBase64 = btoa(binary);

    // 3. Mark session as analyzing (no-op if already analyzing)
    await sb.from('visual_sessions').update({ status: 'analyzing', updated_at: new Date().toISOString() }).eq('id', sessionId);

    // 4. Build patient context
    const ctx = await buildPatientContext(sb, session.user_id, modality, session.session_inputs_json);

    // 5. Choose prompt + version
    const systemPrompt = modality === 'skin' ? SKIN_SYSTEM_PROMPT : TCM_TONGUE_SYSTEM_PROMPT;
    const promptVersion = modality === 'skin' ? SKIN_PROMPT_VERSION : TCM_TONGUE_PROMPT_VERSION;
    const renderedSystemPrompt = renderPrompt(systemPrompt, ctx);
    const userPrompt = `Analyze the supplied ${modality} image per the system prompt. Return only valid JSON.`;

    // 6. Call Claude vision with retry-on-parse-failure
    const startedAt = Date.now();
    let parsed: Record<string, unknown>;
    let modelUsed = ANTHROPIC_MODEL;
    let retried = false;
    try {
      const first = await callAnthropicVision(renderedSystemPrompt, userPrompt, imageBase64, image.mime_type);
      modelUsed = first.model;
      parsed = parseAnalyzerJson(first.content);
    } catch (firstErr) {
      console.log('[visual-analysis] first attempt failed, retrying:', firstErr instanceof Error ? firstErr.message : String(firstErr));
      retried = true;
      const retryUserPrompt = `${userPrompt}\n\nYour previous output failed to parse as JSON. Return ONLY valid JSON conforming to the required schema. No markdown fences, no commentary outside the JSON.`;
      const second = await callAnthropicVision(renderedSystemPrompt, retryUserPrompt, imageBase64, image.mime_type);
      modelUsed = second.model;
      parsed = parseAnalyzerJson(second.content);
    }
    const generationMs = Date.now() - startedAt;

    // 7. Persist visual_findings row
    const findingsRow = {
      session_id: sessionId,
      user_id: session.user_id,
      modality,
      structured_findings: parsed,
      cross_modality_tags: Array.isArray(parsed.cross_modality_tags) ? parsed.cross_modality_tags : [],
      tags_with_confidence: (typeof parsed.tags_with_confidence === 'object' && parsed.tags_with_confidence !== null)
        ? parsed.tags_with_confidence
        : {},
      narrative_by_paradigm: (typeof parsed.narrative_by_paradigm === 'object' && parsed.narrative_by_paradigm !== null)
        ? parsed.narrative_by_paradigm
        : {},
      red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
      model_version: modelUsed,
      prompt_version: promptVersion,
      generation_ms: generationMs,
    };
    const { data: insertedRow, error: insertErr } = await sb
      .from('visual_findings')
      .upsert(findingsRow, { onConflict: 'session_id,modality' })
      .select('id')
      .single();
    if (insertErr) throw new Error(`Failed to persist finding: ${insertErr.message}`);

    console.log(`[visual-analysis] ${sessionId}/${modality} complete in ${generationMs}ms (retried=${retried})`);

    return new Response(JSON.stringify({
      status: 'ok',
      finding_id: (insertedRow as { id: string }).id,
      modality,
      retried,
      generation_ms: generationMs,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[visual-analysis] failed:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ status: 'error', error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
