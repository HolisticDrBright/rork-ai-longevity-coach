-- patient-sync/1 receiver storage (Phase 6B, AI Desktop Pro bridge).
--
-- APPLY STATUS: committed but NOT yet applied. The AI Longevity Pro
-- Supabase project is configured only through protected environment
-- variables (EXPO_PUBLIC_SUPABASE_URL et al.) and is not reachable from
-- the automation credentials that authored this migration; applying it is
-- a deliberate operator step documented in expo/docs/patient-sync.md.
--
-- Design rules (mirroring the desktop side of the bridge):
--   * linking is ONLY by the explicit desktop connection id bound through
--     the Phase 5 invitation exchange — never email/name/phone/DOB
--   * received envelopes are append-only clinical history; withdrawal is a
--     tombstone, never a delete
--   * the mobile app reads through RLS (its own rows only) and writes
--     NOTHING directly — all writes happen in the backend server process
--     (service role) or through the SECURITY DEFINER functions below
--   * no PHI in error messages

begin;

create table public.patient_sync_connections (
  id uuid primary key default gen_random_uuid(),
  desktop_connection_id text not null unique,
  desktop_organization_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now()
);
create index patient_sync_connections_user_idx
  on public.patient_sync_connections (user_id, status);

create table public.patient_sync_envelopes (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.patient_sync_connections (id) on delete cascade,
  event_uid text not null unique,
  idempotency_key text not null,
  scope text not null,
  resource_type text not null,
  resource_id text not null,
  resource_version text not null,
  occurred_at timestamptz not null,
  payload jsonb not null,
  payload_hash text not null,
  provenance jsonb not null default '{}'::jsonb,
  correlation_id text,
  causation_id text,
  received_at timestamptz not null default now(),
  receipt_ids jsonb not null default '[]'::jsonb
);
create index patient_sync_envelopes_connection_idx
  on public.patient_sync_envelopes (connection_id, received_at desc);

create table public.patient_sync_resources (
  connection_id uuid not null references public.patient_sync_connections (id) on delete cascade,
  resource_type text not null,
  resource_id text not null,
  resource_version text not null,
  scope text not null,
  payload jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  updated_at timestamptz not null default now(),
  source_event_uid text not null,
  tombstoned boolean not null default false,
  tombstone_reason text,
  acknowledged_at timestamptz,
  primary key (connection_id, resource_type, resource_id)
);

create table public.patient_sync_nonces (
  key_id text not null,
  nonce text not null,
  seen_at timestamptz not null default now(),
  primary key (key_id, nonce)
);

create table public.patient_sync_outbox (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.patient_sync_connections (id) on delete cascade,
  provider_event_id text not null unique,
  resource_type text not null,
  payload jsonb not null,
  payload_hash text not null,
  occurred_at timestamptz not null default now(),
  external_resource_id text,
  resource_version text,
  state text not null default 'queued' check (state in ('queued', 'delivered', 'failed')),
  attempts integer not null default 0,
  last_error_safe text,
  created_at timestamptz not null default now()
);
create index patient_sync_outbox_state_idx
  on public.patient_sync_outbox (state, occurred_at);

create table public.patient_sync_events (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.patient_sync_connections (id) on delete cascade,
  kind text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index patient_sync_events_connection_idx
  on public.patient_sync_events (connection_id, created_at);

-- Received envelopes are immutable clinical history.
create or replace function public.patient_sync_envelopes_immutable()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'received sync envelopes are immutable' using errcode = '42501';
end;
$$;
create trigger patient_sync_envelopes_no_update
  before update or delete on public.patient_sync_envelopes
  for each row execute function public.patient_sync_envelopes_immutable();

-- RLS: patients read ONLY their own connection's rows; nobody writes
-- directly from a client. The backend server process (service role)
-- bypasses RLS; anon has nothing.
alter table public.patient_sync_connections enable row level security;
alter table public.patient_sync_envelopes enable row level security;
alter table public.patient_sync_resources enable row level security;
alter table public.patient_sync_nonces enable row level security;
alter table public.patient_sync_outbox enable row level security;
alter table public.patient_sync_events enable row level security;

create policy patient_sync_connections_select on public.patient_sync_connections
  for select to authenticated using (user_id = auth.uid());
create policy patient_sync_envelopes_select on public.patient_sync_envelopes
  for select to authenticated using (exists (
    select 1 from public.patient_sync_connections c
    where c.id = connection_id and c.user_id = auth.uid()));
create policy patient_sync_resources_select on public.patient_sync_resources
  for select to authenticated using (exists (
    select 1 from public.patient_sync_connections c
    where c.id = connection_id and c.user_id = auth.uid()));
create policy patient_sync_events_select on public.patient_sync_events
  for select to authenticated using (exists (
    select 1 from public.patient_sync_connections c
    where c.id = connection_id and c.user_id = auth.uid()));
-- patient_sync_nonces and patient_sync_outbox: deny-all (no policies) —
-- server-process concerns, never client-readable.

revoke insert, update, delete on public.patient_sync_connections from anon, authenticated;
revoke insert, update, delete on public.patient_sync_envelopes from anon, authenticated;
revoke insert, update, delete on public.patient_sync_resources from anon, authenticated;
revoke all on public.patient_sync_nonces from anon, authenticated;
revoke all on public.patient_sync_outbox from anon, authenticated;
revoke insert, update, delete on public.patient_sync_events from anon, authenticated;
revoke select on public.patient_sync_nonces from anon, authenticated;
revoke select on public.patient_sync_outbox from anon, authenticated;

commit;
