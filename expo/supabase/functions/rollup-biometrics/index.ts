/**
 * Supabase Edge Function: Rollup raw_health_events → daily_biometric_records
 *
 * For a given (userId, date), queries all raw_health_events, normalizes
 * them using the same field-mapping logic as providerNormalization.ts,
 * resolves conflicts by source precedence, and upserts the result into
 * daily_biometric_records.
 *
 * This is the critical missing piece that connects raw data ingestion
 * (from the webhook) to the analytical engines (which read
 * daily_biometric_records).
 *
 * Called by:
 *   - junction-webhook after inserting new events
 *   - A scheduled cron for catch-up rollups
 *   - Manual trigger from the admin dashboard
 *
 * Deploy: supabase functions deploy rollup-biometrics
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Source precedence: higher = preferred when conflicting.
// Matches DEFAULT_PRECEDENCE from providerNormalization.ts.
const SOURCE_PRIORITY: Record<string, number> = {
  'junction:oura': 100,
  'junction:whoop': 90,
  'junction:garmin': 80,
  'junction:fitbit': 70,
  'junction:withings': 65,
  'junction:eight_sleep': 60,
  'junction:polar': 55,
  'junction:healthkit': 50,
  'junction:health_connect': 45,
  manual: 10,
};

function getPriority(source: string): number {
  return SOURCE_PRIORITY[source] ?? 30;
}

// ────────────────────────────────────────────────────────────
// Field mappings: raw payload → daily_biometric_records columns
// ────────────────────────────────────────────────────────────

interface DailyRow {
  [key: string]: number | string | null | undefined | boolean | string[];
}

function normalizeSleep(payload: any): Partial<DailyRow> {
  const toMin = (sec: number | null | undefined) => sec != null ? Math.round(sec / 60) : null;
  return {
    sleep_duration_minutes: toMin(payload.duration ?? payload.total),
    sleep_efficiency: payload.efficiency ?? null,
    deep_sleep_minutes: toMin(payload.deep),
    rem_sleep_minutes: toMin(payload.rem),
    light_sleep_minutes: toMin(payload.light),
    sleep_latency_minutes: toMin(payload.latency),
    wake_after_sleep_onset_minutes: toMin(payload.awake),
    sleep_score: payload.score ?? null,
    bedtime: payload.bedtimeStart ?? payload.bedtime_start ?? null,
    wake_time: payload.bedtimeStop ?? payload.bedtime_stop ?? null,
    hrv: payload.averageHrv ?? payload.average_hrv ?? null,
    resting_hr: payload.hrResting ?? payload.hr_resting ?? payload.hrLowest ?? payload.hr_lowest ?? null,
    avg_hr: payload.hrAverage ?? payload.hr_average ?? null,
    respiratory_rate: payload.respiratoryRate ?? payload.respiratory_rate ?? null,
    temp_deviation: payload.temperatureDelta ?? payload.temperature_delta ?? null,
  };
}

function normalizeActivity(payload: any): Partial<DailyRow> {
  const low = payload.low ?? 0;
  const med = payload.medium ?? 0;
  const high = payload.high ?? 0;
  return {
    steps: payload.steps ?? null,
    distance_meters: payload.distance ?? null,
    calories_burned: payload.caloriesTotal ?? payload.calories_total ?? payload.caloriesActive ?? null,
    active_minutes: med + high > 0 ? med + high : null,
    sedentary_minutes: (low + med + high) > 0 ? Math.max(0, 1440 - low - med - high) : null,
  };
}

function normalizeBody(payload: any): Partial<DailyRow> {
  return {
    weight_kg: payload.weight ?? null,
    body_fat_percent: payload.fat ?? null,
  };
}

function normalizeWorkout(payload: any): Partial<DailyRow> {
  const movingSec = payload.movingTime ?? payload.moving_time;
  return {
    workout_minutes: movingSec != null ? Math.round(movingSec / 60) : null,
    calories_burned: payload.calories ?? null,
    vo2max: null, // VO2 max comes from its own timeseries
  };
}

function normalizeTimeseries(recordType: string, payload: any): Partial<DailyRow> {
  const value = payload.value ?? payload.data?.[0]?.value;
  if (value == null) return {};

  switch (recordType) {
    case 'blood_oxygen': return { spo2: value };
    case 'glucose': {
      // Junction delivers mmol/L; our column is mg/dL
      const mgDl = value * 18.0182;
      return { glucose_avg: Math.round(mgDl * 10) / 10 };
    }
    case 'vo2_max': return { vo2max: value };
    case 'heart_rate': return { resting_hr: payload.restingBpm ?? payload.resting_bpm ?? value };
    case 'hrv': return { hrv: value };
    case 'respiratory_rate': return { respiratory_rate: value };
    case 'temperature': return { temp_deviation: value };
    case 'blood_pressure': return {
      systolic_bp: payload.systolic ?? value,
      diastolic_bp: payload.diastolic ?? null,
    };
    default: return {};
  }
}

function normalizePayload(recordType: string, payload: any): Partial<DailyRow> {
  switch (recordType) {
    case 'sleep': return normalizeSleep(payload);
    case 'activity': return normalizeActivity(payload);
    case 'body': return normalizeBody(payload);
    case 'workout': return normalizeWorkout(payload);
    default: return normalizeTimeseries(recordType, payload);
  }
}

// ────────────────────────────────────────────────────────────
// Merge: higher-priority source wins per field
// ────────────────────────────────────────────────────────────

function mergeRecords(
  events: Array<{ source: string; record_type: string; payload_json: any }>,
): DailyRow {
  const merged: DailyRow = {};
  const fieldPriority: Record<string, number> = {};

  // Sort by priority ascending so higher-priority overwrites
  const sorted = [...events].sort(
    (a, b) => getPriority(a.source) - getPriority(b.source)
  );

  for (const event of sorted) {
    const normalized = normalizePayload(event.record_type, event.payload_json);
    const priority = getPriority(event.source);

    for (const [field, value] of Object.entries(normalized)) {
      if (value == null) continue;
      const existingPriority = fieldPriority[field] ?? -1;
      if (priority >= existingPriority) {
        merged[field] = value;
        fieldPriority[field] = priority;
      }
    }
  }

  // Set primary_source to the highest-priority source that contributed data
  const topSource = sorted[sorted.length - 1]?.source;
  if (topSource) merged.primary_source = topSource;

  return merged;
}

// ────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

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

  // 1. Fetch all raw events for this user + date
  const dateStart = `${date}T00:00:00Z`;
  const dateEnd = `${date}T23:59:59Z`;

  const { data: events, error: fetchError } = await sb
    .from('raw_health_events')
    .select('source, record_type, payload_json')
    .eq('user_id', userId)
    .gte('recorded_at', dateStart)
    .lte('recorded_at', dateEnd);

  if (fetchError) {
    console.error('[Rollup] Failed to fetch events', fetchError);
    return new Response(
      JSON.stringify({ error: fetchError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!events || events.length === 0) {
    return new Response(
      JSON.stringify({ status: 'no_data', userId, date }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // 2. Normalize + merge with source precedence
  const merged = mergeRecords(events);

  // 3. Compute data quality score (simple: % of key fields present)
  const keyFields = [
    'sleep_duration_minutes', 'hrv', 'resting_hr', 'steps',
    'sleep_efficiency', 'deep_sleep_minutes',
  ];
  const present = keyFields.filter(f => merged[f] != null).length;
  const dataQualityScore = Math.round((present / keyFields.length) * 100);

  // 4. Upsert into daily_biometric_records
  const row = {
    user_id: userId,
    date,
    ...merged,
    data_quality_score: dataQualityScore,
  };

  const { error: upsertError } = await sb
    .from('daily_biometric_records')
    .upsert(row, { onConflict: 'user_id,date' });

  if (upsertError) {
    console.error('[Rollup] Upsert failed', upsertError);
    return new Response(
      JSON.stringify({ error: upsertError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  console.log(`[Rollup] ${userId}/${date}: ${events.length} events → merged (quality=${dataQualityScore}%)`);

  return new Response(
    JSON.stringify({
      status: 'ok',
      userId,
      date,
      eventsProcessed: events.length,
      dataQualityScore,
      fieldsPopulated: Object.keys(merged).filter(k => merged[k] != null).length,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
