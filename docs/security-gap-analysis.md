# Security & Privacy Gap Analysis — Phase 0

> **⚠️ UPDATE (live schema captured):** After this was written from the repo, the
> live DB was introspected directly — see [`rls-snapshot.md`](./rls-snapshot.md).
> Key revisions: **#3 and #4 below are largely resolved in the live database** —
> RLS is enabled and correctly scoped on every `clinic_*` (per `clinician_id =
> auth.uid()`) and consumer PHI table (per `user_id = auth.uid()`), and a role +
> practitioner⇆patient-assignment model already exists. What remains true from
> #3 is that **none of it is in version control** (the migration is empty). A
> **new top finding** replaces the RLS worry: `utuszztwwadvoxxuyshn` is a
> **shared ~230-table multi-product database** with clinical PHI co-resident
> with unrelated systems (crypto, marketing, tarot). The client-side issues
> (#1 secrets in the bundle, #2 PHI→OpenAI, #6 XOR storage, #7 client-only
> audit log, #11 logging) are **unaffected and still stand.**
>
> **Nothing here should be read as a claim that the product is or is not
> HIPAA compliant.** Software findings ≠ compliance status.

## Severity summary

| # | Finding | Severity | Prompt requirement it violates |
| --- | --- | --- | --- |
| 1 | Secrets shipped in the client via `EXPO_PUBLIC_*` (OpenAI key, toolkit secret, Vital key, webhook secret) | **Critical** | "Secure secrets management"; "Service-role/secret never exposed to the client" |
| 2 | PHI (lab PDFs) uploaded client→OpenAI directly; no BAA boundary | **Critical** | "Use minimum necessary patient context"; "AI data-use in-region"; PHI handling |
| 3 | Database schema + RLS not in version control (empty migration) | **Critical** | "Versioned SQL migrations"; "RLS on every tenant/patient table"; "add tests for cross-tenant access" |
| 4 | No multi-tenant model; inconsistent per-procedure authorization | **Critical** | "Centralized authorization layer"; organization-first model |
| 5 | Unrestricted CORS (`cors()` wildcard) | **High** | "Replace unrestricted CORS with environment-specific allowlists" |
| 6 | PHI-at-rest "encryption" is XOR with a repeating key | **High** | "Encryption at rest through approved infrastructure" |
| 7 | Audit log & breach detection are client-side in AsyncStorage | **High** | "Access auditing"; tamper-evident audit trail |
| 8 | `nutrition` router is fully public (unauthenticated) | **High** | "Every protected call derives identity from server context" |
| 9 | PIN hash = fast SHA-256 with a static, source-visible salt | **Medium** | "Password and credential protections" |
| 10 | `app-webhooks` auth = plaintext shared-secret header, secret bundled to client | **Medium** | "Webhook signature validation" |
| 11 | 272 `console.*` statements; several log PHI-adjacent context | **Medium** | "No PHI in general logs"; "review all console logging" |
| 12 | Session token persisted in unencrypted AsyncStorage | **Medium** | "Device-session management"; secure token storage |
| 13 | Signed-URL issuance & record export are `example.com` stubs | **Medium** | "Short-lived signed URLs"; "data-export workflow" |
| 14 | Tests mock Supabase → zero RLS / isolation coverage | **Medium** | "RLS tests, cross-tenant access tests" |

---

## 1. (Critical) Secrets are compiled into the shipped client

In Expo, **any `EXPO_PUBLIC_`-prefixed variable is inlined into the JS bundle**
and ships to every device. The following secrets are referenced with that
prefix:

- `EXPO_PUBLIC_OPENAI_API_KEY` — a raw OpenAI API key (`LabsProvider.tsx`).
  Extractable from the app bundle; usable by anyone to spend against the
  account and to send arbitrary data to OpenAI.
- `EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY` — passed as the gateway `apiKey`.
- `EXPO_PUBLIC_VITAL_API_KEY` — Vital/Junction API key.
- `EXPO_PUBLIC_WEBHOOK_SECRET` — the shared secret used to authenticate to the
  `app-webhooks` endpoint (`lib/webhooks.ts`), so the "secret" guarding that
  endpoint is printed inside the client.

(`EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are *expected*
to be public — the anon key is safe **only if RLS is correct**, which #3 shows
is unverifiable.)

**Also a latent bug:** in `LabsProvider.tsx`,
`const TOOLKIT_URL = process.env.EXPO_PUBLIC_OPENAI_API_KEY` — the gateway base
URL is assigned the OpenAI key value. Whatever this currently does, it
confirms these values are being handled interchangeably in client code.

**Fix direction:** move every third-party call that needs a secret behind the
server (tRPC/Hono or an edge function). The client should hold only the
Supabase URL + anon key. Rotate all four exposed secrets after the proxy
lands, since they must be assumed compromised.

## 2. (Critical) PHI leaves the device straight to OpenAI

`LabsProvider.tsx` uploads lab-report PDFs to `https://api.openai.com/v1/files`
and posts extraction/analysis prompts to `/v1/chat/completions` and
`/v1/responses` **from the client**, authenticated with the bundled key from
#1. Lab reports are PHI. This means:

- PHI is transmitted to a third party with no server-side control,
  minimization, or de-identification.
- There is no Business Associate Agreement boundary enforceable from the
  client, and no record of what was sent.
- It is incompatible with the target requirement that AI services use
  "minimum necessary patient context", record model/prompt versions and input
  references, and process data in-region.

**Fix direction:** all document extraction and AI analysis must run
server-side (the `documentExtractionService` / `labNormalizationService` in
the target spec), behind a provider under BAA, with structured-output
validation and provenance recording.

## 3. (Critical) The database has no source of truth

`supabase/migrations/20260506081122_remote_schema.sql` is **empty (0 bytes)**.
The live schema exists only in the remote project and, for mobile tables, in
the generated `types/database.ts`. The `clinic_*` tables have **no repo
artifact at all**. Therefore:

- **RLS policies cannot be reviewed.** We cannot confirm whether *any* table
  has RLS enabled, or what the policies say. The clinic routers rely entirely
  on RLS for isolation (they run as the caller's token), so this is a
  correctness-and-safety unknown, not a documentation nicety.
- No migration can be written safely until the current remote schema is dumped
  into version control (`supabase db pull`) and reviewed.

**Fix direction (Phase 1, non-destructive):** capture the remote schema into a
baseline migration, generate fresh types, then author RLS explicitly and add
tests. Until then, treat all "RLS protects us" assumptions as unproven.

## 4. (Critical) No tenant model; authorization is per-handler and uneven

There is no `organizations` / `organization_memberships` /
`practitioner_patient_relationships` layer. On the clinic side, isolation is a
mix of (a) RLS (unverifiable, #3) and (b) ad-hoc `clinician_id = ctx.user.id`
filters that are present on some procedures and **absent on others**:

- Filtered by owner: `patients.getTags`, `patients.exportRecord`,
  parts of `labs`/`alerts`.
- **Not** owner-filtered (rely on RLS alone): `patients.getById`,
  `patients.update`, `patients.delete`, `patients.getHealthHistory`,
  `patients.updateHealthHistory`, `patients.getTimeline`. If RLS is missing or
  loose on `clinic_*`, these allow cross-clinician PHI access by row id.

There is no `authenticatedProcedure` / `organizationProcedure` /
`patientAccessProcedure` helper family; each procedure re-implements (or omits)
its own check.

**Fix direction:** the Phase 1 centralized authorization layer + organization
model, with the ownership check enforced in a shared protected-procedure
middleware rather than per-handler.

## 5. (High) Unrestricted CORS

`backend/hono.ts`: `app.use("*", cors())` with no options → reflects any
origin. Combined with bearer-token auth this is not immediately catastrophic,
but it violates the explicit "environment-specific allowlists" requirement and
widens CSRF/abuse surface.

**Fix direction:** configure `cors()` with an env-driven origin allowlist
(mobile app origins + the desktop web app origin per environment).

## 6. (High) PHI-at-rest "encryption" is XOR

`lib/secureStorage.ts` (`secureSetJSON`/`secureGetJSON`, used by most
providers to persist PHI on-device) encrypts with **`xorEncrypt` — a repeating
XOR against a hex key, base64-wrapped** (`ENC_V1:` prefix). XOR with a reused
key is trivially reversible and is not encryption in any compliance sense. The
key itself is generated with `Crypto.getRandomBytes` and stored in
`expo-secure-store` (that part is fine); the cipher is the problem.

**Fix direction:** use real authenticated encryption (device keystore-backed,
e.g. AES-GCM via a vetted native module) or stop persisting PHI on-device and
rely on the server + short-lived cache.

## 7. (High) Audit log and breach detection are on-device only

`lib/auditLog.ts` and `lib/breachDetection.ts` write to **AsyncStorage on the
device**:

- A HIPAA audit trail must be centralized, tamper-resistant, and outside the
  data subject's control. Here it lives on the user's phone, is wiped on
  uninstall/`clearAuditLogs()`, and never reaches a server.
- The integrity "checksum" is `SHA256(fields)` with **no secret key**, so
  anyone who edits an entry can recompute a valid checksum — it detects
  accidental corruption, not tampering.
- Breach detection (rapid-access, bulk-export, failed-auth thresholds) is
  likewise per-device and self-reported.

The target `audit_events` / `access_events` tables (server-side, append-only)
do not exist yet.

**Fix direction:** Phase 1 server-side audit-event foundation; keep the
on-device module only as a secondary UX signal, not the system of record.

## 8. (High) The `nutrition` router is fully public

All `nutrition` procedures are `publicProcedure` — `analyzePhoto`,
`calculateNutrition`, `searchFoods`, `lookupBarcode` accept unauthenticated
calls. They don't touch patient tables today, but they proxy the Passio API
using a server key, so the endpoint is an **open proxy** to a paid API and
any future PHI added here would be unauthenticated.

**Fix direction:** make these `authenticatedProcedure`; add rate limiting.

## 9. (Medium) Weak PIN hashing

`AuthProvider.hashPin` = `SHA256(pin + 'hipaa_salt_v1')`. The salt is static
and printed in source, SHA-256 is a fast hash, and PINs are 4–6 digits — the
entire keyspace is brute-forceable in microseconds if the hash leaks. The PIN
is a local re-auth/lock factor (acceptable role per the prompt), but the hash
should still be slow + per-device-salted.

**Fix direction:** per-device random salt + a slow KDF (scrypt/PBKDF2 with high
iterations), or bind PIN verification to a keystore secret. Confirm the PIN is
**not** treated as a server auth factor (it isn't today — server auth is the
Supabase session — which is correct).

## 10. (Medium) `app-webhooks` uses a bundled plaintext shared secret

`supabase/functions/app-webhooks/index.ts` authenticates inbound events by
comparing the `x-webhook-secret` header to `APP_WEBHOOK_SECRET` (plain
equality, timing-unsafe), and the client sends that header using
`EXPO_PUBLIC_WEBHOOK_SECRET` (#1) — so the secret guarding the endpoint ships
in the app. By contrast, `junction-webhook` does this correctly: server-only
`JUNCTION_WEBHOOK_SIGNING_SECRET`, HMAC-SHA256 over the raw body, 401 on
mismatch.

**Fix direction:** move app-webhook auth to a server-only HMAC over the body
(mirror the Junction pattern); constant-time compare.

## 11. (Medium) Logging volume and PHI-adjacent logs

272 `console.*` statements across 42 files. Most log control-flow, but several
log identifiers/values, e.g. `LabsProvider` logs OpenAI upload responses
(`result.body`), and various handlers log ids/filenames. The Sentry side is
**better than average**: `lib/sentry.ts` has a real `beforeSend` scrubber
(`scrubObject`/`scrubString`) that redacts a denylist of PHI keys
(`email`, `date_of_birth`, `weight`, …) and email/number patterns — a genuine
mitigation. But it is **key-name-based**, so PHI in unlisted keys or free-text
narrative fields can still pass through, and raw `console.*` output on the
server (Fly logs) is not scrubbed at all.

**Fix direction:** replace ad-hoc `console.*` with a logger that is off/minimal
in production and never receives PHI; extend the Sentry denylist and add
free-text handling; keep request bodies out of logs.

## 12. (Medium) Session token in plaintext AsyncStorage

`lib/supabase.ts` configures the client with `storage: AsyncStorage` and
`persistSession: true`. AsyncStorage is unencrypted; a compromised/rooted
device or a backup can expose the refresh/access token.

**Fix direction:** back the Supabase session with an `expo-secure-store`-backed
storage adapter.

## 13. (Medium) File signed-URLs and export are stubs

`labs.getDownloadUrl` returns `https://example.com/signed/<path>?token=xxx`
and `patients.exportRecord` returns `https://example.com/exports/pending`.
Secure file access and the data-export workflow are effectively unimplemented.

**Fix direction:** issue real Supabase Storage signed URLs with short TTL
(15 min per the arch doc), private buckets, and audit each access; build the
export workflow as a background job.

## 14. (Medium) No isolation test coverage

`__tests__/clinic/*` mock the Supabase client, so RLS/tenant isolation is
never exercised, and there are no cross-tenant negative tests. `nutrition`,
`supplements`, edge functions, and providers are untested.

**Fix direction:** add integration tests against a real (ephemeral) Postgres
with RLS enabled, including cross-tenant access-denied assertions, as required
by the prompt.

---

## Recommended Phase 1 order (security-first, matches the prompt)

1. **Capture the schema** (`supabase db pull`) into a reviewed baseline
   migration; regenerate types. *(Unblocks everything; non-destructive.)*
2. **Server-side secret proxy**: move OpenAI/toolkit/Vital calls behind the
   backend; strip secrets from the client; rotate the four exposed secrets.
3. **Centralized authorization + organization model**: shared protected
   procedures; `organizations`/memberships/patient-access; enforce ownership in
   middleware, not per-handler.
4. **RLS on every tenant/patient table** + cross-tenant access tests.
5. **Audit-event foundation** (server-side, append-only).
6. **CORS allowlist** + **logging hardening** (no PHI, production-quiet).
7. Replace XOR storage cipher; secure the session token; fix PIN KDF;
   HMAC the app-webhook.

Items 1–6 are exactly the prompt's Phase 1; item 7 can interleave. **No
clinical-reasoning work should start until 1–5 are done and verified.**
