-- =============================================================================
-- Clinical Reasoning Foundation (Phase 1)
-- Additive only: creates new tables, functions, policies. Touches NO existing
-- tables. Idempotent: safe to re-run. See docs/adr/0001-clinical-reasoning-foundation.md
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Shared enums (created only if missing)
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.reasoning_source_type as enum (
    'measured', 'patient_reported', 'practitioner_entered',
    'published_evidence', 'ai_inference', 'rule_engine'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reasoning_review_status as enum (
    'not_required', 'pending_review', 'accepted', 'modified', 'rejected'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.hypothesis_status as enum (
    'proposed', 'under_review', 'supported', 'weakened',
    'unresolved', 'rejected', 'archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.relationship_status as enum (
    'pending', 'active', 'revoked', 'ended'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.review_decision_status as enum (
    'pending', 'accepted', 'modified', 'rejected', 'dismissed'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so RLS policies can consult them without
-- recursive policy evaluation). Resilient if user_roles does not exist.
-- ---------------------------------------------------------------------------
create or replace function public.app_has_role(check_user_id uuid, allowed_roles text[])
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare ok boolean := false;
begin
  begin
    select exists (
      select 1 from public.user_roles ur
      where ur.user_id = check_user_id and ur.role::text = any (allowed_roles)
    ) into ok;
  exception when undefined_table then
    ok := false;
  end;
  return coalesce(ok, false);
end;
$$;

create or replace function public.app_is_practitioner_for(check_practitioner uuid, check_patient uuid)
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare ok boolean := false;
begin
  if check_practitioner is null or check_patient is null then
    return false;
  end if;
  select exists (
    select 1 from public.practitioner_patient_relationships r
    where r.practitioner_id = check_practitioner
      and r.patient_id = check_patient
      and r.status = 'active'
  ) into ok;
  return coalesce(ok, false)
     and public.app_has_role(check_practitioner, array['practitioner', 'admin']);
end;
$$;

create or replace function public.app_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- practitioner_patient_relationships
-- Patient-consented link that authorizes a practitioner to view/reason over a
-- patient-app user's data. (Bridges to clinic_* records in a later phase.)
-- ---------------------------------------------------------------------------
create table if not exists public.practitioner_patient_relationships (
  id uuid primary key default gen_random_uuid(),
  practitioner_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references auth.users(id) on delete cascade,
  status public.relationship_status not null default 'active',
  consent_scope jsonb not null default '{"timeline": true, "reasoning": true, "labs": true}'::jsonb,
  granted_by uuid references auth.users(id),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (practitioner_id, patient_id)
);

create index if not exists idx_ppr_practitioner on public.practitioner_patient_relationships(practitioner_id, status);
create index if not exists idx_ppr_patient on public.practitioner_patient_relationships(patient_id, status);

alter table public.practitioner_patient_relationships enable row level security;

drop policy if exists ppr_select on public.practitioner_patient_relationships;
create policy ppr_select on public.practitioner_patient_relationships
  for select using (patient_id = auth.uid() or practitioner_id = auth.uid());

-- Patients grant access (they are the consenting party).
drop policy if exists ppr_insert_patient on public.practitioner_patient_relationships;
create policy ppr_insert_patient on public.practitioner_patient_relationships
  for insert with check (patient_id = auth.uid() and granted_by = auth.uid());

-- Either party can update (revoke/end); patients own consent, practitioners may end.
drop policy if exists ppr_update on public.practitioner_patient_relationships;
create policy ppr_update on public.practitioner_patient_relationships
  for update using (patient_id = auth.uid() or practitioner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- clinical_facts
-- Normalized longitudinal observations with a full provenance envelope.
-- observed_at = clinical time; recorded_at = ingestion time. Never silently
-- overwritten: corrections create a new version and set superseded_by.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fact_type text not null,               -- biomarker | symptom | medication | supplement | condition | lifestyle | vital | note | change
  code text,                             -- normalized code/slug (e.g. loinc-ish or internal slug)
  label text not null,
  value_num numeric,
  value_text text,
  value_json jsonb,
  unit text,
  original_value text,                   -- verbatim as extracted/entered
  original_unit text,
  reference_low numeric,
  reference_high numeric,
  observed_at timestamptz not null,
  observed_end_at timestamptz,
  recorded_at timestamptz not null default now(),
  source_type public.reasoning_source_type not null,
  source text,                           -- e.g. 'lab_panel', 'wearable:oura', 'manual'
  source_record_id text,                 -- id in the originating table
  source_document_id text,               -- uploaded document reference
  source_location text,                  -- page/section within the document
  data_quality numeric check (data_quality is null or (data_quality >= 0 and data_quality <= 1)),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  review_status public.reasoning_review_status not null default 'not_required',
  created_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  version integer not null default 1,
  superseded_by uuid references public.clinical_facts(id),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clinical_facts_user_time on public.clinical_facts(user_id, observed_at desc);
create index if not exists idx_clinical_facts_user_type on public.clinical_facts(user_id, fact_type, code);
create index if not exists idx_clinical_facts_review on public.clinical_facts(user_id, review_status);

alter table public.clinical_facts enable row level security;

drop policy if exists clinical_facts_select on public.clinical_facts;
create policy clinical_facts_select on public.clinical_facts
  for select using (
    user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id)
  );

drop policy if exists clinical_facts_insert on public.clinical_facts;
create policy clinical_facts_insert on public.clinical_facts
  for insert with check (
    (user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id))
    and created_by = auth.uid()
  );

drop policy if exists clinical_facts_update on public.clinical_facts;
create policy clinical_facts_update on public.clinical_facts
  for update using (
    user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id)
  );

-- ---------------------------------------------------------------------------
-- clinical_hypotheses
-- Competing explanations with lifecycle, scores labeled as "support level"
-- (never a medical probability), and explicit source typing.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_hypotheses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  status public.hypothesis_status not null default 'proposed',
  support_score numeric not null default 0 check (support_score >= 0 and support_score <= 100),
  prior_support_score numeric,
  score_change_reason text,
  missing_evidence jsonb not null default '[]'::jsonb,
  systems text[] not null default '{}',
  alternatives jsonb not null default '[]'::jsonb,   -- [{hypothesisId?, name}]
  earliest_supporting_at timestamptz,
  source_type public.reasoning_source_type not null,
  review_status public.reasoning_review_status not null default 'pending_review',
  created_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- AI/rule output can never masquerade as a human conclusion.
  constraint hypotheses_source_review check (
    source_type not in ('ai_inference', 'rule_engine') or review_status <> 'not_required'
  )
);

