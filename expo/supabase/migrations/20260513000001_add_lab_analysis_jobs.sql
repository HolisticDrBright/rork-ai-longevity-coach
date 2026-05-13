-- Lab analyzer: storage bucket + async job queue for server-side lab PDF/image
-- parsing (Textract -> GPT enrichment). Backing store for the daily-coach
-- aggregator's "latest labs per user" lookup.

-- ============================================================
-- 1. Storage bucket for lab PDFs/images
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lab-pdfs',
  'lab-pdfs',
  false,
  52428800,
  array['application/pdf','image/jpeg','image/png','image/jpg']
)
on conflict (id) do nothing;

-- Files must be uploaded under <user_id>/<filename> so the policies below
-- can scope access by the first path segment.
drop policy if exists "lab_pdfs_owner_select" on storage.objects;
create policy "lab_pdfs_owner_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lab-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "lab_pdfs_owner_insert" on storage.objects;
create policy "lab_pdfs_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'lab-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "lab_pdfs_owner_delete" on storage.objects;
create policy "lab_pdfs_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'lab-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 2. lab_analysis_jobs (async parsing queue)
-- ============================================================
create table if not exists public.lab_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  clinic_document_id uuid null,
  storage_path text not null,
  file_name text not null,
  file_type text not null check (file_type in ('pdf','jpg','png')),
  status text not null default 'pending'
    check (status in ('pending','extracting','enriching','complete','failed')),
  error text null,
  biomarkers_json jsonb null,
  supplements_json jsonb null,
  herbs_json jsonb null,
  priority_actions_json jsonb null,
  analysis_text text null,
  textract_raw_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

-- "Latest completed job per user" - what the daily-coach aggregator reads.
create index if not exists lab_analysis_jobs_user_completed_idx
  on public.lab_analysis_jobs(user_id, completed_at desc)
  where status = 'complete';

-- General "show me my jobs" listing.
create index if not exists lab_analysis_jobs_user_created_idx
  on public.lab_analysis_jobs(user_id, created_at desc);

-- Worker poll: in-flight jobs that need processing.
create index if not exists lab_analysis_jobs_status_idx
  on public.lab_analysis_jobs(status, created_at)
  where status in ('pending', 'extracting', 'enriching');

alter table public.lab_analysis_jobs enable row level security;

drop policy if exists "lab_analysis_jobs_owner_select" on public.lab_analysis_jobs;
create policy "lab_analysis_jobs_owner_select"
  on public.lab_analysis_jobs for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "lab_analysis_jobs_owner_insert" on public.lab_analysis_jobs;
create policy "lab_analysis_jobs_owner_insert"
  on public.lab_analysis_jobs for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "lab_analysis_jobs_owner_update" on public.lab_analysis_jobs;
create policy "lab_analysis_jobs_owner_update"
  on public.lab_analysis_jobs for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- 3. updated_at trigger
-- ============================================================
create or replace function public.lab_analysis_jobs_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists lab_analysis_jobs_touch_updated_at on public.lab_analysis_jobs;
create trigger lab_analysis_jobs_touch_updated_at
  before update on public.lab_analysis_jobs
  for each row execute function public.lab_analysis_jobs_touch_updated_at();
