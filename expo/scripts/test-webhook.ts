#!/usr/bin/env bun
/**
 * Dev test harness for the junction-webhook edge function.
 *
 * POSTs a signed sample Junction webhook payload against a local
 * `supabase functions serve` instance and prints the result.
 *
 * Usage:
 *   # Terminal 1: supabase functions serve junction-webhook
 *   # Terminal 2: bun expo/scripts/test-webhook.ts
 *
 * Env: JUNCTION_WEBHOOK_SIGNING_SECRET (must match the edge function's env)
 */

const WEBHOOK_URL = process.env.WEBHOOK_URL ?? 'http://localhost:54321/functions/v1/junction-webhook';
const SECRET = process.env.JUNCTION_WEBHOOK_SIGNING_SECRET ?? 'test-secret-for-dev';

const samplePayload = {
  event_type: 'daily.data.sleep.created',
  user_id: '00000000-0000-0000-0000-000000000001',
  client_user_id: 'test-user-1',
  data: {
    id: 'sleep-record-001',
    userId: '00000000-0000-0000-0000-000000000001',
    calendarDate: new Date().toISOString().substring(0, 10),
    bedtimeStart: new Date(Date.now() - 8 * 3600000).toISOString(),
    bedtimeStop: new Date().toISOString(),
    type: 'long_sleep',
    duration: 28800,
    total: 26400,
    awake: 2400,
    light: 10800,
    rem: 7200,
    deep: 8400,
    score: 85,
    hrLowest: 52,
    hrAverage: 58,
    hrResting: 54,
    efficiency: 92,
    latency: 600,
    temperatureDelta: -0.3,
    averageHrv: 42,
    respiratoryRate: 14.5,
    source: { provider: 'oura', slug: 'oura', name: 'Oura' },
  },
};

async function sign(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return 'sha256=' + Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function main() {
  const body = JSON.stringify(samplePayload);
  const signature = await sign(body, SECRET);

  console.log(`POST ${WEBHOOK_URL}`);
  console.log(`  event_type: ${samplePayload.event_type}`);
  console.log(`  user_id: ${samplePayload.user_id}`);
  console.log(`  signature: ${signature.substring(0, 30)}…`);
  console.log();

  const res = await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'svix-signature': signature,
    },
    body,
  });

  const status = res.status;
  const result = await res.json().catch(() => res.text());

  console.log(`Response: ${status}`);
  console.log(JSON.stringify(result, null, 2));
  console.log();

  if (status === 200 && result.status === 'ok') {
    console.log(`✅ Signature verified, ${result.inserted} event(s) inserted, ${result.errors?.length ?? 0} errors, 200 returned`);
  } else if (status === 401) {
    console.log('❌ Signature verification FAILED — check JUNCTION_WEBHOOK_SIGNING_SECRET');
  } else {
    console.log(`⚠️  Unexpected response: ${status}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
