# Desktop Platform Roadmap — Phase 0 Output

> **Status:** Phase 0 planning output. This maps the current repository (see
> [`current-architecture.md`](./current-architecture.md)) onto the platform
> evolution described in the backend prompt + enhancement addendum, and fixes
> the order of work. It does **not** authorize any implementation; it defines
> the first safe slice and its gate.

## Guiding constraints (from the prompt, unchanged)

- Do **not** rewrite from scratch; do **not** remove working mobile features;
  do **not** create a second isolated backend.
- Preserve the core stack (all confirmed present in Phase 0).
- RLS on every tenant/patient table; deterministic safety outside the LLM;
  no PHI in logs; secrets never on the client.
- Feature-flag everything unfinished. Do not fabricate tests or integrations.
- **Do not begin the clinical reasoning engine until patient ownership, tenant
  isolation, and audit controls are established and verified.**

## The desktop practitioner web app

A **separate Next.js App Router** app (the target desktop UI) will consume the
**same** Hono/tRPC backend and shared domain schemas as the Expo app — no
duplicated API schemas. A Phase-1 front end for it already exists in the
companion repo `HolisticDrBright/AI_DESKTOP_PRO` (shell, patient overview,
practice dashboard, command palette, assistant drawer) built against typed
mock adapters that are shaped to become tRPC calls. That app is the desktop
client; **this** repo owns the backend, database, and shared packages it will
call. The two connect only once the backend Phase 1 below is real.

## Where the repo stands vs. the target

| Target capability | Today | Gap size |
| --- | --- | --- |
| Core stack (Expo/Hono/tRPC/Supabase/…) | present | none |
| Wearable ingestion pipeline | working (webhook→raw→rollup) | small (generalize provenance) |
| Clinic CRUD surface | working, uneven auth | medium |
| Versioned migrations + RLS | **absent** (empty migration) | **large** |
| Multi-tenant org model | **absent** | **large** |
| Centralized authorization | **absent** (per-handler) | large |
| Server-side audit events | **absent** (client-only) | large |
| Secret handling / AI behind server | **client-side** | large |
| Clinical reasoning / health twin / experiments / supplement intelligence | absent | very large (later phases) |

## Sequenced plan

### Phase 1 — Foundation (security & tenancy). *Gate for everything else.*
Matches the prompt's Phase 1 exactly. Non-negotiable, and mostly
non-destructive.

1. **Schema capture** — `supabase db pull` → committed baseline migration;
   regenerate types; record RLS status (`pg_policies`) in
   `database-inventory.md`. *(Unblocks all DB work.)*
2. **Centralized authenticated tRPC context** — `authenticatedProcedure`,
   `organizationProcedure`, `practitionerProcedure`, `patientAccessProcedure`,
   `adminProcedure`; derive identity/authorization from server context only;
   replace per-handler `clinician_id` checks.
3. **Organization & membership model** — `organizations`,
   `organization_memberships`, `roles`, `practitioner_patient_relationships`,
   `invitations`; backfill existing clinic rows under a default org.
4. **Patient-access authorization** — enforce practitioner⇆patient access in
   middleware; add **cross-tenant access-denied tests** against a real
   ephemeral Postgres with RLS on.
5. **Audit-event foundation** — server-side append-only `audit_events` /
   `access_events`; write from the protected procedures.
6. **Secure storage review + secret proxy** — move OpenAI/toolkit/Vital calls
   behind the server; strip `EXPO_PUBLIC_*` secrets; rotate the four exposed
   ones; issue real short-TTL signed URLs from private buckets.
7. **CORS + logging hardening** — env-driven origin allowlist; production-quiet
   logger; no request bodies / PHI in logs; extend Sentry scrubber.

**Exit criteria:** schema in VCS; every clinic/patient table has reviewed RLS;
cross-tenant tests pass; no secret ships in the client; audit events recorded;
typecheck/lint/test/build green.

### Phase 2 — Desktop shell & clinic ops parity
Desktop app wired to real tRPC (client directory, patient context, tasks,
review queue, appointments, assessments). Plus the addendum's early ops:
minimal Billing slice (Stripe **connector**, invoices/payments/packages) and
the **connector-framework skeleton** (ALP mobile two-way loop, Fullscript, one
lab, Vital, telehealth provider), each behind a feature flag with RLS +
cross-tenant + audit tests before UI. *(Rationale from the addendum: without
ops parity + the data pipe, the practice never becomes system-of-record.)*

### Phase 3 — Labs & provenance
Lab ingestion, biomarker normalization/dictionary, lab review queue,
longitudinal timeline, provenance; broaden specialty-lab coverage. Fold the
mobile `lab_markers`/`lab_panels` and clinic `clinic_lab_*` tables into one
normalized model.

### Phase 4–6 — Intelligence (the differentiator; protect its depth)
Clinical facts → hypotheses → evidence → contradictions → reasoning snapshots →
Adaptive Health Twin; Supplement Intelligence Network; N-of-1 experiments. Add
the outcomes registry + `populationAnalyticsService` (addendum §C) in 4/5.
**Blocked on Phase 1 exit.**

### Phase 7 — Programs, automations, reporting, Quantum Mind
Program Builder; deterministic/versioned/audited automations engine;
reporting; Quantum Mind. Migration importers (Practice Better / Biocanic /
Jane) may land any time after Phase 2 as an adoption lever.

## First recommended implementation slice (post-audit)

Per the prompt's "INITIAL EXECUTION": **Phase 1, steps 1–2** as the first PR —
(a) capture the live schema into a baseline migration + regenerated types
(non-destructive), and (b) introduce the centralized authenticated tRPC
procedures and convert the `clinic` router to them **without behavior change**,
adding the first cross-tenant access test. This is the smallest coherent slice
that starts closing the Critical findings without touching production data.

Everything in Phases 2+ stays **feature-flagged and unbuilt** until the Phase 1
gate is verified.
