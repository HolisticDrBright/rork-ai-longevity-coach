# Patient sync bridge (`patient-sync/1`) — AI Longevity Pro side

Phase 6B, staging-only. **AI Longevity Pro is not yet connected to any
practitioner desktop in a deployed environment**: this repository contains
the receiver, its storage, the patient surface, and deterministic proof
against the AI Desktop Pro contract — the real staging round trip is an
operator step gated below. No production activation, no real patient data,
and no HIPAA/compliance claims are made anywhere in this feature.

## Architecture and trust boundaries

```
AI Desktop Pro (practitioner)                AI Longevity Pro (patient)
┌─────────────────────────────┐              ┌────────────────────────────┐
│ Postgres (state authority)  │              │ Hono backend (Fly.io)      │
│  └ sync worker (service     │  signed      │  └ POST /patient-sync/v1/  │
│     role, separate process) ├─────────────▶│      envelopes  (receiver) │
│     ├ POST  ◀───────────────┤  signed      │  └ outbox dispatcher       │
│     │  /sync/callback       │◀─────────────┤     (acks, adherence,      │
│     │  /sync/verify         │              │      consent changes)      │
│     └ callback secret set   │              │  └ Supabase (RLS; patient  │
│                             │              │     reads own rows only)   │
└─────────────────────────────┘              └────────────────────────────┘
```

- Every hop is an HMAC-SHA256 signature over `v1:<timestamp>:<nonce>:` +
  the RAW bytes, key-id addressed, constant-time compared, timestamp
  windowed (±5 min), with a durable per-key nonce ledger. Signatures are
  verified **before any parsing**.
- The mobile app never holds bridge secrets (nothing is `EXPO_PUBLIC_*`)
  and never writes sync tables directly: it reads its own connection's
  rows through RLS and acts through authenticated tRPC procedures.
- The contract of record is AI Desktop Pro's `patient-sync/1`
  (`src/adapters/live-types.ts` + `docs/clinical-runtime-migration.md`
  there). `backend/sync/contract.ts` mirrors it key-for-key; the parity
  tests in `__tests__/sync/contract.test.ts` fail on any drift. The wire
  version identifier is the string `"patient-sync/1"` in both directions.

## Identity and consent flow

1. The practitioner creates an invitation on the desktop; the patient
   receives a **one-time 64-hex code** in person.
2. The patient enters the code in AI Longevity Pro (Profile → Practitioner
   Desktop Sync). The backend presents it to the desktop's signed
   `/sync/verify` boundary together with the patient's **opaque auth user
   id** as the external subject. Linking is NEVER by email, name, phone,
   date of birth, or fuzzy matching, and the desktop's response never
   includes its internal patient id.
3. Consent lives on the desktop in 11 independent scopes; the desktop
   re-checks it at delivery time. On this side, a delivery for a revoked
   connection is refused 403 `connection_revoked` — immediately.
4. Disconnecting here (reason required) stops both directions at once;
   previously received envelopes remain (append-only history), and
   records the practitioner already holds are not deleted by revocation.

## What syncs (initial resources)

Desktop → patient: `program_enrollment`, `protocol_version`,
`supplement_instructions`, `nutrition_plan`, `appointment_summary`,
`message`, `checkin_assignment`, `lab_summary`, `resource_withdrawal`
(tombstone). Payloads are server-built minimum-necessary projections with
sha256 hashes; provenance carries the practitioner-review state, which the
patient UI displays verbatim — nothing is shown as practitioner-approved
unless the signed source resource says so. Raw internal reasoning,
unsigned notes, unreviewed AI output, and affiliate metadata are not in
the contract and are refused as unknown resource types.

Patient → desktop: acknowledgments (delivery evidence keyed to the
envelope `eventUid`), and `protocol_adherence`, `supplement_adherence`,
`checkin_response`, `symptom_report`, `outcome_report`, `consent_change`
— all through the durable outbox, all reviewed on the desktop side
(review/conflict workflow), never silently merged into the chart.

## Enablement (provider registry, not a flag)

The receiver mounts ONLY when `PATIENT_SYNC_ENABLED=true` **and** the
complete secret set exists; anything less leaves the bridge disabled with
a logged reason and the routes absent. The desktop side independently
requires its reviewed provider registry entry (the `alp_patient_sync`
connector row) plus its own complete `SYNC_ALP_*` configuration before it
sends anything. No single environment variable on either side can turn
the bridge on.

