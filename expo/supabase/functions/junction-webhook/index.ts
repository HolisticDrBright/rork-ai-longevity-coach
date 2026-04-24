/**
 * Supabase Edge Function: Junction (Vital) Webhook Handler
 *
 * Receives webhook payloads from Junction when wearable data arrives.
 * Verifies the webhook signature, normalizes the payload, and inserts
 * into raw_health_events with idempotent upserts.
 *
 * After insertion, triggers the rollup function to update
 * daily_biometric_records for the affected user + date.
 *
 * Deploy: supabase functions deploy junction-webhook
 * Test:   supabase functions serve junction-webhook
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';
import { createHmac } from 'https://deno.land/std@0.208.0/crypto/mod.ts';

const WEBHOOK_SECRET = Deno.env.get('JUNCTION_WEBHOOK_SIGNING_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// ────────────────────────────────────────────────────────────
// Webhook signature verification
// ────────────────────────────────────────────────────────────

async function verifySignature(body: string, signature: string): Promise<boolean> {
  if (!WEBHOOK_SECRET || !signature) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const computed = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return computed === signature.replace('sha256=', '');
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// Event type → record_type mapping
// ────────────────────────────────────────────────────────────

function getRecordType(eventType: string): string | null {
  // Junction event types follow pattern: "daily.data.<resource>.created" or "daily.data.<resource>.updated"
  // Also: "historical.data.<resource>.created"
  const match = eventType.match(/(?:daily|historical)\.data\.(\w+)\.\w+/);
  if (match) return match[1];

  // Fallback patterns
  if (eventType.includes('sleep')) return 'sleep';
  if (eventType.includes('activity')) return 'activity';
  if (eventType.includes('body')) return 'body';
  if (eventType.includes('workout')) return 'workout';
  if (eventType.includes('heart_rate')) return 'heart_rate';
  if (eventType.includes('hrv') || eventType.includes('heart_rate_variability')) return 'hrv';
  if (eventType.includes('blood_oxygen')) return 'blood_oxygen';
  if (eventType.includes('blood_pressure')) return 'blood_pressure';
  if (eventType.includes('glucose')) return 'glucose';
  if (eventType.includes('respiratory')) return 'respiratory_rate';
  if (eventType.includes('temperature')) return 'temperature';
  if (eventType.includes('vo2')) return 'vo2_max';
  if (eventType.includes('steps')) return 'steps';
  if (eventType.includes('water')) return 'water';
  if (eventType.includes('caffeine')) return 'caffeine';
  if (eventType.includes('menstrual')) return 'menstrual_cycle';

  return null;
}

function getSource(data: any): string {
  const provider = data?.source?.provider ?? data?.source?.slug ?? 'unknown';
  const slug = String(provider).toLowerCase();
  if (slug === 'apple_health_kit' || slug === 'apple_health') return 'junction:healthkit';
  if (slug === 'health_connect') return 'junction:health_connect';
  return `junction:${slug}`;
}

function getProvider(data: any): string {
  return data?.source?.provider ?? data?.source?.slug ?? 'unknown';
}

function getRecordedAt(data: any): string {
  return data?.calendarDate
    ?? data?.calendar_date
    ?? data?.date
    ?? data?.timeStart
    ?? data?.time_start
    ?? data?.timestamp
    ?? new Date().toISOString();
}

function getExternalId(data: any): string | null {
  return data?.id ?? null;
}

// ────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.text();
  const signature = req.headers.get('x-vital-webhook-signature')
    ?? req.headers.get('svix-signature')
    ?? '';

  // Verify webhook signature (skip in dev if secret not set)
  if (WEBHOOK_SECRET) {
    const valid = await verifySignature(body, signature);
    if (!valid) {
      console.error('[Webhook] Invalid signature');
      return new Response('Invalid signature', { status: 401 });
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const eventType = payload.event_type ?? payload.eventType ?? '';
  const userId = payload.user_id ?? payload.userId ?? payload.client_user_id ?? payload.clientUserId;
  const data = payload.data;

  if (!userId || !data) {
    console.log('[Webhook] Missing userId or data, skipping', { eventType });
    return new Response(JSON.stringify({ status: 'skipped', reason: 'missing_data' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const recordType = getRecordType(eventType);
  if (!recordType) {
    console.log('[Webhook] Unknown event type, skipping', { eventType });
    return new Response(JSON.stringify({ status: 'skipped', reason: 'unknown_event_type' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Handle array data (some events contain arrays of records)
  const records = Array.isArray(data) ? data : [data];
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const record of records) {
    const source = getSource(record);
    const provider = getProvider(record);
    const recordedAt = getRecordedAt(record);
    const externalId = getExternalId(record);

    try {
      // ON CONFLICT DO NOTHING — idempotent against migration 011's unique index.
      // Duplicates are silently skipped (no error, no update).
      const { error } = await sb.from('raw_health_events').upsert(
        {
          user_id: userId,
          provider,
          source,
          provider_record_id: externalId,
          record_type: recordType,
          payload_json: record,
          recorded_at: recordedAt,
        },
        {
          onConflict: 'user_id,provider,record_type,recorded_at,provider_record_id',
          ignoreDuplicates: true,
        },
      );

      if (error) {
        errors.push(`${recordType}/${externalId}: ${error.message}`);
      } else {
        inserted++;
      }
    } catch (err) {
      // Batch resilience: log and continue to next record.
      errors.push(`${recordType}/${externalId}: ${(err as Error).message}`);
    }
  }

  // Return 200 fast — webhook contract fulfilled. Rollup runs async.
  console.log(`[Webhook] ${eventType}: inserted=${inserted}, skipped=${skipped}, errors=${errors.length}`);

  const response = new Response(
    JSON.stringify({ status: 'ok', inserted, skipped, errors }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

  // Post-response async work: update connection timestamp + trigger rollup.
  // These run after the 200 has been sent (Deno edge functions support this).
  if (inserted > 0 && records.length > 0) {
    const provider = getProvider(records[0]);

    // Update last_successful_sync_at (first successful insert per webhook call)
    sb.from('wearable_connections')
      .update({
        last_sync_at: new Date().toISOString(),
        last_successful_sync_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('provider', provider)
      .then(() => {}, (err) => console.error('[Webhook] Connection update failed', err));

    // Trigger rollup for affected dates (fire-and-forget)
    const dates = new Set(records.map(r => {
      const d = getRecordedAt(r);
      return typeof d === 'string' ? d.substring(0, 10) : new Date(d).toISOString().substring(0, 10);
    }));
    for (const date of dates) {
      sb.functions.invoke('rollup-biometrics', { body: { userId, date } })
        .then(() => {}, (err) => console.error('[Webhook] Rollup failed', { date, err }));
    }
  }

  return response;
});
