/**
 * Supabase Edge Function: Rollup meal_logs → daily_nutrition_rollups
 *
 * For a given (userId, date), aggregates the per-meal rows into a single
 * daily_nutrition_rollups row. Mirrors rollup-biometrics in shape so the
 * daily-coach aggregator always has nutrition trend data to read.
 *
 * Computed fields:
 *   - total_{calories,protein_g,carbs_g,fat_g,fiber_g}: simple sums
 *   - meal_count: number of meal rows
 *   - first_meal_time / last_meal_time: ISO timestamps
 *   - eating_window_minutes: last - first (clamped to 24h)
 *   - protein_distribution_score: 0-100, higher when protein is spread
 *     evenly across meals (low variance vs. mean)
 *   - meal_timing_score: 0-100, prefers earlier last_meal_time and at
 *     least 3 meals in the day
 *   - inflammatory_load_total / glycemic_load_total: sums of the
 *     per-meal *_estimate columns
 *   - caffeine_mg / alcohol_units / hydration_ml: derived from
 *     meal_logs.tags_json or meal_logs.notes when the user logged them
 *
 * Called by:
 *   - Client after a meal is logged
 *   - Scheduled cron for end-of-day finalization
 *   - Manual trigger from admin
 *
 * Deploy: supabase functions deploy rollup-nutrition
 * Invoke: supabase.functions.invoke('rollup-nutrition', { body: { userId, date } })
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

interface MealRow {
  meal_time: string;
  meal_type: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  glycemic_load_estimate: number | null;
  inflammatory_load_estimate: number | null;
  tags_json: string[] | null;
  notes: string | null;
}

// ────────────────────────────────────────────────────────────
// Derive caffeine / alcohol / hydration from tags + notes
// ────────────────────────────────────────────────────────────

function sumFromMeals(
  meals: MealRow[],
  tagPredicate: (tag: string) => number | null,
  notePattern: RegExp,
): number {
  let total = 0;
  for (const meal of meals) {
    for (const tag of meal.tags_json ?? []) {
      const v = tagPredicate(tag);
      if (v != null) total += v;
    }
    if (meal.notes) {
      let match: RegExpExecArray | null;
      const re = new RegExp(notePattern.source, 'gi');
      while ((match = re.exec(meal.notes)) !== null) {
        const n = parseFloat(match[1]);
        if (Number.isFinite(n)) total += n;
      }
    }
  }
  return total;
}

function caffeineFromTag(tag: string): number | null {
  const m = tag.match(/^caffeine[: ](\d+(?:\.\d+)?)(?:mg)?$/i);
  if (m) return parseFloat(m[1]);
  // Bare tag like "coffee" - assume 95mg.
  if (/^coffee$/i.test(tag)) return 95;
  if (/^espresso$/i.test(tag)) return 64;
  if (/^green[_ ]tea$/i.test(tag)) return 35;
  return null;
}

function alcoholFromTag(tag: string): number | null {
  const m = tag.match(/^alcohol[: ](\d+(?:\.\d+)?)$/i);
  if (m) return parseFloat(m[1]);
  if (/^beer$/i.test(tag)) return 1;
  if (/^wine$/i.test(tag)) return 1;
  if (/^cocktail$/i.test(tag)) return 1.5;
  return null;
}

function hydrationFromTag(tag: string): number | null {
  const m = tag.match(/^water[: ](\d+(?:\.\d+)?)(?:ml)?$/i);
  if (m) return parseFloat(m[1]);
  return null;
}

// ────────────────────────────────────────────────────────────
// Distribution + timing scores
// ────────────────────────────────────────────────────────────

function proteinDistributionScore(meals: MealRow[]): number | null {
  const proteinValues = meals.map(m => m.protein_g ?? 0);
  if (proteinValues.length < 2) return null;
  const mean = proteinValues.reduce((s, v) => s + v, 0) / proteinValues.length;
  if (mean === 0) return null;
  const variance =
    proteinValues.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / proteinValues.length;
  const cv = Math.sqrt(variance) / mean; // coefficient of variation
  // CV of 0 = perfect even distribution = 100. CV of 1+ = uneven = 0.
  return Math.max(0, Math.min(100, Math.round((1 - cv) * 100)));
}

function mealTimingScore(meals: MealRow[], firstMs: number | null, lastMs: number | null): number | null {
  if (meals.length === 0 || firstMs == null || lastMs == null) return null;
  let score = 50;
  // Bonus for 3-4 meals
  if (meals.length >= 3 && meals.length <= 4) score += 20;
  else if (meals.length >= 2) score += 10;
  // Bonus for finishing eating before 8pm local (assume UTC, will be slightly off)
  const lastDate = new Date(lastMs);
  const lastHour = lastDate.getUTCHours();
  if (lastHour <= 20) score += 15;
  else if (lastHour <= 22) score += 5;
  else score -= 10;
  // Bonus for eating window 8-12h
  const windowHours = (lastMs - firstMs) / (1000 * 60 * 60);
  if (windowHours >= 8 && windowHours <= 12) score += 15;
  else if (windowHours < 6) score += 5; // tight TRF
  else if (windowHours > 14) score -= 10;
  return Math.max(0, Math.min(100, score));
}

// ────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let body: { userId: string; date: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { userId, date } = body;
  if (!userId || !date) {
    return new Response(
      JSON.stringify({ error: 'userId and date required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = `${date}T23:59:59Z`;

  const { data: mealsRaw, error: fetchErr } = await sb
    .from('meal_logs')
    .select('meal_time, meal_type, calories, protein_g, carbs_g, fat_g, fiber_g, glycemic_load_estimate, inflammatory_load_estimate, tags_json, notes')
    .eq('user_id', userId)
    .gte('meal_time', dayStart)
    .lte('meal_time', dayEnd)
    .order('meal_time', { ascending: true });

  if (fetchErr) {
    console.error('[rollup-nutrition] meal_logs fetch failed', fetchErr);
    return new Response(
      JSON.stringify({ error: fetchErr.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const meals = (mealsRaw as MealRow[] | null) ?? [];

  if (meals.length === 0) {
    return new Response(
      JSON.stringify({ status: 'no_meals', userId, date }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const sum = (key: keyof MealRow): number | null => {
    let total = 0;
    let count = 0;
    for (const m of meals) {
      const v = m[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        total += v;
        count++;
      }
    }
    return count > 0 ? total : null;
  };

  const firstMealTime = meals[0].meal_time;
  const lastMealTime = meals[meals.length - 1].meal_time;
  const firstMs = new Date(firstMealTime).getTime();
  const lastMs = new Date(lastMealTime).getTime();
  const eatingWindowMin =
    Number.isFinite(firstMs) && Number.isFinite(lastMs)
      ? Math.min(24 * 60, Math.max(0, Math.round((lastMs - firstMs) / 60000)))
      : null;

  const caffeineMg = sumFromMeals(meals, caffeineFromTag, /caffeine[: ]?(\d+(?:\.\d+)?)(?:\s*mg)?/i) || null;
  const alcoholUnits = sumFromMeals(meals, alcoholFromTag, /alcohol[: ]?(\d+(?:\.\d+)?)/i) || null;
  const hydrationMl = sumFromMeals(meals, hydrationFromTag, /water[: ]?(\d+(?:\.\d+)?)(?:\s*ml)?/i) || null;

  const row = {
    user_id: userId,
    date,
    total_calories: sum('calories'),
    total_protein_g: sum('protein_g'),
    total_carbs_g: sum('carbs_g'),
    total_fat_g: sum('fat_g'),
    total_fiber_g: sum('fiber_g'),
    meal_count: meals.length,
    first_meal_time: firstMealTime,
    last_meal_time: lastMealTime,
    eating_window_minutes: eatingWindowMin,
    protein_distribution_score: proteinDistributionScore(meals),
    meal_timing_score: mealTimingScore(
      meals,
      Number.isFinite(firstMs) ? firstMs : null,
      Number.isFinite(lastMs) ? lastMs : null,
    ),
    inflammatory_load_total: sum('inflammatory_load_estimate'),
    glycemic_load_total: sum('glycemic_load_estimate'),
    alcohol_units: alcoholUnits,
    caffeine_mg: caffeineMg,
    hydration_ml: hydrationMl,
    updated_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await sb
    .from('daily_nutrition_rollups')
    .upsert(row, { onConflict: 'user_id,date' });

  if (upsertErr) {
    console.error('[rollup-nutrition] upsert failed', upsertErr);
    return new Response(
      JSON.stringify({ error: upsertErr.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  console.log(`[rollup-nutrition] ${userId}/${date}: ${meals.length} meals → rollup`);

  // Fan out: nutrition rollup feeds compute-baselines (some baselines pull
  // from rollup), then scores, then patterns. Fire-and-forget chain.
  void fetch(`${SUPABASE_URL}/functions/v1/compute-baselines`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, date }),
  }).catch(e => console.error('[rollup-nutrition] compute-baselines fan-out failed', e));

  return new Response(
    JSON.stringify({
      status: 'ok',
      userId,
      date,
      meals: meals.length,
      total_calories: row.total_calories,
      total_protein_g: row.total_protein_g,
      eating_window_minutes: row.eating_window_minutes,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