Environment variables (names only; values are Fly/Railway secrets):

| Variable | Purpose |
| --- | --- |
| `PATIENT_SYNC_ENABLED` | mount the receiver at all |
| `PATIENT_SYNC_INBOUND_SECRET` / `PATIENT_SYNC_INBOUND_KEY_ID` | verify envelopes FROM the desktop |
| `PATIENT_SYNC_OUTBOUND_URL` / `PATIENT_SYNC_OUTBOUND_SECRET` / `PATIENT_SYNC_OUTBOUND_KEY_ID` | sign callbacks TO the desktop worker |
| `SYNC_SUPABASE_SERVICE_ROLE_KEY` | receiver storage writes (server process only) |

**Key rotation:** every signature carries a key id. Rotate by adding the
new secret under a new key id on the receiving side first, switching the
sending side, then retiring the old id. Both directions support this
independently.

## Database

Migration `supabase/migrations/20260730231500_patient_sync_receiver.sql`
adds `patient_sync_connections`, `patient_sync_envelopes` (immutable),
`patient_sync_resources`, `patient_sync_nonces` (deny-all),
`patient_sync_outbox` (deny-all), `patient_sync_events` — RLS on
everything, patients read only their own connection's rows, no direct
client writes.

**Apply status: NOT applied.** The AI Longevity Pro Supabase project is
configured only through protected environment variables and is not
reachable from the automation credentials that authored this branch (the
accessible Supabase organization contains no ALP project). Applying this
migration to the ALP staging project is a deliberate operator step and
the first item of the staging acceptance gate below. Until then the
backend falls back to in-memory storage in local/dev processes only.

## Operations

- **Retry/dead-letter:** the desktop owns outbound retry policy (bounded
  backoff, 8-attempt dead-letter, reasoned manual retry). This side's
  outbox keeps queued rows through restarts; an unreachable desktop
  leaves work queued, a desktop `409 replay` answer counts as landed, and
  refusals record a safe error string only.
- **Reconciliation:** compare desktop `sync_delivery_events` (dedup key
  `(connection, provider_event_id)`) with `patient_sync_envelopes.receipt_ids`
  here; receipts are deterministic per `eventUid`, so both sides converge
  on redelivery.
- **Logs:** allowlisted event names + codes only. No payloads, tokens,
  secrets, or PHI. `sync_refused`, `sync_replay_refused`,
  `sync_contract_refused`, `sync_connection_refused`,
  `sync_envelope_received`, `sync_outbox_*`.

## Deployment order and rollback

1. Review + merge the receiver PR (this repository) — deploy to STAGING
   Fly app only; 2. apply the migration to the ALP staging Supabase
   project; 3. set the receiver secrets; 4. review + merge the desktop
   adapter PR; 5. set the desktop worker's `SYNC_ALP_*` staging secrets;
   6. register the `alp_patient_sync` connector for the staging desktop
   organization; 7. run the synthetic staging round trip (below).
   **Rollback:** remove the connector row (desktop stops sending), then
   unset `PATIENT_SYNC_ENABLED` (receiver unmounts). Nothing received is
   deleted; the bridge simply stops. Order matters: sender first.

## Synthetic staging acceptance gate

The bridge may not be called "connected" until, in STAGING with synthetic
patients only: invitation → code entry → verified connection; a
practitioner-shared protocol delivered with receipts; patient
acknowledgment landing as desktop evidence; adherence landing in the
desktop review queue; a withdrawal tombstoning here; a patient-side
revocation refusing the next delivery; and the desktop dead-letter path
exercised — all through the deployed signed endpoints. The deterministic
equivalent of this gate already runs in CI-able form (the receiver suite
here + the cross-repo round trip in the desktop repository), but that is
NOT the staging run.

## Production-readiness gaps (beyond staging)

Operator-owned: production secret provisioning + rotation schedule,
Fly/Supabase production topology review, rate limiting at the edge,
monitoring/alerting on refusal rates and outbox depth, data-retention
policy for received envelopes, legal/compliance review (no claims are
made in this codebase), and load validation of the nonce ledger prune.
