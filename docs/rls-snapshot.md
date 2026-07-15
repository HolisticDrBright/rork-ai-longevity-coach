# Live RLS & Security Snapshot — Dr. Bright's Project (`utuszztwwadvoxxuyshn`)

> **Captured:** Phase 0, directly from the live database via the Supabase MCP
> (read-only introspection: `pg_policies`, `pg_class.relrowsecurity`,
> `pg_get_functiondef`, and the Supabase security advisor). This is the
> **ground truth** that the empty committed migration could not provide, and it
> **corrects** the "RLS status: unknown" placeholders in
> [`database-inventory.md`](./database-inventory.md) and the severity of
> findings #3–#4 in [`security-gap-analysis.md`](./security-gap-analysis.md).
> No data was read or modified — schema/catalog only.

## Headline

**RLS is enabled on every application table, and the health-domain policies are
correctly scoped.** The audit's worst-case assumption (RLS possibly missing on
`clinic_*`) was wrong — it was a limitation of auditing from a repo whose schema
migration is empty, not a real gap. Two *new* findings replace it: (1) a
**shared, multi-product database** holding PHI alongside ~200 unrelated tables,
and (2) the schema/policies still **aren't in version control**.

## Health-domain RLS policies (verbatim, live)

### Clinic domain — per-clinician isolation via `clinician_id = auth.uid()`
Every `clinic_*` patient/data table has a single `ALL` policy:

| Table | Policy (`cmd`, `USING`) |
| --- | --- |
| `clinic_patients` | ALL · `clinician_id = auth.uid()` |
| `clinic_health_histories` | ALL · `clinician_id = auth.uid()` |
| `clinic_lab_documents` | ALL · `clinician_id = auth.uid()` |
| `clinic_lab_results` | ALL · `clinician_id = auth.uid()` |
| `clinic_biometric_readings` | ALL · `clinician_id = auth.uid()` |
| `clinic_patient_thresholds` | ALL · `clinician_id = auth.uid()` |
| `clinic_alert_events` | ALL · `clinician_id = auth.uid()` |
| `clinic_alert_rules` | ALL · `clinician_id = auth.uid()` |
| `clinic_lab_tests` (catalog) | `is_admin()` manage · authenticated read |
| `clinic_biometric_types` (catalog) | `is_admin()` manage · authenticated read |

For an `ALL` policy with a null `WITH CHECK`, Postgres reuses the `USING`
expression as the write check — so inserts/updates are also constrained to
`clinician_id = auth.uid()`. This **matches** the app-layer `assertPatientAccess`
guard added on the `claude/phase1-auth-centralization` branch: the two are
consistent, giving defense-in-depth (RLS in the DB + ownership check in tRPC).

### Consumer/mobile domain — per-user isolation via `user_id = auth.uid()`
`lab_markers`, `lab_panels`, `hormone_entries`, `raw_health_events`,
`daily_biometric_records` (and siblings) each expose own-data CRUD:
`INSERT/UPDATE/DELETE` require `user_id = auth.uid()`; `SELECT` allows
`user_id = auth.uid() OR is_admin()`.

### A practitioner⇆patient model already exists
- `profiles`: owner-scoped (`auth.uid() = id`) **plus** `Practitioners can view
  assigned patients` = `is_practitioner() AND is_assigned_patient(auth.uid(), id)`.
- `practitioner_flags`: own-data + `is_practitioner() AND is_assigned_patient(...)`.
- `practitioner_patient_assignments`: `is_admin()` manages; practitioner or
  patient can view their own rows.
- `user_roles`: `is_admin()` manages; users read their own.
- `user_consents`, `account_deletion_requests`: owner-scoped.
- `audit_logs`: **server-side table** — `service_role` manages all; users
  insert/read their own. (Distinct from the on-device AsyncStorage audit log
  in `lib/auditLog.ts`.)

### Authorization helper functions (SECURITY DEFINER, pinned search_path)
```sql
is_admin()        := has_role(auth.uid(), 'admin')
is_practitioner() := has_role(auth.uid(), 'practitioner')
is_assigned_patient(practitioner, patient) :=
  EXISTS (SELECT 1 FROM practitioner_patient_assignments
          WHERE practitioner_id = practitioner AND patient_id = patient
            AND status = 'active')
```

## Supabase security advisor (live)

| Level | Finding | Note |
| --- | --- | --- |
| INFO | `usage_counters` RLS-enabled-no-policy | Deny-all (locked); harmless |
| WARN | `function_search_path_mutable` × 3 (`scr_touch_updated_at`, `lab_analysis_jobs_touch_updated_at`, `set_updated_at`) | Set `search_path = ''` on these trigger fns |
| WARN | `auth_leaked_password_protection` disabled | Enable HaveIBeenPwned check in Auth settings |

No exposed-table, SECURITY DEFINER view, or missing-RLS **errors**. For a
production PHI database this posture is solid.

## Two architectural facts that matter more than the RLS

1. **Shared, multi-product database.** `utuszztwwadvoxxuyshn` holds ~230 public
   tables. The longevity app is a *minority* of them; the rest belong to
   unrelated products — crypto/quant trading (`paper_trades`,
   `polymarket_engine_fills`, `stoikov_orders`, `kelly_sizing`,
   `tax_loss_ledger`, `orderbook_snapshots`, …), marketing/SEO (`mc_outreach_*`,
   `seo_sites`), astrology/tarot (`tarot_readings`, `birth_profiles`,
   `compatibility_reports`), plant care, personal finance, and more. Clinical
   PHI is co-resident with all of it in one Postgres instance and one Supabase
   project. For a HIPAA-aiming clinical platform this is a real blast-radius,
   access-scoping, backup/DR, and BAA-boundary concern. See the decision in
   [`desktop-platform-roadmap.md`](./desktop-platform-roadmap.md).
2. **Still not in version control.** The remote migration history has 8 entries
   (`20260506081122`, `20260513000000`–`000005`, `20260702123703`) but the repo
   committed only the first — and it is empty. RLS, policies, functions, and
   the tables above exist only in the live project. The baseline must be
   captured before any forward migration (ADR-0002 stands).

## What this changes in the audit

- **`security-gap-analysis.md` #3 (RLS not in VCS):** the *version-control* half
  stands (nothing is committed); the *"isolation unverifiable / possibly
  missing"* half is **resolved** — RLS is present and correct in the live DB.
- **`security-gap-analysis.md` #4 (no tenant model / uneven authz):** the DB
  **does** enforce tenant isolation via RLS, and a role + practitioner-assignment
  model exists. The app-layer unevenness was real but RLS backstops it; the
  `claude/phase1-auth-centralization` slice makes the app layer consistent too.
- **`database-inventory.md`:** many entities marked "absent" (roles,
  practitioner⇆patient, consents, server audit log, account-deletion) actually
  **exist** in the live DB; they were invisible from the repo alone.
- **New top concern:** the shared multi-product database (fact #1 above).
