-- =============================================================================
-- Phase 2: server AI orchestration, hypothesis engine, Health Twin, lab ingestion
-- Additive and idempotent. See docs/adr/0002-server-ai-orchestration-health-twin.md
-- =============================================================================

-- Hypothesis dedupe key for rule/AI-generated candidates (e.g. 'rule:iron_insufficiency').
alter table public.clinical_hypotheses add column if not exists code text;
create index if not exists idx_hypotheses_user_code on public.clinical_hypotheses(user_id, code);

-- Health Twin Layer-2 state captured with every reasoning snapshot (immutable history).
alter table public.reasoning_snapshots add column if not exists systems_state jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- uploaded_documents
-- Server-side ingestion provenance for lab files: raw extracted content,
-- dedupe hash, extraction status. Original binary stays with the client until
-- storage policies are provisioned (see ADR 0002 follow-ups).
-- ---------------------------------------------------------------------------
create table if not exists public.uploaded_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  page_count integer,
  storage_path text,
  raw_text text,
  extraction jsonb,                      -- validated structured extraction output
  extraction_model text,
  extraction_confidence numeric check (extraction_confidence is null or (extraction_confidence >= 0 and extraction_confidence <= 1)),
  dedupe_hash text not null,
  status text not null default 'extracted' check (status in ('pending', 'extracted', 'failed', 'superseded', 'corrected')),
  supersedes_document_id uuid references public.uploaded_documents(id),
  report_date date,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_uploaded_documents_user on public.uploaded_documents(user_id, created_at desc);
create index if not exists idx_uploaded_documents_hash on public.uploaded_documents(user_id, dedupe_hash);

alter table public.uploaded_documents enable row level security;

drop policy if exists uploaded_documents_select on public.uploaded_documents;
create policy uploaded_documents_select on public.uploaded_documents
  for select using (
    user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id)
  );

drop policy if exists uploaded_documents_insert on public.uploaded_documents;
create policy uploaded_documents_insert on public.uploaded_documents
  for insert with check (
    (user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id))
    and created_by = auth.uid()
  );

drop policy if exists uploaded_documents_update on public.uploaded_documents;
create policy uploaded_documents_update on public.uploaded_documents
  for update using (
    user_id = auth.uid() or public.app_is_practitioner_for(auth.uid(), user_id)
  );