create index if not exists idx_hypotheses_user_status on public.clinical_hypotheses(user_id, status);
create index if not exists idx_hypotheses_review on public.clinical_hypotheses(user_id, review_status);

alter table public.clinical_hypotheses enable row level security;

drop policy if exists hypotheses_select on public.clinical_hypotheses;
create policy hypotheses_select on public.clinical_hypotheses
  for select using (
    user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id)
  );

drop policy if exists hypotheses_insert on public.clinical_hypotheses;
create policy hypotheses_insert on public.clinical_hypotheses
  for insert with check (
    (user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id))
    and created_by = auth.uid()
  );

drop policy if exists hypotheses_update on public.clinical_hypotheses;
create policy hypotheses_update on public.clinical_hypotheses
  for update using (
    user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id)
  );

-- ---------------------------------------------------------------------------
-- evidence_items
-- Ledger linking observations/knowledge to hypotheses, with direction.
-- ---------------------------------------------------------------------------
create table if not exists public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  hypothesis_id uuid not null references public.clinical_hypotheses(id) on delete cascade,
  direction text not null check (direction in ('supports', 'contradicts', 'neutral')),
  evidence_type text not null,          -- observation | trend | lab | symptom | published | practitioner_note
  fact_id uuid references public.clinical_facts(id),
  source_type public.reasoning_source_type not null,
  summary text not null,
  strength numeric check (strength is null or (strength >= 0 and strength <= 1)),
  observed_at timestamptz,
  citation text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_evidence_hypothesis on public.evidence_items(hypothesis_id, direction);
create index if not exists idx_evidence_user on public.evidence_items(user_id);

