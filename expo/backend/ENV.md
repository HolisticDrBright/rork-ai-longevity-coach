# Backend Environment Variables

All environment variables required by the Hono/tRPC backend server.

## Required

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (e.g. `https://xxxx.supabase.co`). Used by `supabase-server.ts` to create authenticated Supabase clients for every tRPC request. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public API key. Paired with the URL above; passed as the second argument to `createClient`. |
| `PORT` | TCP port the server listens on. Defaults to `3000`. Set automatically by Fly.io / Railway. |

## Optional

| Variable | Description |
|---|---|
| `NODE_ENV` | `development`, `preview`, or `production`. Controls Sentry enablement and log verbosity. Defaults to `production`. |
| `EXPO_PUBLIC_SENTRY_DSN` | Sentry DSN for the backend. If omitted, Sentry initialization is skipped and errors are only logged to stdout. |
| `SENTRY_AUTH_TOKEN` | Sentry auth token used at **build time** to upload source maps via `@sentry/react-native/expo` plugin. Not needed at runtime. |
| `APP_VERSION` | Semantic version string returned by `GET /health`. Defaults to `1.0.0`. |
| `EXPO_PUBLIC_WEBHOOK_SECRET` | Shared HMAC secret for verifying inbound webhook payloads. Only needed if the webhook routes in `lib/webhooks.ts` are active. |

## Server-side AI (Phase 2)

| Variable | Description |
|---|---|
| `AI_PROVIDER_API_KEY` | **Enables all server-side AI.** API key for an OpenAI-compatible provider. When unset, AI-optional features (hypothesis suggestions, server lab extraction) degrade to deterministic behavior and `labs.capabilities` reports `serverAiConfigured: false`. |
| `AI_PROVIDER_BASE_URL` | OpenAI-compatible base URL. Default `https://api.openai.com/v1`. Point at an org-approved gateway to control where PHI flows. |
| `AI_MODEL` | Model name passed to `/chat/completions`. Default `gpt-4.1`. |
| `AI_TIMEOUT_MS` | Per-request timeout. Default `90000`. |

Every AI call is logged to the `ai_operations` table (template, version, validation result, latency, retries) and clinical outputs are created `pending_review`. Once these are set, lab uploads route through `labs.extract` on the server and the client-side `EXPO_PUBLIC_OPENAI_API_KEY` path is no longer used for lab analysis (rotate and remove it after migration).

## Clinical Reasoning (Phase 1)

The `reasoning.*` tRPC routes need **no additional backend env vars**, but they do
require the migration `supabase/migrations/20260715090000_clinical_reasoning_foundation.sql`
to be applied to the Supabase project (`supabase db push`, or paste into the SQL editor).
Until it is applied, reasoning queries return empty results and `analysis.run` returns a
clear error. Practitioner-only routes check the `user_roles` table server-side — a user
needs a `practitioner` (or `admin`) row there to pass `practitionerProcedure`.

Client-side feature flags (set in the Expo build environment, all default **on** for
Phase 1 and **off** for later phases): `EXPO_PUBLIC_FLAG_CLINICAL_REASONING`,
`EXPO_PUBLIC_FLAG_HEALTH_TWIN`, `EXPO_PUBLIC_FLAG_N_OF_1`,
`EXPO_PUBLIC_FLAG_SUPPLEMENT_INTELLIGENCE`, `EXPO_PUBLIC_FLAG_QUANTUM_MIND`
(set to `false` to disable). See `lib/featureFlags.ts`.

## Fly.io Secrets

After creating the Fly app, set secrets with:

```bash
fly secrets set \
  EXPO_PUBLIC_SUPABASE_URL="https://xxxx.supabase.co" \
  EXPO_PUBLIC_SUPABASE_ANON_KEY="eyJ..." \
  EXPO_PUBLIC_SENTRY_DSN="https://xxx@sentry.io/xxx" \
  EXPO_PUBLIC_WEBHOOK_SECRET="your-webhook-secret"
```

`PORT` and `NODE_ENV` are set in `fly.toml` under `[env]` and do not need to be secrets.

## Railway

Set the same variables in the Railway dashboard under **Variables**. Railway auto-injects `PORT`.
