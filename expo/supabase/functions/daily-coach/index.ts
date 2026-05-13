/**
 * Supabase Edge Function: daily-coach
 *
 * Unified-context recommendation engine. This is the synthesis layer that
 * combines ALL four health-data domains into a single, safety-gated, AI
 * recommendation for the day:
 *
 *   profile (sex, DOB, goals)
 *   + clinical_intakes / contraindications (pregnancy, conditions, meds, allergies)
 *   + latest lab_analysis_jobs (biomarkers + lab-derived supplement suggestions)
 *   + recent symptom_logs + daily_subjective_rollups
 *   + today's daily_biometric_records (wearables: sleep, HRV, RHR, recovery)
 *   + recent meal_logs + daily_nutrition_rollups
 *   ──────────────────────────────────────────────────────────────────────
 *   → deterministic safety gates (supplement_contraindication_rules)
 *   → LLM call with full multi-domain context
 *   → post-filter LLM output through gates (defense in depth)
 *   → write to daily_recommendations + coach_run_logs (audit trail)
 *
 * Why deterministic gates ahead of the LLM:
 *   - Prevents "AI recommends DHEA to pregnant patient" from ever being possible
 *   - Auditable: every blocked recommendation has a rule_id and reason
 *   - Practitioner-editable: rules live in supplement_contraindication_rules
 *
 * Invoke from client:
 *   POST {functions_url}/daily-coach
 *   Authorization: Bearer {user_jwt}
 *   Body: { date?: "2026-05-13" }  // defaults to today (UTC)
 *
 * Deploy: supabase functions deploy daily-coach
 *
 * Required secrets:
 *   - SUPABASE_URL                 (auto-injected)
 *   - SUPABASE_SERVICE_ROLE_KEY    (auto-injected)
 *   - OPENAI_API_KEY
 *   - OPENAI_MODEL                 (optional; defaults to gpt-4o-mini)
 *
 * HIPAA note: OpenAI standard API is not HIPAA-eligible. For production
 * with real patient data, swap the LLM call for AWS Bedrock Claude
 * (covered by your AWS BAA) or OpenAI with a signed BAA.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const startedAt = Date.now();
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Missing Authorization bearer token' }, 401);

  let body: { date?: string } = {};
  try {
    body = await req.json();
  } catch {
    // body is optional
  }
  const targetDate = body.date ?? new Date().toISOString().slice(0, 10);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: 'Invalid or expired token' }, 401);
  const userId = userData.user.id;

  try {
    const context = await aggregateContext(admin, userId, targetDate);
    const gates = applySafetyGates(context);
    const llmResult = await callLLM(context, gates);
    const filtered = postFilterLLMOutput(llmResult, gates);

    const recRow = await upsertDailyRecommendation(admin, userId, targetDate, filtered);

    await admin.from('coach_run_logs').insert({
      user_id: userId,
      date: targetDate,
      daily_recommendation_id: recRow?.id ?? null,
      context_snapshot: sanitizeForLog(context),
      safety_gates_triggered: gates.triggered,
      llm_response_raw: llmResult.raw,
      duration_ms: Date.now() - startedAt,
      model_used: OPENAI_MODEL,
      status: 'success',
    });

    return json({ ok: true, recommendation: filtered, gatesTriggered: gates.triggered });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[daily-coach] failure', message);
    await admin.from('coach_run_logs').insert({
      user_id: userId,
      date: targetDate,
      context_snapshot: {},
      safety_gates_triggered: [],
      duration_ms: Date.now() - startedAt,
      model_used: OPENAI_MODEL,
      status: 'failed',
      error: message,
    });
    return json({ error: message }, 500);
  }
});

// ----------------------------------------------------------------------
// 1. Context aggregator
// ----------------------------------------------------------------------

interface CoachContext {
  profile: ProfileSlice;
  intake: IntakeSlice;
  contraindications: ContraindicationsSlice;
  labs: LabSlice;
  wearables: WearablesSlice;
  nutrition: NutritionSlice;
  symptoms: SymptomsSlice;
  rules: SupplementRule[];
  meta: { date: string; userId: string };
}

interface ProfileSlice {
  sex: 'male' | 'female' | 'other' | null;
  ageYears: number | null;
  ageGroup: 'child' | 'teen' | 'adult' | 'older_adult' | null;
  heightCm: number | null;
  weightKg: number | null;
  goals: string[];
  timezone: string | null;
}

interface IntakeSlice {
  topConcerns: string[];
  symptomCategoriesFlagged: string[]; // e.g. "fatigue", "gut", "sleep"
  dietaryPattern: string | null;
  raw: Record<string, unknown> | null;
}

interface ContraindicationsSlice {
  pregnant: boolean;
  nursing: boolean;
  conditions: string[];
  medications: string[];
  allergies: string[];
  raw: Record<string, unknown> | null;
}

interface LabSlice {
  hasLabs: boolean;
  testedAt: string | null;
  biomarkers: Array<{
    name: string;
    value: number;
    unit: string;
    referenceMin: number | null;
    referenceMax: number | null;
    functionalMin: number | null;
    functionalMax: number | null;
    status: string | null;
  }>;
  labSupplements: Array<{ name: string; dose: string; timing: string; reason: string }>;
  priorityActions: string[];
}

interface WearablesSlice {
  today: Record<string, unknown> | null;
  trend7d: {
    sleepDurationAvg: number | null;
    hrvAvg: number | null;
    rhrAvg: number | null;
    recoveryAvg: number | null;
  };
}

interface NutritionSlice {
  todayTotals: Record<string, unknown> | null;
  todayMeals: Array<Record<string, unknown>>;
  trend7d: {
    avgCalories: number | null;
    avgProtein: number | null;
    avgEatingWindow: number | null;
    avgGlycemicLoad: number | null;
  };
}

interface SymptomsSlice {
  today: Array<{ name: string; severity: number; loggedAt: string }>;
  trend7d: Record<string, number>; // symptom_name -> average severity
  topActive: string[]; // names with severity > 5 in last 3d
}

interface SupplementRule {
  id: string;
  supplement_name: string;
  rule_type: string;
  rule_value: Record<string, unknown>;
  severity: 'block' | 'caution';
  reason: string;
}

async function aggregateContext(admin: SupabaseClient, userId: string, date: string): Promise<CoachContext> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const startOfDay = `${date}T00:00:00Z`;
  const endOfDay = `${date}T23:59:59Z`;

  // Run all queries in parallel
  const [
    profileR,
    intakeR,
    questionnaireR,
    contraR,
    labR,
    todayBioR,
    weekBioR,
    todaySymR,
    weekSymR,
    todayNutR,
    todayMealsR,
    weekNutR,
    rulesR,
  ] = await Promise.all([
    admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
    admin.from('clinical_intakes').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('questionnaire_responses').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('contraindications').select('*').eq('user_id', userId)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('lab_analysis_jobs').select('*').eq('user_id', userId)
      .eq('status', 'complete').order('completed_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('daily_biometric_records').select('*').eq('user_id', userId).eq('date', date).maybeSingle(),
    admin.from('daily_biometric_records').select('*').eq('user_id', userId)
      .gte('date', sevenDaysAgo.slice(0, 10)).order('date', { ascending: false }),
    admin.from('symptom_logs').select('*').eq('user_id', userId)
      .gte('logged_at', startOfDay).lte('logged_at', endOfDay),
    admin.from('symptom_logs').select('*').eq('user_id', userId).gte('logged_at', sevenDaysAgo),
    admin.from('daily_nutrition_rollups').select('*').eq('user_id', userId).eq('date', date).maybeSingle(),
    admin.from('meal_logs').select('*').eq('user_id', userId)
      .gte('meal_time', startOfDay).lte('meal_time', endOfDay).order('meal_time', { ascending: true }),
    admin.from('daily_nutrition_rollups').select('*').eq('user_id', userId)
      .gte('date', sevenDaysAgo.slice(0, 10)).order('date', { ascending: false }),
    admin.from('supplement_contraindication_rules').select('*').eq('active', true),
  ]);

  const profile = mapProfile(profileR.data);
  const intake = mapIntake(intakeR.data, questionnaireR.data);
  const contraindications = mapContraindications(contraR.data);
  const labs = mapLabs(labR.data);
  const wearables = mapWearables(todayBioR.data, weekBioR.data ?? []);
  const nutrition = mapNutrition(todayNutR.data, todayMealsR.data ?? [], weekNutR.data ?? []);
  const symptoms = mapSymptoms(todaySymR.data ?? [], weekSymR.data ?? []);
  const rules = (rulesR.data ?? []) as SupplementRule[];

  return {
    profile, intake, contraindications, labs, wearables, nutrition, symptoms, rules,
    meta: { date, userId },
  };
}

function mapProfile(p: Record<string, unknown> | null): ProfileSlice {
  if (!p) return { sex: null, ageYears: null, ageGroup: null, heightCm: null, weightKg: null, goals: [], timezone: null };
  const birth = p.birth_date as string | null;
  const ageYears = birth ? Math.floor((Date.now() - new Date(birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : null;
  let ageGroup: ProfileSlice['ageGroup'] = null;
  if (ageYears !== null) {
    if (ageYears < 13) ageGroup = 'child';
    else if (ageYears < 18) ageGroup = 'teen';
    else if (ageYears < 65) ageGroup = 'adult';
    else ageGroup = 'older_adult';
  }
  return {
    sex: (p.sex as ProfileSlice['sex']) ?? null,
    ageYears,
    ageGroup,
    heightCm: (p.height as number | null) ?? null,
    weightKg: (p.weight as number | null) ?? null,
    goals: (p.goals as string[] | null) ?? [],
    timezone: (p.timezone as string | null) ?? null,
  };
}

function mapIntake(intake: Record<string, unknown> | null, quest: Record<string, unknown> | null): IntakeSlice {
  const flagged: string[] = [];
  const concerns: string[] = [];
  if (quest) {
    const responses = (quest.responses as Record<string, number> | null) ?? {};
    for (const [k, v] of Object.entries(responses)) {
      if (typeof v === 'number' && v >= 3) flagged.push(k);
    }
  }
  if (intake) {
    const c = (intake.primary_concerns as string[] | null) ?? [];
    concerns.push(...c);
  }
  return {
    topConcerns: concerns,
    symptomCategoriesFlagged: flagged,
    dietaryPattern: (intake?.dietary_pattern as string | null) ?? null,
    raw: intake,
  };
}

function mapContraindications(c: Record<string, unknown> | null): ContraindicationsSlice {
  if (!c) return { pregnant: false, nursing: false, conditions: [], medications: [], allergies: [], raw: null };
  return {
    pregnant: Boolean(c.pregnant),
    nursing: Boolean(c.nursing),
    conditions: (c.conditions as string[] | null) ?? [],
    medications: (c.medications as string[] | null) ?? [],
    allergies: (c.allergies as string[] | null) ?? [],
    raw: c,
  };
}

function mapLabs(lab: Record<string, unknown> | null): LabSlice {
  if (!lab) return {
    hasLabs: false, testedAt: null, biomarkers: [], labSupplements: [], priorityActions: [],
  };
  return {
    hasLabs: true,
    testedAt: (lab.completed_at as string | null) ?? null,
    biomarkers: ((lab.biomarkers_json as Array<Record<string, unknown>> | null) ?? []).map((b) => ({
      name: String(b.name ?? ''),
      value: Number(b.value ?? 0),
      unit: String(b.unit ?? ''),
      referenceMin: (b.referenceMin as number | null) ?? null,
      referenceMax: (b.referenceMax as number | null) ?? null,
      functionalMin: (b.functionalMin as number | null) ?? null,
      functionalMax: (b.functionalMax as number | null) ?? null,
      status: (b.status as string | null) ?? null,
    })),
    labSupplements: ((lab.supplements_json as Array<Record<string, unknown>> | null) ?? []).map((s) => ({
      name: String(s.name ?? ''),
      dose: String(s.dose ?? ''),
      timing: String(s.timing ?? ''),
      reason: String(s.reason ?? ''),
    })),
    priorityActions: (lab.priority_actions_json as string[] | null) ?? [],
  };
}

function mapWearables(today: Record<string, unknown> | null, week: Array<Record<string, unknown>>): WearablesSlice {
  const avg = (field: string): number | null => {
    const vals = week.map((r) => r[field]).filter((v): v is number => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    today,
    trend7d: {
      sleepDurationAvg: avg('sleep_duration_minutes'),
      hrvAvg: avg('hrv'),
      rhrAvg: avg('resting_hr'),
      recoveryAvg: avg('recovery_score'),
    },
  };
}

function mapNutrition(
  today: Record<string, unknown> | null,
  todayMeals: Array<Record<string, unknown>>,
  week: Array<Record<string, unknown>>,
): NutritionSlice {
  const avg = (field: string): number | null => {
    const vals = week.map((r) => r[field]).filter((v): v is number => typeof v === 'number');
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    todayTotals: today,
    todayMeals,
    trend7d: {
      avgCalories: avg('total_calories'),
      avgProtein: avg('total_protein_g'),
      avgEatingWindow: avg('eating_window_minutes'),
      avgGlycemicLoad: avg('glycemic_load_total'),
    },
  };
}

function mapSymptoms(
  today: Array<Record<string, unknown>>,
  week: Array<Record<string, unknown>>,
): SymptomsSlice {
  const trend = new Map<string, number[]>();
  for (const s of week) {
    const name = String(s.symptom_name ?? '');
    const sev = Number(s.severity ?? 0);
    if (!name) continue;
    if (!trend.has(name)) trend.set(name, []);
    trend.get(name)!.push(sev);
  }
  const trend7d: Record<string, number> = {};
  for (const [name, vals] of trend.entries()) {
    trend7d[name] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const topActive = Object.entries(trend7d)
    .filter(([name, avg]) => {
      if (avg < 5) return false;
      return week.some(
        (s) => s.symptom_name === name && new Date(String(s.logged_at)).getTime() > threeDaysAgo,
      );
    })
    .map(([name]) => name);
  return {
    today: today.map((s) => ({
      name: String(s.symptom_name ?? ''),
      severity: Number(s.severity ?? 0),
      loggedAt: String(s.logged_at ?? ''),
    })),
    trend7d,
    topActive,
  };
}

// ----------------------------------------------------------------------
// 2. Safety gate engine (deterministic, before LLM)
// ----------------------------------------------------------------------

interface GateResult {
  supplement: string;
  ruleId: string;
  severity: 'block' | 'caution';
  reason: string;
  ruleType: string;
}

interface GateOutput {
  triggered: GateResult[];
  blockedSupplements: Set<string>;
  cautionSupplements: Map<string, string[]>; // name -> reasons
}

function applySafetyGates(ctx: CoachContext): GateOutput {
  const triggered: GateResult[] = [];

  for (const rule of ctx.rules) {
    const hit = evaluateRule(rule, ctx);
    if (hit) {
      triggered.push({
        supplement: rule.supplement_name,
        ruleId: rule.id,
        severity: rule.severity,
        reason: rule.reason,
        ruleType: rule.rule_type,
      });
    }
  }

  const blocked = new Set<string>();
  const caution = new Map<string, string[]>();
  for (const t of triggered) {
    if (t.severity === 'block') blocked.add(t.supplement.toLowerCase());
    else {
      const key = t.supplement.toLowerCase();
      if (!caution.has(key)) caution.set(key, []);
      caution.get(key)!.push(t.reason);
    }
  }

  return { triggered, blockedSupplements: blocked, cautionSupplements: caution };
}

function evaluateRule(rule: SupplementRule, ctx: CoachContext): boolean {
  switch (rule.rule_type) {
    case 'pregnancy':
      return ctx.contraindications.pregnant;
    case 'nursing':
      return ctx.contraindications.nursing;
    case 'sex': {
      const targetSex = String(rule.rule_value.sex ?? '').toLowerCase();
      return ctx.profile.sex === targetSex;
    }
    case 'age': {
      const maxAge = Number(rule.rule_value.max_age ?? Infinity);
      const minAge = Number(rule.rule_value.min_age ?? 0);
      const age = ctx.profile.ageYears;
      if (age === null) return false;
      return age < maxAge && age >= minAge;
    }
    case 'condition': {
      const target = String(rule.rule_value.condition ?? '').toLowerCase();
      return ctx.contraindications.conditions.some((c) => c.toLowerCase().includes(target));
    }
    case 'medication': {
      const list = (rule.rule_value.contains as string[] | undefined) ?? [];
      const meds = ctx.contraindications.medications.map((m) => m.toLowerCase());
      return list.some((needle) => meds.some((m) => m.includes(needle.toLowerCase())));
    }
    case 'biomarker_high': {
      const name = String(rule.rule_value.name ?? '').toLowerCase();
      const threshold = Number(rule.rule_value.threshold ?? Infinity);
      const requiredSex = rule.rule_value.sex ? String(rule.rule_value.sex).toLowerCase() : null;
      if (requiredSex && ctx.profile.sex !== requiredSex) return false;
      const bio = ctx.labs.biomarkers.find((b) => b.name.toLowerCase().includes(name));
      return bio ? bio.value > threshold : false;
    }
    case 'biomarker_low': {
      const name = String(rule.rule_value.name ?? '').toLowerCase();
      const threshold = Number(rule.rule_value.threshold ?? -Infinity);
      const bio = ctx.labs.biomarkers.find((b) => b.name.toLowerCase().includes(name));
      return bio ? bio.value < threshold : false;
    }
    case 'symptom_pattern': {
      const anyOf = ((rule.rule_value.any_of as string[] | undefined) ?? []).map((s) => s.toLowerCase());
      const active = new Set([
        ...ctx.symptoms.topActive.map((s) => s.toLowerCase()),
        ...Object.keys(ctx.symptoms.trend7d)
          .filter((n) => ctx.symptoms.trend7d[n] >= 5)
          .map((s) => s.toLowerCase()),
      ]);
      return anyOf.some((s) => [...active].some((a) => a.includes(s)));
    }
    default:
      return false;
  }
}

// ----------------------------------------------------------------------
// 3. LLM call
// ----------------------------------------------------------------------

const COACH_SYSTEM_PROMPT = `You are a world-class functional medicine and longevity AI coach. You are given the patient's full context for today (profile, intake, contraindications, latest labs, today's wearables, today's nutrition, today's and recent symptoms) plus a list of SAFETY GATES that the system has already pre-computed.

Your job: produce one structured, personalized recommendation set for today.

NON-NEGOTIABLE RULES:
1. If a supplement appears in "blockedSupplements", you MUST NOT recommend it under any circumstance — not even with a caveat. Do not mention it positively.
2. If a supplement appears in "cautionSupplements", you may include it ONLY with an explicit warning that cites the reason.
3. Demographics override: never recommend hormone precursors (DHEA, pregnenolone), androgenic herbs, or known abortifacients to pregnant or nursing patients.
4. Children/teens: never recommend hormone supplementation; be conservative with adaptogens and stimulants.
5. Today-aware: if today's wearables show poor recovery (low HRV, poor sleep), bias toward parasympathetic / restorative interventions and avoid stimulating ones. If today's symptoms suggest hyperandrogenic state (acne flare, hirsutism flare), avoid androgen-supporting supplements regardless of past labs.
6. Tie every recommendation to specific evidence in the patient's data ("because your latest cortisol AM is X and you reported sleep onset > 45min for 4/7 days").

Output strict JSON with this shape:
{
  "recovery_status": "good" | "moderate" | "poor",
  "top_actions": [string, string, string],  // 3 priorities for today
  "training_guidance": string,
  "nutrition_guidance": string,
  "supplement_guidance": [
    {
      "name": string,           // must NOT be in blockedSupplements
      "dose": string,
      "timing": string,
      "reason": string,
      "caution": string | null  // populate when name is in cautionSupplements
    }
  ],
  "supplements_to_skip_today": [
    { "name": string, "reason": string }  // can include items from blockedSupplements + items the patient normally takes but should skip today
  ],
  "sleep_guidance": string,
  "stress_guidance": string,
  "escalation_flag": boolean,    // true if anything looks medically concerning
  "explanation_short": string,   // 1-2 sentences for the home screen
  "explanation_long": string     // 2-3 paragraphs for the detail screen, citing data
}`;

interface LLMResult {
  recovery_status: string;
  top_actions: string[];
  training_guidance: string;
  nutrition_guidance: string;
  supplement_guidance: Array<{ name: string; dose: string; timing: string; reason: string; caution: string | null }>;
  supplements_to_skip_today: Array<{ name: string; reason: string }>;
  sleep_guidance: string;
  stress_guidance: string;
  escalation_flag: boolean;
  explanation_short: string;
  explanation_long: string;
  raw: unknown;
}

async function callLLM(ctx: CoachContext, gates: GateOutput): Promise<LLMResult> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY secret is not set.');

  const payload = {
    profile: ctx.profile,
    intake: { topConcerns: ctx.intake.topConcerns, flagged: ctx.intake.symptomCategoriesFlagged, dietaryPattern: ctx.intake.dietaryPattern },
    contraindications: {
      pregnant: ctx.contraindications.pregnant,
      nursing: ctx.contraindications.nursing,
      conditions: ctx.contraindications.conditions,
      medications: ctx.contraindications.medications,
      allergies: ctx.contraindications.allergies,
    },
    labs: ctx.labs,
    wearables: ctx.wearables,
    nutrition: ctx.nutrition,
    symptoms: ctx.symptoms,
    blockedSupplements: [...gates.blockedSupplements],
    cautionSupplements: Object.fromEntries(gates.cautionSupplements),
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: COACH_SYSTEM_PROMPT },
        { role: 'user', content: `PATIENT CONTEXT (today: ${ctx.meta.date}):\n${JSON.stringify(payload, null, 2)}` },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI call failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? '';
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`LLM returned invalid JSON: ${(e as Error).message}`);
  }

  return {
    recovery_status: String(parsed.recovery_status ?? 'moderate'),
    top_actions: (parsed.top_actions as string[] | null) ?? [],
    training_guidance: String(parsed.training_guidance ?? ''),
    nutrition_guidance: String(parsed.nutrition_guidance ?? ''),
    supplement_guidance: (parsed.supplement_guidance as LLMResult['supplement_guidance']) ?? [],
    supplements_to_skip_today: (parsed.supplements_to_skip_today as LLMResult['supplements_to_skip_today']) ?? [],
    sleep_guidance: String(parsed.sleep_guidance ?? ''),
    stress_guidance: String(parsed.stress_guidance ?? ''),
    escalation_flag: Boolean(parsed.escalation_flag),
    explanation_short: String(parsed.explanation_short ?? ''),
    explanation_long: String(parsed.explanation_long ?? ''),
    raw: parsed,
  };
}

// ----------------------------------------------------------------------
// 4. Post-filter: belt-and-suspenders enforcement of gates on LLM output
// ----------------------------------------------------------------------

function postFilterLLMOutput(llm: LLMResult, gates: GateOutput): LLMResult {
  const cleaned = { ...llm };
  cleaned.supplement_guidance = llm.supplement_guidance.filter((s) => {
    const lower = (s.name ?? '').toLowerCase();
    if (gates.blockedSupplements.has(lower)) {
      // LLM tried to recommend something blocked — move it to skip list.
      cleaned.supplements_to_skip_today = [
        ...(cleaned.supplements_to_skip_today ?? []),
        { name: s.name, reason: `Auto-blocked by safety gate: ${[...(gates.cautionSupplements.get(lower) ?? [])].join('; ') || 'contraindication match'}` },
      ];
      return false;
    }
    // Force a caution string for any cautioned supplement
    const cautions = gates.cautionSupplements.get(lower);
    if (cautions?.length && !s.caution) {
      s.caution = cautions.join('; ');
    }
    return true;
  });
  // De-dupe skip list
  const seenSkip = new Set<string>();
  cleaned.supplements_to_skip_today = cleaned.supplements_to_skip_today.filter((s) => {
    const k = (s.name ?? '').toLowerCase();
    if (seenSkip.has(k)) return false;
    seenSkip.add(k);
    return true;
  });
  return cleaned;
}

// ----------------------------------------------------------------------
// 5. Persist to daily_recommendations
// ----------------------------------------------------------------------

async function upsertDailyRecommendation(
  admin: SupabaseClient,
  userId: string,
  date: string,
  llm: LLMResult,
): Promise<{ id: string } | null> {
  const row = {
    user_id: userId,
    date,
    recovery_status: llm.recovery_status,
    training_guidance: llm.training_guidance,
    nutrition_guidance: llm.nutrition_guidance,
    supplement_guidance: llm.supplement_guidance,
    sleep_guidance: llm.sleep_guidance,
    stress_guidance: llm.stress_guidance,
    escalation_flag: llm.escalation_flag,
    top_actions_json: llm.top_actions,
    explanation_short: llm.explanation_short,
    explanation_long: llm.explanation_long,
    recommendation_payload_json: {
      supplement_guidance: llm.supplement_guidance,
      supplements_to_skip_today: llm.supplements_to_skip_today,
    },
    ai_summary_json: llm.raw,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin
    .from('daily_recommendations')
    .upsert(row, { onConflict: 'user_id,date' })
    .select('id')
    .maybeSingle();
  if (error) throw new Error(`Failed to persist daily_recommendations: ${error.message}`);
  return data;
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function sanitizeForLog(ctx: CoachContext): Record<string, unknown> {
  // Strip raw blobs to keep coach_run_logs lean; keep structured fields for replay.
  return {
    profile: ctx.profile,
    intake: { topConcerns: ctx.intake.topConcerns, flagged: ctx.intake.symptomCategoriesFlagged, dietaryPattern: ctx.intake.dietaryPattern },
    contraindications: {
      pregnant: ctx.contraindications.pregnant,
      nursing: ctx.contraindications.nursing,
      conditions: ctx.contraindications.conditions,
      medications: ctx.contraindications.medications,
      allergies: ctx.contraindications.allergies,
    },
    labs: { hasLabs: ctx.labs.hasLabs, testedAt: ctx.labs.testedAt, biomarkerCount: ctx.labs.biomarkers.length },
    wearables: { hasToday: Boolean(ctx.wearables.today), trend7d: ctx.wearables.trend7d },
    nutrition: { hasToday: Boolean(ctx.nutrition.todayTotals), todayMealCount: ctx.nutrition.todayMeals.length, trend7d: ctx.nutrition.trend7d },
    symptoms: { todayCount: ctx.symptoms.today.length, topActive: ctx.symptoms.topActive, trend7d: ctx.symptoms.trend7d },
    meta: ctx.meta,
  };
}