alter table public.evidence_items enable row level security;

drop policy if exists evidence_select on public.evidence_items;
create policy evidence_select on public.evidence_items
  for select using (
    user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id)
  );

drop policy if exists evidence_insert on public.evidence_items;
create policy evidence_insert on public.evidence_items
  for insert with check (
    (user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id))
    and created_by = auth.uid()
  );

drop policy if exists evidence_delete on public.evidence_items;
create policy evidence_delete on public.evidence_items
  for delete using (
    created_by = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id)
  );

-- ---------------------------------------------------------------------------
-- clinical_relationships
-- Typed edges of the longitudinal health graph.
-- ---------------------------------------------------------------------------
create table if not exists public.clinical_relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null,            -- fact | hypothesis | intervention | biomarker | symptom | system
  source_ref text not null,             -- id or code of the source entity
  target_kind text not null,
  target_ref text not null,
  relationship_type text not null check (relationship_type in (
    'PRECEDES','FOLLOWS','CORRELATES_WITH','MAY_CONTRIBUTE_TO','CONTRADICTS',
    'IMPROVES','WORSENS','TARGETS','INTERACTS_WITH','DUPLICATES',
    'REQUIRES_MONITORING','ASSOCIATED_WITH','RULED_OUT_BY','SUPPORTED_BY'
  )),
  direction text not null default 'directed' check (direction in ('directed', 'bidirectional')),
  strength numeric check (strength is null or (strength >= 0 and strength <= 1)),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  temporal_relation jsonb,              -- {lagDays?, windowDays?}
  supporting_evidence jsonb not null default '[]'::jsonb,
  contradicting_evidence jsonb not null default '[]'::jsonb,
  source_type public.reasoning_source_type not null,
  review_status public.reasoning_review_status not null default 'pending_review',
  created_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint relationships_source_review check (
    source_type not in ('ai_inference', 'rule_engine') or review_status <> 'not_required'
  )
);

create index if not exists idx_relationships_user on public.clinical_relationships(user_id, relationship_type);

alter table public.clinical_relationships enable row level security;

drop policy if exists relationships_select on public.clinical_relationships;
create policy relationships_select on public.clinical_relationships
  for select using (
    user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id)
  );

drop policy if exists relationships_insert on public.clinical_relationships;
create policy relationships_insert on public.clinical_relationships
  for insert with check (
    (user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id))
    and created_by = auth.uid()
  );

drop policy if exists relationships_update on public.clinical_relationships;
create policy relationships_update on public.clinical_relationships
  for update using (
    user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id)
  );

-- ---------------------------------------------------------------------------
-- reasoning_snapshots
-- Immutable, versioned output of each reasoning-pipeline run.
-- ---------------------------------------------------------------------------
create table if not exists public.reasoning_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_number integer not null,
  trigger text not null,                -- manual | new_lab | new_symptom | schedule | experiment | wearable_trend
  pipeline_version text not null,
  inputs_summary jsonb not null default '{}'::jsonb,
  hypotheses_state jsonb not null default '[]'::jsonb,
  detected_changes jsonb not null default '[]'::jsonb,
  data_quality_issues jsonb not null default '[]'::jsonb,
  missing_data jsonb not null default '[]'::jsonb,
  diff_from_previous jsonb not null default '{}'::jsonb,
  previous_snapshot_id uuid references public.reasoning_snapshots(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (user_id, snapshot_number)
);

create index if not exists idx_snapshots_user on public.reasoning_snapshots(user_id, snapshot_number desc);

alter table public.reasoning_snapshots enable row level security;

drop policy if exists snapshots_select on public.reasoning_snapshots;
create policy snapshots_select on public.reasoning_snapshots
  for select using (
    user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id)
  );

drop policy if exists snapshots_insert on public.reasoning_snapshots;
create policy snapshots_insert on public.reasoning_snapshots
  for insert with check (
    (user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id))
    and created_by = auth.uid()
  );
-- No update/delete policies: snapshots are immutable.

