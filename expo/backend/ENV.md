# Backend Environment Variables

All environment variables required by the Hono/tRPC backend server.

> **Key rotation required:** API keys that were previously bundled into the
> client app as `EXPO_PUBLIC_*` variables (notably the OpenAI key) shipped
> inside the app binary and must be treated as compromised. Rotate them with
> the provider before configuring the server-side variables below.

## Required

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (e.g. `https://xxxx.supabase.co`). Used by `supabase-server.ts` to create authenticated Supabase clients for every tRPC request. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public API key. Paired with the URL above; passed as the second argument to `createClient`. |
| `PORT` | TCP port the server listens on. Defaults to `3000`. Set automatically by Fly.io / Railway. |
| `OPENAI_API_KEY` | OpenAI API key, **server-only**. The old `EXPO_PUBLIC_OPENAI_API_KEY` client variable is removed — it must never be bundled into the app again, and any previously shipped key must be rotated. |

## Optional

| Variable | Description |
|---|---|
| `NODE_ENV` | `development`, `preview`, or `production`. Controls Sentry enablement, log verbosity, and the CORS default (see `ALLOWED_ORIGINS`). Defaults to `production`. |
| `ALLOWED_ORIGINS` | Comma-separated list of origins allowed by CORS (e.g. `https://app.example.com,https://admin.example.com`). When unset: `*` outside production; **in production cross-origin requests are denied** (no `Access-Control-Allow-Origin` is returned). |
| `RATE_LIMIT_PER_MIN` | Max requests per minute per client IP on `/api/trpc/*` (in-memory sliding window; 429 when exceeded). Defaults to `60`. |
| `OPENAI_CHAT_MODEL` | Override for the chat completion model. |
| `OPENAI_VISION_MODEL` | Override for the vision model. |
| `OPENAI_TRANSCRIBE_MODEL` | Override for the audio transcription model. |
| `VITAL_API_KEY` | Junction (Vital) API key for wearable integrations, server-only. |
| `VITAL_ENV` | Junction (Vital) environment (`sandbox` or `production`). |
| `PASSIO_API_KEY` | Passio nutrition API key, server-only. Never logged. |
| `PASSIO_BASE_URL` | Passio API base URL. Defaults to `https://api.passiolife.com/v2`. |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry DSN for the backend. If omitted, Sentry initialization is skipped and errors are only logged to stdout. |
| `SENTRY_AUTH_TOKEN` | Sentry auth token used at **build time** to upload source maps via `@sentry/react-native/expo` plugin. Not needed at runtime. |
| `APP_VERSION` | Semantic version string returned by `GET /health`. Defaults to `1.0.0`. |
| `EXPO_PUBLIC_WEBHOOK_SECRET` | Shared HMAC secret for verifying inbound webhook payloads. Only needed if the webhook routes in `lib/webhooks.ts` are active. |

## Supabase Edge Function Secrets

Set with `supabase secrets set NAME=value`. All three verification secrets are
**fail-closed**: if unset, the function refuses to process requests (HTTP 500)
rather than accepting them unverified.

| Variable | Function | Description |
|---|---|---|
| `JUNCTION_WEBHOOK_SIGNING_SECRET` | `junction-webhook` | **Required.** Svix signing secret from the Junction/Vital dashboard (`whsec_...`). Signatures are verified (svix `v1` scheme, 5-minute timestamp tolerance) before any payload is processed. A legacy `x-junction-signature` hex-HMAC fallback is also supported. |
| `APP_WEBHOOK_SECRET` | `app-webhooks` | **Required.** Shared secret expected in the `x-webhook-secret` header (constant-time compared). |
| `ROLLUP_SECRET` | `rollup-biometrics`, `junction-webhook` | **Required.** Shared secret expected in the `x-rollup-secret` header of `rollup-biometrics`; `junction-webhook` sends it when triggering rollups, so set it for both functions. |

## Database Migration

`supabase/migrations/20260702000000_rls_policies.sql` adds RLS policies for
every application table (owner-scoped `clinician_id` / `user_id` / `id =
auth.uid()` policies, plus read-only reference tables). **This migration must
be applied** — the clinic API relies on RLS for tenant isolation. Review it
against the live schema before deploying; the service role bypasses RLS.

## Fly.io Secrets

After creating the Fly app, set secrets with:

```bash
fly secrets set \
  EXPO_PUBLIC_SUPABASE_URL="https://xxxx.supabase.co" \
  EXPO_PUBLIC_SUPABASE_ANON_KEY="eyJ..." \
  OPENAI_API_KEY="sk-..." \
  ALLOWED_ORIGINS="https://app.example.com" \
  RATE_LIMIT_PER_MIN="60" \
  EXPO_PUBLIC_SENTRY_DSN="https://xxx@sentry.io/xxx" \
  EXPO_PUBLIC_WEBHOOK_SECRET="your-webhook-secret"
```

`PORT` and `NODE_ENV` are set in `fly.toml` under `[env]` and do not need to be secrets.

## Railway

Set the same variables in the Railway dashboard under **Variables**. Railway auto-injects `PORT`.
