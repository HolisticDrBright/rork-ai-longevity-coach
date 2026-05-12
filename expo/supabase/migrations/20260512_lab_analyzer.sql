-- Lab analyzer: storage bucket for raw PDFs/images + job table tracking
-- async Textract + GPT enrichment processing.

-- ============================================================
-- 1. Storage bucket for lab PDFs and images
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lab-pdfs',
  'lab-pdfs',
  false,
  52428800, -- 50 MB
  array['application/pdf','image/jpeg','image/png','image/jpg']
)
on conflict (id) do nothing;

-- Storage RLS: a user can only touch objects under their own user_id folder.
-- Path convention: {user_id}/{uuid}.{ext}
drop policy if exists "lab_pdfs_user_read" on storage.objects;
create policy "lab_pdfs_user_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lab-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "lab_pdfs_user_insert" on storage.objects;
create policy "lab_pdfs_user_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'lab-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "lab_pdfs_user_delete" on storage.objects;
create policy "lab_pdfs_user_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'lab-pdfs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 2. lab_analysis_jobs table
-- ============================================================
create table if not exists public.lab_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  clinic_document_id uuid null, -- optional link to clinic_lab_documents.id
  storage_path text not null,
  file_name text not null,
  file_type text not null check (file_type in ('pdf','jpg','png')),
  status text not null default 'pending'
    check (status in ('pending','extracting','enriching','complete','failed')),
  error text null,

  -- Outputs (populated as the job progresses)
  biomarkers_json jsonb null,
  supplements_json jsonb null,
  herbs_json jsonb null,
  priority_actions_json jsonb null,
  analysis_text text null,
  textract_raw_json jsonb null, -- kept for debugging; can be nulled out after success

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists lab_analysis_jobs_user_id_idx on public.lab_analysis_jobs(user_id);
create index if not exists lab_analysis_jobs_status_idx on public.lab_analysis_jobs(status);
create index if not exists lab_analysis_jobs_clinic_document_id_idx on public.lab_analysis_jobs(clinic_document_id);

-- Touch updated_at on every update
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

-- ============================================================
-- 3. RLS on lab_analysis_jobs
-- ============================================================
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

drop policy if exists "lab_analysis_jobs_owner_delete" on public.lab_analysis_jobs;
create policy "lab_analysis_jobs_owner_delete"
  on public.lab_analysis_jobs for delete
  to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- 4. Realtime: let the client subscribe to its own job rows
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lab_analysis_jobs'
  ) then
    alter publication supabase_realtime add table public.lab_analysis_jobs;
  end if;
end$$;
