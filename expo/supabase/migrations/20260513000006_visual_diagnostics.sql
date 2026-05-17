-- Visual Diagnostics Module — migration 011 (renumbered to the repo's
-- existing date-prefix convention).
--
-- See dev brief Addendum #2 + the four-part build prompt for design context.
-- This migration creates:
--   1. User-scoped tables (sessions, images, findings, convergent /
--      divergent findings, red-flag alerts, recommendation_renders) with
--      RLS = auth.uid() = user_id.
--   2. Reference / formulary tables (approved_brands, approved_products,
--      recommendation_categories, recommendation_rules, product_sources)
--      with RLS read-all-authenticated, write-service-role.
--   3. Integration lookup tables (ifm_node_visual_tag_weights,
--      zang_fu_visual_tag_map, cross_modality_contradiction_pairs,
--      cross_modality_tag_taxonomy, visual_health_index_modality_weights)
--      with the seeded data from Dr. Bright's part-4 review.
--   4. Admin tables (product_db_change_requests).
--   5. user_consents (cross-cutting consent versioning, replaces
--      client-only HIPAAProvider local storage for server-side persistence).
--   6. Storage bucket `visual-diagnostics-{env}` with per-user path-prefix RLS.
--
-- Note on Phase 2 deferrals: the visual data foundation lands here in
-- full. The downstream consumers (Pattern Discovery statistical miner,
-- Intervention Effectiveness engine, Month-6 outcome report) do not yet
-- exist in the repo and are out of scope for this migration. The lookup
-- tables sit ready with seeded data when those engines are built.

-- ============================================================
-- 0. Required extensions
-- ============================================================
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. user_consents — versioned consent persistence (cross-cutting)
-- ============================================================
create table if not exists public.user_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (consent_type in (
    'hipaa_general',
    'visual_diagnostics',
    'visual_diagnostics_biometric',  -- BIPA for face / iris in IL / TX / WA
    'iridology_complementary_wellness',
    'image_share_external'
  )),
  version text not null,
  accepted boolean not null default true,
  accepted_at timestamptz not null default now(),
  user_jurisdiction text null,  -- state/region snapshot at consent time, for BIPA audit
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists user_consents_user_type_version_unique
  on public.user_consents(user_id, consent_type, version);
create index if not exists user_consents_user_idx
  on public.user_consents(user_id, consent_type, accepted_at desc);

alter table public.user_consents enable row level security;

drop policy if exists "user_consents_owner_select" on public.user_consents;
create policy "user_consents_owner_select"
  on public.user_consents for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_consents_owner_insert" on public.user_consents;
create policy "user_consents_owner_insert"
  on public.user_consents for insert
  to authenticated
  with check (user_id = auth.uid());

-- ============================================================
-- 2. visual_sessions
-- ============================================================
create table if not exists public.visual_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  captured_at timestamptz not null default now(),
  status text not null default 'pending' check (status in (
    'pending', 'analyzing', 'correlating', 'rendering',
    'review_pending', 'signed_off', 'render_failed', 'failed'
  )),
  practitioner_review_status text null,
  review_signed_by uuid null references auth.users(id) on delete set null,
  review_signed_at timestamptz null,
  notes text null,
  visual_health_index numeric null,
  is_baseline boolean not null default false,
  -- per-session inputs for the tongue analyzer + future modalities
  session_inputs_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists visual_sessions_user_captured_idx
  on public.visual_sessions(user_id, captured_at desc);
create index if not exists visual_sessions_status_idx
  on public.visual_sessions(status)
  where status in ('analyzing', 'correlating', 'rendering', 'review_pending');
create index if not exists visual_sessions_baseline_idx
  on public.visual_sessions(user_id, captured_at desc)
  where is_baseline = true;

alter table public.visual_sessions enable row level security;

drop policy if exists "visual_sessions_owner_select" on public.visual_sessions;
create policy "visual_sessions_owner_select"
  on public.visual_sessions for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "visual_sessions_owner_insert" on public.visual_sessions;
create policy "visual_sessions_owner_insert"
  on public.visual_sessions for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "visual_sessions_owner_update" on public.visual_sessions;
create policy "visual_sessions_owner_update"
  on public.visual_sessions for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 3. visual_session_images
