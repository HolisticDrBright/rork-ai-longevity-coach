-- ============================================================
-- Visual Diagnostics — schema fixes from end-to-end bug audit
--
-- Addresses bugs #3, #4, #6, #10, #14 from the audit:
--   #3  clinic_alert_events accepts 'visual_diagnostics' category
--       (previously only lab/biometric/upload/adherence/symptom).
--   #4  profiles.role + visual_sessions.signed_off_by/at for
--       practitioner gating + sign-off provenance.
--   #6  bare-column UNIQUE constraints so PostgREST upserts work
--       (approved_brands.brand_name, recommendation_categories.category_name,
--       recommendation_rules.finding_tag).
--   #10 the new UNIQUE on recommendation_rules.finding_tag also makes
--       ON CONFLICT DO NOTHING actually fire on re-runs of the seed.
--   #14 visual_sessions gets a separate reviewer_notes column so
--       practitioner sign-off no longer overwrites patient/system notes.
-- ============================================================

-- ─── #3 clinic_alert_events: nothing to alter ───────────────
-- Earlier draft of this migration tried to extend a `category` enum
-- on clinic_alert_events. Verifying against the actual schema (see
-- mapDbToAlertEvent in backend/trpc/routes/clinic/utils.ts) the events
-- table has NO `category` column — `category` lives on
-- clinic_alert_rules and is joined in via rule_id. The correlator's
-- insert was updated to drop both the `category` and `clinician_id`
-- fields it was erroneously setting. trigger_data.source carries the
-- 'visual_diagnostics' classification instead. No DDL needed here.

-- ─── #4 profiles.role for clinician gating ──────────────────
-- The profiles table is created by an earlier migration not in this
-- branch. ADD COLUMN IF NOT EXISTS is idempotent.
--
-- NOTE: no CHECK constraint on the values. Real deploys have
-- legacy/imported rows with role values outside any canonical enum,
-- and clinicianProcedure already string-matches exactly ('clinician',
-- 'staff', 'admin') so non-conforming values fail closed without a
-- constraint. Adding one here would fail on any row outside the
-- canonical set.
do $$
begin
  alter table public.profiles
    add column if not exists role text not null default 'patient';
exception when undefined_table then
  raise notice 'profiles table does not exist locally — skipping role column';
end $$;

create index if not exists profiles_role_idx on public.profiles(role);

-- ─── #4 visual_sessions sign-off provenance ─────────────────
alter table public.visual_sessions
  add column if not exists signed_off_by uuid null references auth.users(id) on delete set null,
  add column if not exists signed_off_at timestamptz null,
  add column if not exists reviewer_notes text null;

-- ─── #6 + #10 bare-column UNIQUE constraints for upserts ────
-- PostgREST onConflict requires UNIQUE on the bare column, not on an
-- expression index. The existing lower(...) expression indexes still
-- protect against case-only duplicates; these add the column-level
-- constraint that lets `.upsert({ onConflict: 'col' })` actually work.
do $$
begin
  alter table public.approved_brands add constraint approved_brands_brand_name_key unique (brand_name);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.recommendation_categories add constraint recommendation_categories_category_name_key unique (category_name);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.recommendation_rules add constraint recommendation_rules_finding_tag_key unique (finding_tag);
exception when duplicate_object then null;
end $$;

-- Note: the (brand_id, lower(product_name)) unique index is already
-- expression-based and cannot be replaced by a UNIQUE constraint
-- without losing case-insensitive dedupe. The ingestion script is
-- updated to delete-then-insert for products instead of using
-- onConflict on the expression.
