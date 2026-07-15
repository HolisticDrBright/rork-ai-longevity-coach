# 2. Capture the live schema before writing any migrations

Date: 2026-07-15
Status: Proposed

## Context

The only committed migration,
`expo/supabase/migrations/20260506081122_remote_schema.sql`, is **empty (0
bytes)**. The live schema exists only in the remote Supabase project
(`utuszztwwadvoxxuyshn`). Mobile tables appear in a generated
`types/database.ts`; the `clinic_*` tables appear **nowhere** in the repo; the
`webhook_events` table is referenced by an edge function but absent from the
generated types (so the types are also stale).

Because the clinic tRPC procedures run as the caller's token and rely on
Postgres **RLS** for isolation, and no RLS policy is visible in the repo, we
currently **cannot verify tenant isolation at all**. Writing new migrations on
top of an unknown schema risks drift, accidental policy changes, and
destructive conflicts — all explicitly forbidden by the platform prompt
("do not silently change production schemas", "do not perform destructive
database migrations during the audit").

## Decision

Before authoring any new migration or RLS policy, we will **dump the current
remote schema into version control** as a reviewed baseline:

1. `supabase db pull` → a baseline migration replacing the empty file.
2. `supabase gen types typescript` → refresh `types/database.ts`.
3. Query `pg_policies` / `pg_tables.rowsecurity` and record, per table, whether
   RLS is enabled and what each policy says, in `docs/database-inventory.md`.

This is read-only against production and non-destructive. Only after the
baseline + RLS snapshot are reviewed do we write forward migrations.

## Consequences

- The database gains a reproducible, reviewable source of truth; RLS becomes
  auditable and testable.
- Regenerated types will likely reveal `clinic_*` and `webhook_events` columns
  the code currently accesses via `as` casts, improving type safety.
- Short-term cost: a review pass over a possibly large generated migration, and
  reconciling the misnamed tables in `CLINIC_BACKEND_ARCHITECTURE.md`.
- Risk if skipped: new migrations silently diverge from production and RLS gaps
  stay invisible — the highest-impact risk found in Phase 0.
