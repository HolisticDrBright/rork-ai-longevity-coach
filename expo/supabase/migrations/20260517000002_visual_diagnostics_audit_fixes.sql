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

-- ─── #3 clinic_alert_events category enum ───────────────────
-- The table is defined elsewhere with a CHECK constraint we need
-- to relax. We DROP-and-recreate the constraint with the added
-- 'visual_diagnostics' value. The constraint name is best-guess;
-- if it differs in prod we'll need a follow-up.
do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.clinic_alert_events'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%category%';
  if con_name is not null then
    execute format('alter table public.clinic_alert_events drop constraint %I', con_name);
  end if;
exception when undefined_table then
  raise notice 'clinic_alert_events does not exist locally — skipping category enum fix';
end $$;

do $$
begin
  alter table public.clinic_alert_events
    add constraint clinic_alert_events_category_check
    check (category in ('lab', 'biometric', 'upload', 'adherence', 'symptom', 'visual_diagnostics'));
exception
  when undefined_table then null;
  when duplicate_object then null;
end $$;

-- ─── #4 profiles.role for clinician gating ──────────────────
-- The profiles table is created by an earlier migration not in this
-- branch. ADD COLUMN IF NOT EXISTS is idempotent.
do $$
begin
  alter table public.profiles
    add column if not exists role text not null default 'patient';
exception when undefined_table then
  raise notice 'profiles table does not exist locally — skipping role column';
end $$;

do $$
declare
  con_name text;
begin
  -- Drop any existing role check and recreate with the canonical values
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.profiles'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%role%';
  if con_name is not null then
    execute format('alter table public.profiles drop constraint %I', con_name);
  end if;
  alter table public.profiles
    add constraint profiles_role_check
    check (role in ('patient', 'clinician', 'staff', 'admin'));
exception when undefined_table then null;
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
