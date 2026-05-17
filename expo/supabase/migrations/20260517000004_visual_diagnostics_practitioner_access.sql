-- ============================================================
-- Visual Diagnostics — practitioner access + auth-user linkage
--
-- Fills gaps surfaced when verifying the SQL contract against the
-- application code:
--
--   A. clinic_patients has no column linking it to auth.users — but
--      the visual diagnostics flow is patient-initiated (auth user),
--      and clinic_alert_events.patient_id references clinic_patients.id.
--      Adds clinic_patients.linked_auth_user_id (FK + unique index) so
--      the correlator can resolve auth_user → patient_id → clinician_id.
--
--   B. visual_* tables had owner-only RLS, which made the practitioner
--      review queue return zero rows (the queue endpoint uses the
--      clinician's own JWT, so RLS filters to only that clinician's
--      own visual_sessions). Adds clinician-scope SELECT + UPDATE
--      policies on visual_sessions, visual_findings,
--      visual_session_images, visual_convergent_findings,
--      visual_divergent_findings, visual_red_flag_alerts,
--      recommendation_renders.
--
--   C. Refines the profiles.role CHECK constraint drop from
--      20260517000002 — that one matched any constraint with "role" in
--      its definition (would have swept up notify_roles checks etc.).
--      This migration finds and drops only the constraint that
--      actually references the role column directly.
-- ============================================================

-- ─── A. clinic_patients.linked_auth_user_id ─────────────────
-- We tolerate clinic_patients not existing locally (it lives in the
-- remote schema that isn't checked in). When the table is present,
-- add a nullable FK column + unique index. Nullable because legacy
-- patient charts may not have a linked app user.
do $$
begin
  alter table public.clinic_patients
    add column if not exists linked_auth_user_id uuid null references auth.users(id) on delete set null;
exception when undefined_table then
  raise notice 'clinic_patients does not exist locally — skipping linked_auth_user_id column';
end $$;

do $$
begin
  create unique index if not exists clinic_patients_linked_auth_user_id_key
    on public.clinic_patients(linked_auth_user_id)
    where linked_auth_user_id is not null;
exception when undefined_table then null;
end $$;

-- ─── B. Clinician cross-user RLS on visual_* tables ─────────
-- All policies check that the caller's profiles.role is one of
-- {clinician, staff, admin}. This requires profiles to be readable
-- under the caller's own JWT, which is the standard pattern (self-read
-- via auth.uid() = id) — every existing app screen relies on it.

create or replace function public.is_clinic_role() returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select role in ('clinician', 'staff', 'admin') from public.profiles where id = auth.uid()),
    false
  );
$$;

comment on function public.is_clinic_role() is
  'Returns true when the current authenticated user has a clinic-side role. SECURITY DEFINER so RLS on profiles cannot block the role lookup itself.';

grant execute on function public.is_clinic_role() to authenticated;

-- visual_sessions: clinician SELECT + UPDATE (sign-off)
drop policy if exists "visual_sessions_clinician_select" on public.visual_sessions;
create policy "visual_sessions_clinician_select"
  on public.visual_sessions for select
  to authenticated
  using (public.is_clinic_role());

drop policy if exists "visual_sessions_clinician_update" on public.visual_sessions;
create policy "visual_sessions_clinician_update"
  on public.visual_sessions for update
  to authenticated
  using (public.is_clinic_role())
  with check (public.is_clinic_role());

-- visual_findings: clinician SELECT
drop policy if exists "visual_findings_clinician_select" on public.visual_findings;
create policy "visual_findings_clinician_select"
  on public.visual_findings for select
  to authenticated
  using (public.is_clinic_role());

-- visual_session_images: clinician SELECT (for the image strip)
do $$
begin
  drop policy if exists "visual_session_images_clinician_select" on public.visual_session_images;
  create policy "visual_session_images_clinician_select"
    on public.visual_session_images for select
    to authenticated
    using (public.is_clinic_role());
end $$;

-- visual_convergent_findings: clinician SELECT
do $$
begin
  drop policy if exists "visual_convergent_findings_clinician_select" on public.visual_convergent_findings;
  create policy "visual_convergent_findings_clinician_select"
    on public.visual_convergent_findings for select
    to authenticated
    using (public.is_clinic_role());
end $$;

-- visual_divergent_findings: clinician SELECT
do $$
begin
  drop policy if exists "visual_divergent_findings_clinician_select" on public.visual_divergent_findings;
  create policy "visual_divergent_findings_clinician_select"
    on public.visual_divergent_findings for select
    to authenticated
    using (public.is_clinic_role());
end $$;

-- visual_red_flag_alerts: clinician SELECT + UPDATE (ack)
drop policy if exists "visual_red_flag_alerts_clinician_select" on public.visual_red_flag_alerts;
create policy "visual_red_flag_alerts_clinician_select"
  on public.visual_red_flag_alerts for select
  to authenticated
  using (public.is_clinic_role());

drop policy if exists "visual_red_flag_alerts_clinician_update" on public.visual_red_flag_alerts;
create policy "visual_red_flag_alerts_clinician_update"
  on public.visual_red_flag_alerts for update
  to authenticated
  using (public.is_clinic_role())
  with check (public.is_clinic_role());

-- recommendation_renders: clinician SELECT (for "Why this product?" drill-down)
do $$
begin
  drop policy if exists "recommendation_renders_clinician_select" on public.recommendation_renders;
  create policy "recommendation_renders_clinician_select"
    on public.recommendation_renders for select
    to authenticated
    using (public.is_clinic_role());
end $$;

-- Storage objects in the visual-diagnostics bucket — clinicians need
-- to be able to mint signed URLs for source images. We can't easily
-- DROP/CREATE storage.objects policies idempotently across deploys, so
-- this block is defensive.
do $$
begin
  drop policy if exists "visual_diagnostics_storage_clinician_read" on storage.objects;
  create policy "visual_diagnostics_storage_clinician_read"
    on storage.objects for select
    to authenticated
    using (bucket_id = 'visual-diagnostics' and public.is_clinic_role());
exception when undefined_table then null;
end $$;

-- ─── C. Tighten profiles.role constraint cleanup ────────────
-- The 20260517000002 migration matched constraints with "role" in their
-- definition, which would have caught unrelated constraints like
-- notify_roles checks. We re-run a narrower check that only matches the
-- specific column-level CHECK we added.
do $$
declare
  con_name text;
begin
  -- Match constraints that reference the profiles.role column specifically
  -- (not arrays-of-roles or substring matches on other columns).
  select conname into con_name
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where c.conrelid = 'public.profiles'::regclass
    and c.contype = 'c'
    and a.attname = 'role'
    and conname <> 'profiles_role_check'
  limit 1;
  if con_name is not null then
    execute format('alter table public.profiles drop constraint %I', con_name);
    raise notice 'Dropped extra profiles.role check constraint: %', con_name;
  end if;
exception when undefined_table then null;
end $$;
