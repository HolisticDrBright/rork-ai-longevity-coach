/**
 * Supabase Edge Function: App Webhooks
 *
 * Receives webhook events from the mobile app (assessment completions,
 * lab uploads, supplement purchases, coaching interest, etc.) and stores
 * them in the webhook_events table.
 *
 * Replaces the old DigitalOcean webhook server at 137.184.84.143:3001.
 *
 * Deploy: supabase functions deploy app-webhooks
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.99.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('APP_WEBHOOK_SECRET') ?? '';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Constant-time string comparison to avoid timing side channels.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Webhook-Secret',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // FAIL CLOSED: never process anything without a configured secret.
  if (!WEBHOOK_SECRET) {
    console.error('[Webhooks] APP_WEBHOOK_SECRET not configured');
    return new Response('Webhook secret not configured', { status: 500 });
  }

  // Verify webhook secret (constant-time compare)
  const secret = req.headers.get('x-webhook-secret') ?? '';
  if (!timingSafeEqual(secret, WEBHOOK_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const eventType = String(payload.eventType ?? payload.event_type ?? 'unknown');
  const userId = String(payload.userId ?? payload.user_id ?? '');
  const email = String(payload.email ?? '');

  // Parse the URL path to get the endpoint name
  const url = new URL(req.url);
  const endpoint = url.pathname.split('/').pop() ?? '';

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Use the provided user_id only when it is a valid UUID; otherwise fall
  // back to looking the user up by email.
  let resolvedUserId: string | null = null;
  if (userId && UUID_REGEX.test(userId)) {
    resolvedUserId = userId;
  } else if (email) {
    const { data: user } = await sb
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (user) resolvedUserId = user.id;
  }

  // Store the event
  const { error } = await sb.from('webhook_events').insert({
    user_id: resolvedUserId,
    email: email || null,
    event_type: eventType,
    payload,
  });

  if (error) {
    // Log details server-side only — never return raw Postgres errors.
    console.error('[Webhooks] Insert failed:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Do not log user email (PII) — event type only.
  console.log(`[Webhooks] ${eventType} stored`);

  return new Response(
    JSON.stringify({ success: true, event_type: eventType, endpoint }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
});
