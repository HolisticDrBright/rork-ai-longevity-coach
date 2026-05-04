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

  // Verify webhook secret
  const secret = req.headers.get('x-webhook-secret') ?? '';
  if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
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

  // Look up the user UUID from email if userId looks like a placeholder
  let resolvedUserId: string | null = null;
  if (userId && userId !== 'unknown' && userId !== 'anonymous' && userId.length > 10) {
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
    console.error('[Webhooks] Insert failed:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  console.log(`[Webhooks] ${eventType} from ${email || userId || 'unknown'} stored`);

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
