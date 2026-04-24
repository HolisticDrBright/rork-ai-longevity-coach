/**
 * Supabase Edge Function: Junction (Vital) Webhook Handler
 *
 * Verifies HMAC-SHA256 signature → inserts into raw_health_events with
 * ON CONFLICT DO NOTHING → returns 200 → async: updates last_sync_at +
 * triggers rollup via EdgeRuntime.waitUntil() so the runtime stays alive.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const WEBHOOK_SECRET = Deno.env.get('JUNCTION_WEBHOOK_SIGNING_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ── Signature verification ─────────────────────────────────

async function verifySignature(body: string, signature: string): Promise<boolean> {
  if (!WEBHOOK_SECRET || !signature) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const computed = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return computed === signature.replace('sha256=', '');
  } catch { return false; }
}

// ── Payload parsing helpers ────────────────────────────────

function getRecordType(eventType: string): string | null {
  const match = eventType.match(/(?:daily|historical)\.data\.(\w+)\.\w+/);
  if (match) return match[1];
  if (eventType.includes('sleep')) return 'sleep';
  if (eventType.includes('activity')) return 'activity';
  if (eventType.includes('body')) return 'body';
  if (eventType.includes('workout')) return 'workout';
  if (eventType.includes('heart_rate')) return 'heart_rate';
  if (eventType.includes('hrv') || eventType.includes('heart_rate_variability')) return 'hrv';
  if (eventType.includes('blood_oxygen')) return 'blood_oxygen';
  if (eventType.includes('respiratory')) return 'respiratory_rate';
  if (eventType.includes('temperature')) return 'temperature';
  if (eventType.includes('vo2')) return 'vo2_max';
  if (eventType.includes('steps')) return 'steps';
  return null;
}

function getSource(data: Record<string, unknown>): string {
  const provider = (data?.source as Record<string, unknown>)?.provider
    ?? (data?.source as Record<string, unknown>)?.slug ?? 'unknown';
  const slug = String(provider).toLowerCase();
  if (slug === 'apple_health_kit' || slug === 'apple_health') return 'junction:healthkit';
  if (slug === 'health_connect') return 'junction:health_connect';
  return `junction:${slug}`;
}

function getProvider(data: Record<string, unknown>): string {
  return String(
    (data?.source as Record<string, unknown>)?.provider
    ?? (data?.source as Record<string, unknown>)?.slug ?? 'unknown'
  );
}

function getRecordedAt(data: Record<string, unknown>): string {
  return String(
    data?.calendarDate ?? data?.calendar_date ?? data?.date
    ?? data?.timeStart ?? data?.time_start ?? data?.timestamp
    ?? new Date().toISOString()
  );
}

function getExternalId(data: Record<string, unknown>): string | null {
  return data?.id ? String(data.id) : null;
}

// ── Main handler ───────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // 1. Read body as text for signature verification
  const body = await req.text();
  const signature = req.headers.get('svix-signature')
    ?? req.headers.get('x-vital-webhook-signature')
    ?? '';

  // 2. Verify FIRST — reject with 401 before touching body
  if (WEBHOOK_SECRET) {
    const valid = await verifySignature(body, signature);
    if (!valid) {
      console.error('[Webhook] Invalid signature');
      return new Response('Invalid signature', { status: 401 });
    }
  }

  // 3. Parse
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(body); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const eventType = String(payload.event_type ?? payload.eventType ?? '');
  const userId = String(payload.user_id ?? payload.userId ?? payload.client_user_id ?? payload.clientUserId ?? '');
  const data = payload.data;

  if (!userId || !data) {
    return new Response(JSON.stringify({ status: 'skipped', reason: 'missing_data' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const recordType = getRecordType(eventType);
  if (!recordType) {
    return new Response(JSON.stringify({ status: 'skipped', reason: 'unknown_event_type' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  // 4. Insert — batch-resilient, ON CONFLICT DO NOTHING
  const records = Array.isArray(data) ? data : [data];
  let inserted = 0;
  const errors: string[] = [];

  for (const record of records) {
    const rec = record as Record<string, unknown>;
    const source = getSource(rec);
    const provider = getProvider(rec);
    const recordedAt = getRecordedAt(rec);
    const externalId = getExternalId(rec);

    try {
      const { error } = await sb.from('raw_health_events').upsert({
        user_id: userId,
        provider,
        source,
        provider_record_id: externalId,
        record_type: recordType,
        payload_json: rec,
        recorded_at: recordedAt,
      }, { onConflict: 'user_id,provider,record_type,recorded_at,provider_record_id', ignoreDuplicates: true });

      if (error) errors.push(`${recordType}/${externalId}: ${error.message}`);
      else inserted++;
    } catch (err) {
      errors.push(`${recordType}/${externalId}: ${(err as Error).message}`);
    }
  }

  // 5. Return 200 FAST
  console.log(`[Webhook] ${eventType}: inserted=${inserted}, errors=${errors.length}`);
  const response = new Response(
    JSON.stringify({ status: 'ok', inserted, errors }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

  // 6. BUG #4 FIX: Post-response async work via EdgeRuntime.waitUntil()
  //    Keeps the Deno isolate alive until each promise settles.
  if (inserted > 0 && records.length > 0) {
    const provider = getProvider(records[0] as Record<string, unknown>);

    // Update last_successful_sync_at
    // @ts-ignore — EdgeRuntime.waitUntil is a Supabase Deno extension
    EdgeRuntime.waitUntil(
      sb.from('wearable_connections')
        .update({
          last_sync_at: new Date().toISOString(),
          last_successful_sync_at: new Date().toISOString(),
          status: 'active',
        })
        .eq('user_id', userId)
        .eq('provider', provider)
        .then(() => {}, (err: unknown) => console.error('[Webhook] Connection update failed', err))
    );

    // Trigger rollup for affected dates
    const dates = new Set((records as Record<string, unknown>[]).map(r => {
      const d = getRecordedAt(r);
      return d.substring(0, 10);
    }));
    for (const date of dates) {
      // @ts-ignore — EdgeRuntime.waitUntil is a Supabase Deno extension
      EdgeRuntime.waitUntil(
        sb.functions.invoke('rollup-biometrics', { body: { userId, date } })
          .then(() => {}, (err: unknown) => console.error('[Webhook] Rollup failed', { date, err }))
      );
    }
  }

  return response;
});