-- ============================================================
create table if not exists public.visual_session_images (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.visual_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  modality text not null check (modality in (
    'skin', 'tcm_face', 'tongue', 'nails', 'iris'
  )),
  angle text not null check (angle in (
    'portrait',              -- skin + tcm_face share the portrait
    'tongue_extended',
    'hand_palms_down',
    'right_straight', 'left_straight',
    'right_left_gaze', 'left_right_gaze',
    'right_upper_gaze', 'left_lower_gaze'
  )),
  storage_key text not null,
  image_quality_score numeric null,
  image_quality_flags text[] not null default array[]::text[],
  mime_type text not null,
  size_bytes int null,
  captured_at timestamptz not null default now()
);

create index if not exists visual_session_images_session_idx
  on public.visual_session_images(session_id, modality, angle);

alter table public.visual_session_images enable row level security;

drop policy if exists "visual_session_images_owner_select" on public.visual_session_images;
create policy "visual_session_images_owner_select"
  on public.visual_session_images for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "visual_session_images_owner_insert" on public.visual_session_images;
create policy "visual_session_images_owner_insert"
  on public.visual_session_images for insert
  to authenticated
  with check (user_id = auth.uid());

-- ============================================================
-- 4. visual_findings — per-modality analyzer output
-- ============================================================
create table if not exists public.visual_findings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.visual_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  modality text not null,
  structured_findings jsonb not null,
  cross_modality_tags text[] not null default array[]::text[],
  tags_with_confidence jsonb not null default '{}'::jsonb,
  narrative_by_paradigm jsonb not null default '{}'::jsonb,
  red_flags jsonb not null default '[]'::jsonb,
  confidence numeric null,
  -- short summary text generated deterministically alongside ai_summary.md;
  -- this is what the next session's analyzer reads as `previous_summary`.
  summary_text text null,
  model_version text not null,
  prompt_version text not null,
  generation_ms int null,
  -- pointer to Storage artifacts for this finding
  findings_json_storage_key text null,
  ai_summary_md_storage_key text null,
  created_at timestamptz not null default now()
);

create unique index if not exists visual_findings_session_modality_unique
  on public.visual_findings(session_id, modality);
create index if not exists visual_findings_user_modality_idx
  on public.visual_findings(user_id, modality, created_at desc);
create index if not exists visual_findings_tags_gin
  on public.visual_findings using gin (tags_with_confidence);
create index if not exists visual_findings_cross_modality_tags_gin
  on public.visual_findings using gin (cross_modality_tags);

alter table public.visual_findings enable row level security;

drop policy if exists "visual_findings_owner_select" on public.visual_findings;
create policy "visual_findings_owner_select"
  on public.visual_findings for select
  to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- 5. visual_convergent_findings / visual_divergent_findings
-- ============================================================
create table if not exists public.visual_convergent_findings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.visual_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tag text not null,
  contributing_modalities text[] not null,
  combined_confidence numeric not null,
  trend text null check (trend in ('improving', 'worsening', 'stable', null)),
  prev_session_id uuid null references public.visual_sessions(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists visual_convergent_findings_session_idx
  on public.visual_convergent_findings(session_id, tag);
create index if not exists visual_convergent_findings_user_tag_idx
  on public.visual_convergent_findings(user_id, tag, created_at desc);

alter table public.visual_convergent_findings enable row level security;
drop policy if exists "visual_convergent_findings_owner_select" on public.visual_convergent_findings;
create policy "visual_convergent_findings_owner_select"
  on public.visual_convergent_findings for select
  to authenticated using (user_id = auth.uid());

create table if not exists public.visual_divergent_findings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.visual_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tag_a text not null,
  tag_b text not null,
  contributing_modalities jsonb not null default '{}'::jsonb,
  note text null,
  created_at timestamptz not null default now()
);

create index if not exists visual_divergent_findings_session_idx
  on public.visual_divergent_findings(session_id);

alter table public.visual_divergent_findings enable row level security;
drop policy if exists "visual_divergent_findings_owner_select" on public.visual_divergent_findings;
create policy "visual_divergent_findings_owner_select"
  on public.visual_divergent_findings for select
  to authenticated using (user_id = auth.uid());

