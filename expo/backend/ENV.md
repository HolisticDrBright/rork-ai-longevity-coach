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
