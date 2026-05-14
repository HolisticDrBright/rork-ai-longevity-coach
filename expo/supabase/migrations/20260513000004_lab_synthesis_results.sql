-- Server-side persistence for cross-lab synthesis results.
-- The cross-lab-synthesis edge function inserts a new row on every successful
-- run; the client reads the most recent row on app load so users see their
-- synthesis without re-paying for an OpenAI call every time.
--
-- Append-only: each run is a new row keyed by id. The client UI shows the
-- latest by generated_at desc and can list history.

create table if not exists public.lab_synthesis_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  generated_at timestamptz not null default now(),
  panel_count int not null default 0,
  -- panels_summary_json: [{ jobId, fileName, panelType, collectedAt, markerCount }]
  panels_summary_json jsonb not null default '[]'::jsonb,
  -- patterns_json: string[]
  patterns_json jsonb not null default '[]'::jsonb,
  narrative text null,
  model_used text null,
  created_at timestamptz not null default now()
);

create index if not exists lab_synthesis_results_user_generated_idx
  on public.lab_synthesis_results(user_id, generated_at desc);

alter table public.lab_synthesis_results enable row level security;

drop policy if exists "lab_synthesis_results_owner_select" on public.lab_synthesis_results;
create policy "lab_synthesis_results_owner_select"
  on public.lab_synthesis_results for select
  to authenticated
  using (user_id = auth.uid());

-- Edge function writes with the service role and bypasses RLS, so no INSERT
-- policy is needed. The owner-select policy is sufficient for the client.