-- ============================================================
-- 6. visual_red_flag_alerts (in addition to clinic_alert_events row)
-- ============================================================
create table if not exists public.visual_red_flag_alerts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.visual_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  severity text not null check (severity in ('critical', 'high', 'medium', 'low', 'info')),
  category text not null,
  observation text not null,
  recommended_action text null,
  modality text not null,
  acknowledged_by uuid null references auth.users(id) on delete set null,
  acknowledged_at timestamptz null,
  clinic_alert_event_id uuid null,  -- soft link to the row written into clinic_alert_events
  created_at timestamptz not null default now()
);

create index if not exists visual_red_flag_alerts_session_idx
  on public.visual_red_flag_alerts(session_id, severity);
create index if not exists visual_red_flag_alerts_open_idx
  on public.visual_red_flag_alerts(user_id, created_at desc)
  where acknowledged_at is null;

alter table public.visual_red_flag_alerts enable row level security;
drop policy if exists "visual_red_flag_alerts_owner_select" on public.visual_red_flag_alerts;
create policy "visual_red_flag_alerts_owner_select"
  on public.visual_red_flag_alerts for select
  to authenticated using (user_id = auth.uid());

-- ============================================================
-- 7. Reference tables — approved_brands / approved_products / etc.
--    RLS: read-all-authenticated, write-service-role only.
--    Schema derived from the Longevity_Skincare_AI_Product_Database_v2.xlsx
--    sheet headers (verified against the file).
-- ============================================================
create table if not exists public.approved_brands (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  status text null,
  coverage_tier text null,
  source_evidence_url text null,
  expansion_notes text null,
  db_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists approved_brands_brand_name_unique
  on public.approved_brands(lower(brand_name));

alter table public.approved_brands enable row level security;
drop policy if exists "approved_brands_authenticated_select" on public.approved_brands;
create policy "approved_brands_authenticated_select"
  on public.approved_brands for select
  to authenticated using (true);

create table if not exists public.approved_products (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.approved_brands(id) on delete cascade,
  product_name text not null,
  product_type text null,
  recommendation_category_id uuid null,
  actives_positioning text null,
  best_skin_findings text[] not null default array[]::text[],
  best_skin_types text[] not null default array[]::text[],
  when_to_use text null,
  avoid_caution_logic text null,
  recommendation_logic text null,
  routine_slot text null,
  affiliate_potential text null,
  verification_level text not null default 'pending'
    check (verification_level in ('pending', 'verified', 'official')),
  source_url text null,
  exclusion_flags text[] not null default array[]::text[],
  finding_tags text[] not null default array[]::text[],
  priority int not null default 5,
  notes text null,
  db_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists approved_products_brand_name_unique
  on public.approved_products(brand_id, lower(product_name));
create index if not exists approved_products_verification_priority_idx
  on public.approved_products(verification_level, recommendation_category_id, priority);
create index if not exists approved_products_finding_tags_gin
  on public.approved_products using gin (finding_tags);
create index if not exists approved_products_best_skin_types_gin
  on public.approved_products using gin (best_skin_types);
create index if not exists approved_products_exclusion_flags_gin
  on public.approved_products using gin (exclusion_flags);

alter table public.approved_products enable row level security;
drop policy if exists "approved_products_authenticated_select" on public.approved_products;
create policy "approved_products_authenticated_select"
  on public.approved_products for select
  to authenticated using (true);

create table if not exists public.recommendation_categories (
  id uuid primary key default gen_random_uuid(),
  category_name text not null,
  best_use text null,
  core_products_summary text null,
  when_not_to_use text null,
  db_version int not null default 1,
  created_at timestamptz not null default now()
);

create unique index if not exists recommendation_categories_name_unique
  on public.recommendation_categories(lower(category_name));

alter table public.recommendation_categories enable row level security;
drop policy if exists "recommendation_categories_authenticated_select" on public.recommendation_categories;
create policy "recommendation_categories_authenticated_select"
  on public.recommendation_categories for select
  to authenticated using (true);

-- Add the FK now that recommendation_categories exists.
alter table public.approved_products
  drop constraint if exists approved_products_recommendation_category_id_fkey;
alter table public.approved_products
  add constraint approved_products_recommendation_category_id_fkey
  foreign key (recommendation_category_id)
  references public.recommendation_categories(id) on delete set null;

create table if not exists public.recommendation_rules (
  id uuid primary key default gen_random_uuid(),
  finding_tag text not null,
  threshold_trigger text null,
  primary_category text null,
  preferred_products_summary text null,
  avoid_caution text null,
  example_copy_template text null,
  category_id uuid null references public.recommendation_categories(id) on delete set null,
  db_version int not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists recommendation_rules_finding_tag_idx
  on public.recommendation_rules(finding_tag);

alter table public.recommendation_rules enable row level security;
drop policy if exists "recommendation_rules_authenticated_select" on public.recommendation_rules;
create policy "recommendation_rules_authenticated_select"
  on public.recommendation_rules for select
  to authenticated using (true);

create table if not exists public.product_sources (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid null references public.approved_brands(id) on delete cascade,
  brand_name_snapshot text null,
  source_url text not null,
  what_it_supports text null,
  last_verified_at timestamptz null,
  db_version int not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists product_sources_brand_idx
  on public.product_sources(brand_id);

alter table public.product_sources enable row level security;
drop policy if exists "product_sources_authenticated_select" on public.product_sources;
create policy "product_sources_authenticated_select"
  on public.product_sources for select
  to authenticated using (true);

-- ============================================================
-- 8. Integration lookup tables
-- ============================================================
create table if not exists public.ifm_node_visual_tag_weights (
  id uuid primary key default gen_random_uuid(),
  ifm_node text not null,
  visual_tag text not null,
  weight numeric not null check (weight >= 0 and weight <= 1),
  notes text null,
  created_at timestamptz not null default now()
);

create unique index if not exists ifm_node_visual_tag_weights_unique
  on public.ifm_node_visual_tag_weights(ifm_node, visual_tag);

alter table public.ifm_node_visual_tag_weights enable row level security;
drop policy if exists "ifm_node_visual_tag_weights_authenticated_select" on public.ifm_node_visual_tag_weights;
create policy "ifm_node_visual_tag_weights_authenticated_select"
  on public.ifm_node_visual_tag_weights for select
  to authenticated using (true);

create table if not exists public.zang_fu_visual_tag_map (
  id uuid primary key default gen_random_uuid(),
  organ text not null,
  visual_tag text not null,
  -- score_adjustment is a delta to the patient's organ-level health score.
  -- Negative = depletion / dysfunction direction. Tuned in the admin portal
  -- post-launch.
  score_adjustment numeric not null,
  notes text null,
  created_at timestamptz not null default now()
);

create unique index if not exists zang_fu_visual_tag_map_unique
  on public.zang_fu_visual_tag_map(organ, visual_tag);

alter table public.zang_fu_visual_tag_map enable row level security;
drop policy if exists "zang_fu_visual_tag_map_authenticated_select" on public.zang_fu_visual_tag_map;
create policy "zang_fu_visual_tag_map_authenticated_select"
  on public.zang_fu_visual_tag_map for select
  to authenticated using (true);

create table if not exists public.cross_modality_contradiction_pairs (
  id uuid primary key default gen_random_uuid(),
  tag_a text not null,
  tag_b text not null,
  note text null,
  created_at timestamptz not null default now()
);

create unique index if not exists cross_modality_contradiction_pairs_unique
  on public.cross_modality_contradiction_pairs(least(tag_a, tag_b), greatest(tag_a, tag_b));

alter table public.cross_modality_contradiction_pairs enable row level security;
drop policy if exists "cross_modality_contradiction_pairs_authenticated_select" on public.cross_modality_contradiction_pairs;
create policy "cross_modality_contradiction_pairs_authenticated_select"
  on public.cross_modality_contradiction_pairs for select
  to authenticated using (true);

create table if not exists public.cross_modality_tag_taxonomy (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique,
  namespace text not null,
  description text null,
  created_at timestamptz not null default now()
);

create index if not exists cross_modality_tag_taxonomy_namespace_idx
  on public.cross_modality_tag_taxonomy(namespace);

alter table public.cross_modality_tag_taxonomy enable row level security;
drop policy if exists "cross_modality_tag_taxonomy_authenticated_select" on public.cross_modality_tag_taxonomy;
create policy "cross_modality_tag_taxonomy_authenticated_select"
  on public.cross_modality_tag_taxonomy for select
  to authenticated using (true);

create table if not exists public.visual_health_index_modality_weights (
  modality text primary key,
  weight numeric not null check (weight > 0),
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.visual_health_index_modality_weights enable row level security;
drop policy if exists "visual_health_index_modality_weights_authenticated_select" on public.visual_health_index_modality_weights;
create policy "visual_health_index_modality_weights_authenticated_select"
  on public.visual_health_index_modality_weights for select
  to authenticated using (true);

-- ============================================================
-- 9. Admin / audit tables
-- ============================================================
create table if not exists public.product_db_change_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid null references auth.users(id) on delete set null,
  request_type text not null check (request_type in (
    'add_brand', 'add_product', 'update_product', 'remove_product'
  )),
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  notes text null,
  created_at timestamptz not null default now()
);

create index if not exists product_db_change_requests_status_idx
  on public.product_db_change_requests(status, created_at desc);

alter table public.product_db_change_requests enable row level security;

drop policy if exists "product_db_change_requests_owner_select" on public.product_db_change_requests;
create policy "product_db_change_requests_owner_select"
  on public.product_db_change_requests for select
  to authenticated
  using (requested_by = auth.uid());

drop policy if exists "product_db_change_requests_owner_insert" on public.product_db_change_requests;
create policy "product_db_change_requests_owner_insert"
  on public.product_db_change_requests for insert
  to authenticated
  with check (requested_by = auth.uid());

create table if not exists public.recommendation_renders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid null references public.visual_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  finding_tags text[] not null default array[]::text[],
  exclusions text[] not null default array[]::text[],
  db_version_used int not null,
  products_returned jsonb not null default '[]'::jsonb,
  copy_generated text null,
  rendered_at timestamptz not null default now()
);

create index if not exists recommendation_renders_session_idx
  on public.recommendation_renders(session_id);
create index if not exists recommendation_renders_user_idx
  on public.recommendation_renders(user_id, rendered_at desc);

alter table public.recommendation_renders enable row level security;

drop policy if exists "recommendation_renders_owner_select" on public.recommendation_renders;
create policy "recommendation_renders_owner_select"
  on public.recommendation_renders for select
  to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- 10. Storage bucket — visual-diagnostics-{env}
--     Configured by Supabase env separately. The RLS policies below scope
--     uploads + reads by user_id (first path segment).
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'visual-diagnostics',
  'visual-diagnostics',
  false,
  20971520,  -- 20MB per image; iridology macro is the high end
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/json', 'text/markdown', 'application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "visual_diagnostics_owner_select" on storage.objects;
create policy "visual_diagnostics_owner_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'visual-diagnostics'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "visual_diagnostics_owner_insert" on storage.objects;
create policy "visual_diagnostics_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'visual-diagnostics'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "visual_diagnostics_owner_delete" on storage.objects;
create policy "visual_diagnostics_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'visual-diagnostics'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 11. updated_at trigger for the user-scoped tables
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists visual_sessions_touch_updated_at on public.visual_sessions;
create trigger visual_sessions_touch_updated_at
  before update on public.visual_sessions
  for each row execute function public.touch_updated_at();

drop trigger if exists approved_brands_touch_updated_at on public.approved_brands;
create trigger approved_brands_touch_updated_at
  before update on public.approved_brands
  for each row execute function public.touch_updated_at();

drop trigger if exists approved_products_touch_updated_at on public.approved_products;
create trigger approved_products_touch_updated_at
  before update on public.approved_products
  for each row execute function public.touch_updated_at();

drop trigger if exists visual_health_index_modality_weights_touch_updated_at on public.visual_health_index_modality_weights;
create trigger visual_health_index_modality_weights_touch_updated_at
  before update on public.visual_health_index_modality_weights
  for each row execute function public.touch_updated_at();

-- ============================================================
-- 12. SEED DATA — Dr. Bright's confirmed mappings
-- ============================================================

-- 12a. Cross-modality tag taxonomy (mirrors the TS const enum)
insert into public.cross_modality_tag_taxonomy (tag, namespace, description) values
  ('pattern.qi_deficiency', 'pattern', 'TCM qi xu - vital energy depletion'),
  ('pattern.qi_excess', 'pattern', 'TCM qi excess - relative excess of qi (added per part 4 §7.4)'),
  ('pattern.yin_deficiency', 'pattern', 'TCM yin xu'),
  ('pattern.yang_deficiency', 'pattern', 'TCM yang xu'),
  ('pattern.blood_deficiency', 'pattern', 'TCM xue xu'),
  ('pattern.blood_stasis', 'pattern', 'TCM xue yu'),
  ('pattern.liver_qi_stagnation', 'pattern', 'TCM gan qi yu jie'),
  ('pattern.spleen_qi_deficiency', 'pattern', 'TCM pi qi xu'),
  ('pattern.kidney_yin_deficiency', 'pattern', 'TCM shen yin xu'),
  ('pattern.kidney_yang_deficiency', 'pattern', 'TCM shen yang xu'),
  ('pattern.damp_heat', 'pattern', 'TCM shi re'),
  ('pattern.cold_damp', 'pattern', 'TCM han shi (contradiction pair to damp_heat)'),
  ('pattern.phlegm_damp', 'pattern', 'TCM tan shi'),
  ('pattern.stomach_heat', 'pattern', 'TCM wei re'),
  ('pattern.heat_internal', 'pattern', 'TCM internal heat (general)'),
  ('pattern.cold_internal', 'pattern', 'TCM internal cold (contradiction pair to heat_internal)'),
  ('pattern.excess_pattern', 'pattern', 'TCM shi - general excess'),
  ('pattern.deficiency_pattern', 'pattern', 'TCM xu - general deficiency (contradiction pair to excess_pattern)'),
  ('pattern.heart_shen_disturbance', 'pattern', 'TCM heart shen disturbance / nervous system dysregulation'),
  ('lifestyle.poor_sleep_appearance', 'lifestyle', 'Visible signs of poor recent sleep'),
  ('lifestyle.dehydration_signs', 'lifestyle', 'Visible signs of dehydration'),
  ('lifestyle.high_stress_load', 'lifestyle', 'Pattern of high sustained stress'),
  ('lifestyle.high_inflammation_appearance', 'lifestyle', 'Visible inflammation tendency'),
  ('nutrient.iron_insufficiency_pattern', 'nutrient', 'Visual pattern suggesting iron insufficiency'),
  ('nutrient.b12_insufficiency_pattern', 'nutrient', 'Visual pattern suggesting B12 insufficiency'),
  ('nutrient.protein_insufficiency_pattern', 'nutrient', 'Visual pattern suggesting protein insufficiency'),
  ('nutrient.zinc_insufficiency_pattern', 'nutrient', 'Visual pattern suggesting zinc insufficiency'),
  ('nutrient.biotin_insufficiency_pattern', 'nutrient', 'Visual pattern suggesting biotin insufficiency'),
  ('system.circulation_compromise', 'system', 'Peripheral circulation appears compromised'),
  ('system.lymphatic_burden', 'system', 'Visible lymphatic congestion'),
  ('system.detox_pathway_burden', 'system', 'Visible terrain suggesting detox pathway burden'),
  ('system.gut_dysbiosis_appearance', 'system', 'Visible signs commonly associated with gut dysbiosis'),
  ('system.hormonal_imbalance_appearance', 'system', 'Visible signs commonly associated with hormonal imbalance'),
  ('aging.glycation_load', 'aging', 'Visible glycation / AGE accumulation tendency'),
  ('aging.oxidative_stress_load', 'aging', 'Visible oxidative stress tendency'),
  ('aging.collagen_decline', 'aging', 'Visible collagen decline'),
  ('aging.uv_exposure_load', 'aging', 'Visible cumulative UV exposure'),
  ('redflag.requires_in_person_eval', 'redflag', 'Observation requiring in-person clinician evaluation'),
  ('redflag.dermatology_referral', 'redflag', 'Observation requiring dermatology referral'),
  ('redflag.dermatology_pigmented_lesion', 'redflag', 'Pigmented lesion requiring dermatology referral (urgent)'),
  ('redflag.cardiopulmonary_referral', 'redflag', 'Observation requiring cardiopulmonary referral'),
  ('redflag.hepatic_referral', 'redflag', 'Observation requiring hepatic referral')
on conflict (tag) do nothing;

-- 12b. Contradiction pairs (seeded from part 3 §7.4)
insert into public.cross_modality_contradiction_pairs (tag_a, tag_b, note) values
  ('pattern.yin_deficiency', 'pattern.yang_deficiency', 'Yin xu and yang xu rarely coexist as primary patterns'),
  ('pattern.qi_deficiency', 'pattern.qi_excess', 'Cannot be simultaneously deficient and excess'),
  ('pattern.damp_heat', 'pattern.cold_damp', 'Heat and cold dampness present opposite thermal characters'),
  ('pattern.heat_internal', 'pattern.cold_internal', 'Internal heat vs internal cold are opposing patterns'),
  ('pattern.excess_pattern', 'pattern.deficiency_pattern', 'General excess vs general deficiency')
on conflict do nothing;

-- 12c. IFM node -> visual tag weights (seeded from part 4 #1)
insert into public.ifm_node_visual_tag_weights (visual_tag, ifm_node, weight) values
  ('system.lymphatic_burden', 'transport', 0.6),
  ('system.circulation_compromise', 'transport', 0.5),
  ('system.detox_pathway_burden', 'biotransformation', 0.7),
  ('aging.oxidative_stress_load', 'defense_repair', 0.5),
  ('lifestyle.high_inflammation_appearance', 'defense_repair', 0.6),
  ('system.gut_dysbiosis_appearance', 'assimilation', 0.7),
  ('nutrient.iron_insufficiency_pattern', 'assimilation', 0.5),
  ('nutrient.b12_insufficiency_pattern', 'assimilation', 0.5),
  ('nutrient.protein_insufficiency_pattern', 'assimilation', 0.5),
  ('pattern.qi_deficiency', 'energy', 0.7),
  ('pattern.spleen_qi_deficiency', 'energy', 0.6),
  ('pattern.spleen_qi_deficiency', 'assimilation', 0.4),
  ('pattern.kidney_yang_deficiency', 'energy', 0.5),
  ('lifestyle.high_stress_load', 'communication', 0.6),
  ('pattern.heart_shen_disturbance', 'communication', 0.5),
  ('system.hormonal_imbalance_appearance', 'communication', 0.7),
  ('aging.collagen_decline', 'structural_integrity', 0.7),
  ('aging.uv_exposure_load', 'structural_integrity', 0.4),
  ('aging.glycation_load', 'structural_integrity', 0.5)
on conflict (ifm_node, visual_tag) do nothing;

-- 12d. Zang-Fu organ adjustments (seeded from part 4 #1)
-- Convention: negative score_adjustment = depletion / dysfunction direction.
insert into public.zang_fu_visual_tag_map (visual_tag, organ, score_adjustment) values
  ('pattern.spleen_qi_deficiency', 'spleen', -2),
  ('pattern.kidney_yin_deficiency', 'kidney_yin', -2),
  ('pattern.kidney_yang_deficiency', 'kidney_yang', -2),
  ('pattern.liver_qi_stagnation', 'liver', -2),
  ('pattern.heart_shen_disturbance', 'heart', -2),
  ('pattern.blood_stasis', 'liver', -1),
  ('pattern.blood_stasis', 'heart', -1),
  ('pattern.phlegm_damp', 'spleen', -1),
  ('pattern.phlegm_damp', 'lung', -1),
  ('pattern.damp_heat', 'spleen', -1),
  ('pattern.damp_heat', 'liver', -1),
  ('pattern.stomach_heat', 'stomach', -2),
  ('pattern.yin_deficiency', 'kidney_yin', -1),
  ('pattern.qi_deficiency', 'spleen', -1),
  ('pattern.blood_deficiency', 'heart', -1),
  ('pattern.blood_deficiency', 'liver', -1)
on conflict (organ, visual_tag) do nothing;

-- 12e. Visual Health Index modality weights (seeded from part 4 #5)
insert into public.visual_health_index_modality_weights (modality, weight, notes) values
  ('skin', 1.0, 'Standard weight'),
  ('tcm_face', 1.0, 'Standard weight'),
  ('tongue', 1.2, 'Tongue diagnosis weighted slightly higher per Dr. Bright clinical reliability'),
  ('nails', 0.8, 'Lower bandwidth signal'),
  ('iris', 0.5, 'Complementary-wellness framed, discounted to avoid disproportionate weight')
on conflict (modality) do nothing;
