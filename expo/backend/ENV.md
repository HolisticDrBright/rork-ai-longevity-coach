# Backend Environment Variables

All environment variables required by the Hono/tRPC backend server.

## Required

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (e.g. `https://xxxx.supabase.co`). Used by `supabase-server.ts` to create authenticated Supabase clients for every tRPC request. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public API key. Paired with the URL above; passed as the second argument to `createClient`. |
| `PORT` | TCP port the server listens on. Defaults to `3000`. Set automatically by Fly.io / Railway. |

## Clinical project (dedicated PHI database — ADR 0001/0002)

Required for the `clinical.*` tRPC namespace (desktop app). These point at the
**dedicated clinical Supabase project**, a different project — and a different
`auth.users` pool — from the legacy variables above.

| Variable | Description |
|---|---|
| `CLINICAL_SUPABASE_URL` | Clinical project URL. Used by `clinical-supabase.ts`. |
| `CLINICAL_SUPABASE_ANON_KEY` | Clinical project anon key. Used to validate clinical-pool JWTs and to build per-request, RLS-scoped user clients. |
| `CLINICAL_SUPABASE_SERVICE_ROLE_KEY` | Clinical project service-role key. **Server-side only, never sent to any client**; used exclusively by explicit privileged operations — today that is one call: `auth.admin.inviteUserByEmail` inside `clinical.organizations.invite` when the email has no account yet. It never queries clinical tables; membership rows are written via the admin-gated RPC as the signed-in caller. Optional: without it, inviting a brand-new email fails honestly (existing accounts can still be added). |
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origins allowed by the CORS allowlist (e.g. the deployed desktop app origin). Native mobile sends no Origin header and is unaffected. |

## Optional

| Variable | Description |
|---|---|
| `NODE_ENV` | `development`, `preview`, or `production`. Controls Sentry enablement and log verbosity. Defaults to `production`. |
| `CLINICAL_DESKTOP_URL` | Deployed desktop app origin (e.g. `https://clinic.example.com`). Used as the `redirectTo` for invitation emails so the link opens the desktop's `/reset` page; must also be in the Supabase auth redirect allowlist. Without it, Supabase falls back to the project's Site URL. |
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

## Scribe (Milestone 1 — consent-gated recording + AI scribe)

| Variable | Required | Purpose |
| --- | --- | --- |
| `SCRIBE_MODE` | no (default `fixture`) | `fixture` (deterministic local provider, development/CI only), `live` (production provider required), or `disabled` (no provider at all — every scribe entry point answers "Not configured" and fails closed). In live mode the fixture can never be selected; live with nothing configured also refuses. `disabled` is the recommended deployed value until a production provider is approved. |
| `SCRIBE_CALLBACK_SECRET` | fixture/live modes only (≥16 chars) | HMAC-SHA256 secret for provider callback verification. Fixture and production callbacks are signed and verified identically. OMIT when `SCRIBE_MODE=disabled` — the callback route answers "not configured" without it; in fixture/live modes a missing secret refuses callbacks with a clean 503, never a crash. |
| `HEALTHSCRIBE_REGION` | live only | Approved AWS region for HealthScribe. |
| `HEALTHSCRIBE_KMS_KEY_ARN` | live only | Customer-managed KMS key for output encryption. |
| `HEALTHSCRIBE_DATA_ACCESS_ROLE_ARN` | live only | IAM role HealthScribe assumes for S3 access. |
| `HEALTHSCRIBE_READINESS_REF` | live only | Reference to the operational-readiness record. |

The production adapter additionally requires a platform-administrator
enablement ROW in `provider_enablements` (enabled + region + encryption
config + retention config + readiness ref), enforced inside the
`begin_recording` RPC. **No environment flag is treated as proof that a BAA
exists** — contractual and legal verification is an external, human
responsibility, and the adapter ships disabled.

## Lens AI (Milestone 2 — differential questions + clinical lens engine)

| Variable | Required | Purpose |
| --- | --- | --- |
| `LENS_AI_MODE` | no (default `fixture`) | `fixture` (deterministic test AI, same safety gates as everything else), `live`, or `disabled` (AI assistance simply off — "Not configured"). Live mode ALWAYS refuses today: unconfigured → "the fixture cannot serve live mode"; fully configured → "disabled pending external approval". The deterministic lens engine runs regardless of this setting. `disabled` is the recommended deployed value. |
| `LENS_AI_PROVIDER` / `LENS_AI_MODEL` / `LENS_AI_APPROVAL_REF` | live only | Production lens-AI identity + the external approval record reference. Setting them is **not** approval — the production path stays disabled pending external review, and no environment flag changes that. |

## Deployed environments (Railway / Fly)

Fixture providers are for local development and CI **only**. When the process
detects a deployment platform (`RAILWAY_PROJECT_ID` / `RAILWAY_ENVIRONMENT_*` /
`RAILWAY_SERVICE_ID` / `FLY_APP_NAME`) or the operator sets
`DEPLOYED_ENVIRONMENT=<any value>`, fixture modes are REFUSED at every entry
point — endpoints fail closed instead of silently serving fixture output.

Required posture for any deployed instance:

| Variable | Value | Effect |
| --- | --- | --- |
| `SCRIBE_MODE` | `disabled` | Honest posture: no provider exists, endpoints answer "Not configured" and fail closed. (`live` is also refused-until-approved but implies a provider is expected.) |
| `LENS_AI_MODE` | `disabled` | AI assistance off ("Not configured"); the deterministic lens engine is unaffected. |
| `NODE_ENV` | `production` | Enables production log/header behavior. |

Leaving `SCRIBE_MODE`/`LENS_AI_MODE` unset in a deployed environment does NOT
fall back to fixtures — the guard refuses the fixture default and the startup
log prints a warning naming the missing setting. Set them explicitly to
`disabled` (recommended) or `live`.