-- ---------------------------------------------------------------------------
-- ai_operations
-- Audit ledger for every AI/rule-engine operation.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  operation text not null,              -- e.g. 'reasoning.pipeline', 'labs.extraction'
  model text,
  model_version text,
  prompt_template text,
  prompt_version text,
  input_record_ids jsonb not null default '[]'::jsonb,
  retrieved_evidence_ids jsonb not null default '[]'::jsonb,
  output jsonb,
  output_text text,
  validation_status text not null default 'not_applicable', -- passed | failed | not_applicable
  error text,
  retry_count integer not null default 0,
  latency_ms integer,
  initiated_by uuid references auth.users(id),
  review_status public.reasoning_review_status not null default 'not_required',
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_operations_user on public.ai_operations(user_id, created_at desc);

alter table public.ai_operations enable row level security;

drop policy if exists ai_operations_select on public.ai_operations;
create policy ai_operations_select on public.ai_operations
  for select using (
    user_id = auth.uid()
    or initiated_by = auth.uid()
    or public.app_is_practitioner_for(auth.uid(), user_id)
  );

drop policy if exists ai_operations_insert on public.ai_operations;
create policy ai_operations_insert on public.ai_operations
  for insert with check (
    initiated_by = auth.uid()
    and (user_id is null or user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id))
  );
-- Append-only: no update/delete policies.

-- ---------------------------------------------------------------------------
-- practitioner_reviews
-- The review queue: every AI/rule-generated conclusion that needs human eyes.
-- ---------------------------------------------------------------------------
create table if not exists public.practitioner_reviews (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references auth.users(id) on delete cascade,
  subject_type text not null,           -- hypothesis | fact | relationship | snapshot_change | recommendation
  subject_id text not null,
  priority text not null default 'routine' check (priority in ('routine', 'elevated', 'urgent')),
  proposed_summary text not null,
  context jsonb not null default '{}'::jsonb,
  status public.review_decision_status not null default 'pending',
  decision_note text,
  modified_payload jsonb,
  created_by uuid references auth.users(id),
  decided_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists idx_reviews_patient_status on public.practitioner_reviews(patient_id, status);
create index if not exists idx_reviews_status on public.practitioner_reviews(status, priority);

alter table public.practitioner_reviews enable row level security;

drop policy if exists reviews_select on public.practitioner_reviews;
create policy reviews_select on public.practitioner_reviews
  for select using (
    patient_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), patient_id)
  );

drop policy if exists reviews_insert on public.practitioner_reviews;
create policy reviews_insert on public.practitioner_reviews
  for insert with check (
    (patient_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), patient_id))
    and created_by = auth.uid()
  );

-- Only an authorized practitioner may decide.
drop policy if exists reviews_update_practitioner on public.practitioner_reviews;
create policy reviews_update_practitioner on public.practitioner_reviews
  for update using (public.app_is_practitioner_for(auth.uid(), patient_id));

-- ---------------------------------------------------------------------------
-- audit_events
-- Server-side, append-only audit of sensitive access. details must never
-- contain PHI values — resource ids and metadata only.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text,
  action text not null,                 -- e.g. 'reasoning.timeline.read', 'review.decide'
  resource_type text not null,
  resource_id text,
  patient_id uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_actor on public.audit_events(actor_id, created_at desc);
create index if not exists idx_audit_events_patient on public.audit_events(patient_id, created_at desc);

alter table public.audit_events enable row level security;

drop policy if exists audit_events_insert on public.audit_events;
create policy audit_events_insert on public.audit_events
  for insert with check (actor_id = auth.uid());

-- Patients can see access to their own record; actors can see their own actions;
-- admins can see everything.
drop policy if exists audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  for select using (
    actor_id = auth.uid()
    or patient_id = auth.uid()
    or public.app_has_role(auth.uid(), array['admin'])
  );
-- Append-only: no update/delete policies.

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$ begin
  create trigger trg_ppr_touch before update on public.practitioner_patient_relationships
    for each row execute function public.app_touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_facts_touch before update on public.clinical_facts
    for each row execute function public.app_touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_hypotheses_touch before update on public.clinical_hypotheses
    for each row execute function public.app_touch_updated_at();
exception when duplicate_object then null; end $$;
