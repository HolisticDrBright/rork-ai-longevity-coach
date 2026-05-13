/**
 * Supabase Edge Function: Daily Coach
 *
 * Synthesis layer for the daily recommendation. Workflow:
 *   1. Aggregate user context (profile, contraindications, latest labs,
 *      today + 7-day biometrics, today + 7-day nutrition, today + 7-day
 *      symptoms) in parallel.
 *   2. Run the deterministic safety-gate engine against
 *      supplement_contraindication_rules. This produces blockedSupplements
 *      and cautionSupplements before the LLM is invoked.
 *   3. Call the LLM (OpenAI) with the full context AND the gate results.
 *      The system prompt forbids recommending anything in
 *      blockedSupplements.
 *   4. Post-filter the LLM output through the gates again (defense in
 *      depth) - any blocked supplement that slipped through is moved to
 *      the skip list with reason "Auto-blocked by safety gate".
 *   5. Upsert daily_recommendations (one row per user per day) and write
 *      a coach_run_logs audit row.
 *
 * Deploy: supabase functions deploy daily-coach
 * Invoke: supabase.functions.invoke('daily-coach', { body: { userId, date } })
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface RuleRow {
  id: string;
  supplement_name: string;
  rule_type: string;
  rule_value: Record<string, unknown>;
  severity: 'block' | 'caution';
  reason: string;
  active: boolean;
}

interface GateHit {
  supplement: string;
  severity: 'block' | 'caution';
  reason: string;
  rule_id: string;
  rule_type: string;
}

interface UserContext {
  userId: string;
  date: string;
  profile: {
    sex: string | null;
    age: number | null;
    weight: number | null;
    goals: string[] | null;
  };
  contraindications: {
    pregnant: boolean;
    nursing: boolean;
    medications: string[];
    allergies: string[];
    conditions: string[];
  };
  clinicalIntake: Record<string, unknown> | null;
  questionnaire: Array<{ question_id: string; category_id: string; severity: number }>;
  latestLabs: Array<{ marker_name: string; marker_value: number; unit: string; collected_at: string }>;
  todayBiometrics: Record<string, unknown> | null;
  recentBiometrics: Array<Record<string, unknown>>;
  todayNutrition: Record<string, unknown> | null;
  recentNutrition: Array<Record<string, unknown>>;
  todayMeals: Array<Record<string, unknown>>;
  todaySymptoms: Array<{ symptom_name: string; severity: number | null; notes: string | null }>;
  recentSymptoms: Array<{ symptom_name: string; severity: number | null; logged_at: string }>;
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function computeAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function isoDateNDaysAgo(date: string, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// ────────────────────────────────────────────────────────────
// 1. Aggregator
// ────────────────────────────────────────────────────────────

async function aggregateContext(
  sb: ReturnType<typeof createClient>,
  userId: string,
  date: string,
): Promise<UserContext> {
  const sevenDaysAgo = isoDateNDaysAgo(date, 7);
  const todayStart = `${date}T00:00:00Z`;
  const todayEnd = `${date}T23:59:59Z`;
  const sevenDaysAgoIso = `${sevenDaysAgo}T00:00:00Z`;

  const [
    profileRes,
    contraindicationsRes,
    clinicalRes,
    questionnaireRes,
    labMarkersRes,
    todayBiometricsRes,
    recentBiometricsRes,
    todayNutritionRes,
    recentNutritionRes,
    todayMealsRes,
    todaySymptomsRes,
    recentSymptomsRes,
  ] = await Promise.all([
    sb.from('profiles').select('sex, birth_date, weight, goals').eq('id', userId).maybeSingle(),
    sb.from('contraindications').select('pregnant, nursing, medications, allergies, conditions').eq('user_id', userId).maybeSingle(),
    sb.from('clinical_intakes').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('questionnaire_responses').select('question_id, category_id, severity').eq('user_id', userId).order('timestamp', { ascending: false }).limit(50),
    sb.from('lab_markers').select('marker_name, marker_value, unit, collected_at').eq('user_id', userId).order('collected_at', { ascending: false }).limit(40),
    sb.from('daily_biometric_records').select('*').eq('user_id', userId).eq('date', date).maybeSingle(),
    sb.from('daily_biometric_records').select('*').eq('user_id', userId).gte('date', sevenDaysAgo).lte('date', date).order('date', { ascending: false }),
    sb.from('daily_nutrition_rollups').select('*').eq('user_id', userId).eq('date', date).maybeSingle(),
    sb.from('daily_nutrition_rollups').select('*').eq('user_id', userId).gte('date', sevenDaysAgo).lte('date', date).order('date', { ascending: false }),
    sb.from('meal_logs').select('*').eq('user_id', userId).gte('meal_time', todayStart).lte('meal_time', todayEnd).order('meal_time', { ascending: true }),
    sb.from('symptom_logs').select('symptom_name, severity, notes').eq('user_id', userId).gte('logged_at', todayStart).lte('logged_at', todayEnd),
    sb.from('symptom_logs').select('symptom_name, severity, logged_at').eq('user_id', userId).gte('logged_at', sevenDaysAgoIso).order('logged_at', { ascending: false }).limit(100),
  ]);

  const profile = (profileRes.data as { sex?: string; birth_date?: string; weight?: number; goals?: string[] } | null) ?? null;
  const contraindications = (contraindicationsRes.data as {
    pregnant?: boolean;
    nursing?: boolean;
    medications?: string[];
    allergies?: string[];
    conditions?: string[];
  } | null) ?? null;

  return {
    userId,
    date,
    profile: {
      sex: profile?.sex ?? null,
      age: computeAge(profile?.birth_date ?? null),
      weight: profile?.weight ?? null,
      goals: profile?.goals ?? null,
    },
    contraindications: {
      pregnant: contraindications?.pregnant ?? false,
      nursing: contraindications?.nursing ?? false,
      medications: contraindications?.medications ?? [],
      allergies: contraindications?.allergies ?? [],
      conditions: contraindications?.conditions ?? [],
    },
    clinicalIntake: (clinicalRes.data as Record<string, unknown>) ?? null,
    questionnaire: (questionnaireRes.data as Array<{ question_id: string; category_id: string; severity: number }>) ?? [],
    latestLabs: (labMarkersRes.data as Array<{ marker_name: string; marker_value: number; unit: string; collected_at: string }>) ?? [],
    todayBiometrics: (todayBiometricsRes.data as Record<string, unknown>) ?? null,
    recentBiometrics: (recentBiometricsRes.data as Array<Record<string, unknown>>) ?? [],
    todayNutrition: (todayNutritionRes.data as Record<string, unknown>) ?? null,
    recentNutrition: (recentNutritionRes.data as Array<Record<string, unknown>>) ?? [],
    todayMeals: (todayMealsRes.data as Array<Record<string, unknown>>) ?? [],
    todaySymptoms: (todaySymptomsRes.data as Array<{ symptom_name: string; severity: number | null; notes: string | null }>) ?? [],
    recentSymptoms: (recentSymptomsRes.data as Array<{ symptom_name: string; severity: number | null; logged_at: string }>) ?? [],
  };
}

// ────────────────────────────────────────────────────────────
// 2. Deterministic safety-gate engine
// ────────────────────────────────────────────────────────────

function normalizeSymptom(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, '_');
}

function evaluateRule(rule: RuleRow, ctx: UserContext): GateHit | null {
  const rv = rule.rule_value ?? {};

  switch (rule.rule_type) {
    case 'pregnancy':
      if (ctx.contraindications.pregnant) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;

    case 'nursing':
      if (ctx.contraindications.nursing) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;

    case 'sex': {
      const required = rv.sex as string | undefined;
      if (required && ctx.profile.sex && required.toLowerCase() === ctx.profile.sex.toLowerCase()) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;
    }

    case 'age': {
      const maxAge = rv.max_age as number | undefined;
      const minAge = rv.min_age as number | undefined;
      if (ctx.profile.age == null) return null;
      if (maxAge != null && ctx.profile.age <= maxAge) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      if (minAge != null && ctx.profile.age >= minAge) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;
    }

    case 'condition': {
      const required = (rv.any_of as string[] | undefined) ?? [];
      const userConditions = ctx.contraindications.conditions.map(c => c.toLowerCase());
      const hit = required.some(c => userConditions.some(u => u.includes(c.toLowerCase())));
      if (hit) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;
    }

    case 'medication': {
      const required = (rv.contains as string[] | undefined) ?? [];
      const userMeds = ctx.contraindications.medications.map(m => m.toLowerCase());
      const hit = required.some(m => userMeds.some(u => u.includes(m.toLowerCase())));
      if (hit) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;
    }

    case 'biomarker_high':
    case 'biomarker_low': {
      const name = (rv.name as string | undefined)?.toLowerCase();
      const threshold = rv.threshold as number | undefined;
      const ruleSex = (rv.sex as string | undefined)?.toLowerCase();
      if (!name || threshold == null) return null;

      // Sex-specific biomarker rules: skip if user sex doesn't match.
      if (ruleSex && ctx.profile.sex && ruleSex !== ctx.profile.sex.toLowerCase()) return null;

      // Use the most recent reading for this marker.
      // Prefer exact match (case-insensitive) before falling back to substring.
      // Substring-only matching picked up the wrong marker when the user had
      // e.g. both "Free Testosterone" and "Testosterone (Total)" rows.
      const lowered = ctx.latestLabs.map(l => ({ ...l, lname: l.marker_name.toLowerCase() }));
      const reading = lowered.find(l => l.lname === name)
        ?? lowered.find(l => l.lname.startsWith(name))
        ?? lowered.find(l => l.lname.includes(name));
      if (!reading) return null;

      const triggered = rule.rule_type === 'biomarker_high'
        ? reading.marker_value >= threshold
        : reading.marker_value <= threshold;
      if (triggered) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;
    }

    case 'symptom_pattern': {
      const anyOf = (rv.any_of as string[] | undefined) ?? [];
      const normalizedRequired = anyOf.map(normalizeSymptom);
      const todayNormalized = ctx.todaySymptoms.map(s => normalizeSymptom(s.symptom_name));
      const recentNormalized = ctx.recentSymptoms
        .filter(s => (s.severity ?? 0) >= 2)
        .map(s => normalizeSymptom(s.symptom_name));
      const allNormalized = new Set([...todayNormalized, ...recentNormalized]);
      const hit = normalizedRequired.some(r => Array.from(allNormalized).some(s => s.includes(r) || r.includes(s)));
      if (hit) {
        return { supplement: rule.supplement_name, severity: rule.severity, reason: rule.reason, rule_id: rule.id, rule_type: rule.rule_type };
      }
      return null;
    }

    default:
      return null;
  }
}

function runSafetyGates(rules: RuleRow[], ctx: UserContext): {
  blocked: GateHit[];
  cautioned: GateHit[];
} {
  const blocked: GateHit[] = [];
  const cautioned: GateHit[] = [];

  for (const rule of rules) {
    if (!rule.active) continue;
    const hit = evaluateRule(rule, ctx);
    if (!hit) continue;
    if (hit.severity === 'block') blocked.push(hit);
    else cautioned.push(hit);
  }

  // Dedupe by supplement name, preferring blocks over cautions.
  const blockedSet = new Set(blocked.map(b => b.supplement.toLowerCase()));
  const dedupedCautions = cautioned.filter(c => !blockedSet.has(c.supplement.toLowerCase()));

  return { blocked, cautioned: dedupedCautions };
}

// ────────────────────────────────────────────────────────────
// 3. LLM call
// ────────────────────────────────────────────────────────────

interface LLMOutput {
  recovery_status: 'green' | 'yellow' | 'red';
  explanation_short: string;
  explanation_long: string;
  top_actions: Array<{ title: string; detail: string; priority: 'high' | 'medium' | 'low' }>;
  training_guidance: string;
  nutrition_guidance: string;
  supplement_guidance: string;
  sleep_guidance: string;
  stress_guidance: string;
  supplements_to_skip_today: Array<{ name: string; reason: string }>;
  escalation_flag: string | null;
}

function buildSystemPrompt(blocked: GateHit[]): string {
  const blockedList = blocked.length === 0
    ? '(none)'
    : blocked.map(b => `- ${b.supplement}: ${b.reason}`).join('\n');

  return `You are a longevity coach AI assistant. You synthesize a user's daily health context (labs, biometrics, nutrition, symptoms, profile) into a single morning recommendation.

CRITICAL SAFETY RULES:
1. You MUST NOT recommend any supplement listed in the BLOCKED list below. These have been determined by deterministic safety gates and are non-negotiable.
2. For supplements in the CAUTION list, you may include them only with a clear monitoring note.
3. If you see a contraindication you weren't told about, surface it via escalation_flag rather than silently ignoring it.

BLOCKED SUPPLEMENTS (do not recommend):
${blockedList}

Return strict JSON matching this schema:
{
  "recovery_status": "green" | "yellow" | "red",
  "explanation_short": string (one sentence summary for the home-screen card),
  "explanation_long": string (2-4 sentence narrative),
  "top_actions": Array<{ "title": string, "detail": string, "priority": "high" | "medium" | "low" }> (3-5 items, ordered by impact today),
  "training_guidance": string,
  "nutrition_guidance": string,
  "supplement_guidance": string,
  "sleep_guidance": string,
  "stress_guidance": string,
  "supplements_to_skip_today": Array<{ "name": string, "reason": string }>,
  "escalation_flag": string | null (set when something needs practitioner review)
}`;
}

function buildUserPrompt(ctx: UserContext, cautioned: GateHit[]): string {
  const cautionList = cautioned.length === 0
    ? '(none)'
    : cautioned.map(c => `- ${c.supplement}: ${c.reason}`).join('\n');

  return `Today is ${ctx.date}.

PROFILE:
${JSON.stringify(ctx.profile, null, 2)}

CONTRAINDICATIONS:
${JSON.stringify(ctx.contraindications, null, 2)}

CAUTION SUPPLEMENTS (use only with monitoring guidance):
${cautionList}

LATEST LABS (most recent first, max 40 markers):
${JSON.stringify(ctx.latestLabs.slice(0, 40), null, 2)}

TODAY'S BIOMETRICS:
${JSON.stringify(ctx.todayBiometrics, null, 2)}

7-DAY BIOMETRIC TREND:
${JSON.stringify(ctx.recentBiometrics, null, 2)}

TODAY'S NUTRITION:
${JSON.stringify(ctx.todayNutrition, null, 2)}

7-DAY NUTRITION TREND:
${JSON.stringify(ctx.recentNutrition, null, 2)}

TODAY'S MEALS:
${JSON.stringify(ctx.todayMeals, null, 2)}

TODAY'S SYMPTOMS:
${JSON.stringify(ctx.todaySymptoms, null, 2)}

7-DAY SYMPTOMS (severity >= 2 only):
${JSON.stringify(ctx.recentSymptoms.filter(s => (s.severity ?? 0) >= 2), null, 2)}

CLINICAL INTAKE:
${JSON.stringify(ctx.clinicalIntake, null, 2)}

Generate today's coach output as strict JSON.`;
}

async function callLLM(systemPrompt: string, userPrompt: string): Promise<{ output: LLMOutput; raw: unknown }> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned no content');

  const parsed = JSON.parse(content) as LLMOutput;
  return { output: parsed, raw: json };
}

// ────────────────────────────────────────────────────────────
// 4. Post-filter
// ────────────────────────────────────────────────────────────

function postFilter(llmOutput: LLMOutput, blocked: GateHit[]): LLMOutput {
  if (blocked.length === 0) return llmOutput;

  const blockedNames = new Set(blocked.map(b => b.supplement.toLowerCase()));
  const skipSet = new Map<string, { name: string; reason: string }>();

  for (const s of llmOutput.supplements_to_skip_today ?? []) {
    skipSet.set(s.name.toLowerCase(), s);
  }

  for (const b of blocked) {
    const key = b.supplement.toLowerCase();
    if (!skipSet.has(key)) {
      skipSet.set(key, {
        name: b.supplement,
        reason: `Auto-blocked by safety gate: ${b.reason}`,
      });
    }
  }

  const sanitizeText = (text: string): string => {
    if (!text) return text;
    let result = text;
    for (const name of blockedNames) {
      const pattern = new RegExp(`\\brecommend(?:ed|ing|s)?\\s+${name}\\b`, 'gi');
      result = result.replace(pattern, `(safety-blocked: ${name})`);
    }
    return result;
  };

  return {
    ...llmOutput,
    supplement_guidance: sanitizeText(llmOutput.supplement_guidance ?? ''),
    explanation_long: sanitizeText(llmOutput.explanation_long ?? ''),
    supplements_to_skip_today: Array.from(skipSet.values()),
  };
}

// ────────────────────────────────────────────────────────────
// 5. Persist + audit
// ────────────────────────────────────────────────────────────

async function persistResult(
  sb: ReturnType<typeof createClient>,
  ctx: UserContext,
  output: LLMOutput,
  blocked: GateHit[],
  cautioned: GateHit[],
  llmRaw: unknown,
  durationMs: number,
  status: 'success' | 'failed' | 'partial',
  errorMsg: string | null,
): Promise<{ recommendationId: string | null }> {
  let recommendationId: string | null = null;

  if (status === 'success') {
    const { data: recRow, error: recErr } = await sb
      .from('daily_recommendations')
      .upsert(
        {
          user_id: ctx.userId,
          date: ctx.date,
          recovery_status: output.recovery_status,
          training_guidance: output.training_guidance,
          nutrition_guidance: output.nutrition_guidance,
          supplement_guidance: output.supplement_guidance,
          sleep_guidance: output.sleep_guidance,
          stress_guidance: output.stress_guidance,
          escalation_flag: output.escalation_flag,
          top_actions_json: output.top_actions as unknown as Record<string, unknown>[],
          explanation_short: output.explanation_short,
          explanation_long: output.explanation_long,
          recommendation_payload_json: output as unknown as Record<string, unknown>,
          ai_summary_json: {
            blocked_count: blocked.length,
            caution_count: cautioned.length,
            supplements_to_skip: output.supplements_to_skip_today,
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,date' },
      )
      .select('id')
      .single();

    if (recErr) {
      console.error('[daily-coach] Failed to upsert daily_recommendations', recErr);
    } else {
      recommendationId = (recRow as { id: string } | null)?.id ?? null;
    }
  }

  const { error: auditErr } = await sb
    .from('coach_run_logs')
    .insert({
      user_id: ctx.userId,
      date: ctx.date,
      daily_recommendation_id: recommendationId,
      context_snapshot: ctx as unknown as Record<string, unknown>,
      safety_gates_triggered: [...blocked, ...cautioned] as unknown as Record<string, unknown>[],
      llm_response_raw: llmRaw as Record<string, unknown> | null,
      duration_ms: durationMs,
      model_used: OPENAI_MODEL,
      status,
      error: errorMsg,
    });

  if (auditErr) {
    console.error('[daily-coach] Failed to write coach_run_logs', auditErr);
  }

  return { recommendationId };
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const startedAt = Date.now();

  let body: { userId?: string; date?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Resolve userId either from the body (service-role caller) or from the
  // caller's JWT (user-invoked path).
  let userId = body.userId;
  if (!userId) {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (authHeader.startsWith('Bearer ')) {
      const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: userData } = await userClient.auth.getUser();
      userId = userData?.user?.id ?? undefined;
    }
  }

  const date = body.date ?? new Date().toISOString().slice(0, 10);

  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId required (body or auth)' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  let ctx: UserContext | null = null;
  let blocked: GateHit[] = [];
  let cautioned: GateHit[] = [];
  let llmRaw: unknown = null;
  let output: LLMOutput | null = null;

  try {
    ctx = await aggregateContext(sb, userId, date);

    const { data: rulesData, error: rulesErr } = await sb
      .from('supplement_contraindication_rules')
      .select('id, supplement_name, rule_type, rule_value, severity, reason, active')
      .eq('active', true);

    if (rulesErr) throw new Error(`Failed to load rules: ${rulesErr.message}`);

    const gates = runSafetyGates((rulesData as RuleRow[]) ?? [], ctx);
    blocked = gates.blocked;
    cautioned = gates.cautioned;

    const systemPrompt = buildSystemPrompt(blocked);
    const userPrompt = buildUserPrompt(ctx, cautioned);
    const { output: rawOut, raw } = await callLLM(systemPrompt, userPrompt);
    llmRaw = raw;
    output = postFilter(rawOut, blocked);

    const { recommendationId } = await persistResult(
      sb, ctx, output, blocked, cautioned, llmRaw,
      Date.now() - startedAt, 'success', null,
    );

    return new Response(
      JSON.stringify({
        status: 'ok',
        recommendation_id: recommendationId,
        recovery_status: output.recovery_status,
        explanation_short: output.explanation_short,
        top_actions: output.top_actions,
        supplements_to_skip_today: output.supplements_to_skip_today,
        blocked_count: blocked.length,
        caution_count: cautioned.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[daily-coach] Failed', err);
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Always write an audit row, even when ctx aggregation itself failed.
    // We need the failure to be observable in coach_run_logs; silent
    // aggregator crashes are worst-case for debugging.
    const fallbackCtx: UserContext = ctx ?? {
      userId,
      date,
      profile: { sex: null, age: null, weight: null, goals: null },
      contraindications: { pregnant: false, nursing: false, medications: [], allergies: [], conditions: [] },
      clinicalIntake: null,
      questionnaire: [],
      latestLabs: [],
      todayBiometrics: null,
      recentBiometrics: [],
      todayNutrition: null,
      recentNutrition: [],
      todayMeals: [],
      todaySymptoms: [],
      recentSymptoms: [],
    };
    await persistResult(
      sb, fallbackCtx, output ?? {
        recovery_status: 'yellow',
        explanation_short: '',
        explanation_long: '',
        top_actions: [],
        training_guidance: '',
        nutrition_guidance: '',
        supplement_guidance: '',
        sleep_guidance: '',
        stress_guidance: '',
        supplements_to_skip_today: [],
        escalation_flag: null,
      },
      blocked, cautioned, llmRaw,
      Date.now() - startedAt,
      output ? 'partial' : 'failed',
      errorMsg,
    );

    return new Response(
      JSON.stringify({ status: 'error', error: errorMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
