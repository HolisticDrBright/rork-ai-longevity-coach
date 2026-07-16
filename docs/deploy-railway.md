# Deploying the backend to Railway

The Hono/tRPC backend deploys to Railway from the repo-root `Dockerfile`
(bun runtime — no Node version to pin; the image is `oven/bun:1`).
`railway.json` selects the Dockerfile builder and points Railway's HTTP health
check at `GET /health`. The server binds `0.0.0.0:$PORT` (Railway injects
`PORT` automatically).

## One-time setup

1. Railway → **New Project → Deploy from GitHub repo** → select
   `rork-ai-longevity-coach` (root directory `/`; Railway picks up
   `railway.json` + `Dockerfile` automatically).
2. **Variables** — set these in the Railway service (never commit values):

   | Variable | Notes |
   | --- | --- |
   | `CLINICAL_SUPABASE_URL` | dedicated clinical project URL |
   | `CLINICAL_SUPABASE_ANON_KEY` | clinical anon key (JWT validation + RLS-scoped user clients) |
   | `CLINICAL_SUPABASE_SERVICE_ROLE_KEY` | only if the privileged flows (invitation claim, import commit) are enabled; the `clinical.*` read/write procedures in this repo never use it |
   | `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | legacy project (mobile `clinic.*`/`nutrition.*` namespaces) |
   | `CORS_ALLOWED_ORIGINS` | comma-separated browser origins of the deployed desktop app, e.g. `https://app.example.com`. Unset ⇒ only localhost dev origins; never `*`. |
   | `NODE_ENV` | `production` |
   | `APP_VERSION` (optional) | echoed by `/health` |
   | `EXPO_PUBLIC_SENTRY_DSN` (optional) | backend error reporting |

   Missing clinical vars fail **safe**: the server boots, `/health` stays
   green, and `clinical.*` calls return typed errors ("clinical project is
   not configured") rather than crashing or falling back to another database.
3. Deploy. Verify:
   - `curl https://<railway-domain>/health` → `{"status":"healthy",...}`
   - `curl https://<railway-domain>/api/trpc/clinical.whoami` → tRPC
     UNAUTHORIZED error JSON (auth gate working, no token).

## Wire up the desktop

In the desktop app's environment (see `AI_DESKTOP_PRO/.env.example`):

```
NEXT_PUBLIC_USE_LIVE_API=true
TRPC_BASE_URL=https://<railway-domain>/api/trpc
CLINICAL_SUPABASE_URL=<clinical project url>       # sign-in token endpoint
CLINICAL_SUPABASE_ANON_KEY=<clinical anon key>
CLINICAL_ORG_ID=<seeded organization uuid>
```

Then run the deployed-environment verification from `AI_DESKTOP_PRO`:

```
NEXT_PUBLIC_USE_LIVE_API=true npm run build
E2E_LIVE=1 TRPC_BASE_URL=https://<railway-domain>/api/trpc \
  CLINICAL_SUPABASE_URL=<clinical url> CLINICAL_SUPABASE_ANON_KEY=<anon key> \
  CLINICAL_DEMO_EMAIL=<seeded practitioner email> CLINICAL_DEMO_PASSWORD=<their password> \
  CLINICAL_ORG_ID=<org uuid> npm run test:e2e -- e2e/live-tasks.spec.ts
```

(Seeding the org/practitioner/patient/labs data first:
`AI_DESKTOP_PRO/docs/live-auth-and-seeding.md`.)

## Security posture (unchanged by deployment)

- Browser → desktop server → this backend → clinical Supabase; the browser
  never holds Supabase data credentials.
- All `clinical.*` reads run as the caller under RLS; writes go through the
  SECURITY DEFINER RPCs (desktop repo migrations 0013–0015) that authorize the
  caller in-function and stamp actor ids server-side.
- CORS is an explicit allowlist; logs are scrubbed (`log-scrub.ts`); no PHI in
  error messages.
