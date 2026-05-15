-- Staging table for chunked client uploads. The client breaks files into
-- small (~200KB raw, ~270KB base64) chunks because iOS networking
-- consistently throws NSPOSIXErrorDomain Code=40 "Message too long" for
-- single requests >~1MB. Each chunk is inserted as one row; the last chunk's
-- handler reassembles all rows for that upload_id, writes the assembled file
-- to lab-pdfs Storage, then deletes the chunk rows.
--
-- Lifecycle: rows live only as long as the upload is in progress. A
-- successful upload deletes its chunks immediately. A failed/abandoned
-- upload's chunks expire via the lifecycle policy below.

create table if not exists public.lab_upload_chunks (
  upload_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index int not null,
  total_chunks int not null,
  file_name text not null,
  mime_type text not null,
  base64_data text not null,
  created_at timestamptz not null default now(),
  primary key (upload_id, chunk_index)
);

create index if not exists lab_upload_chunks_user_upload_idx
  on public.lab_upload_chunks(user_id, upload_id);

create index if not exists lab_upload_chunks_created_at_idx
  on public.lab_upload_chunks(created_at);

alter table public.lab_upload_chunks enable row level security;

drop policy if exists "lab_upload_chunks_owner_select" on public.lab_upload_chunks;
create policy "lab_upload_chunks_owner_select"
  on public.lab_upload_chunks for select
  to authenticated
  using (user_id = auth.uid());

-- The lab-upload edge function uses the service role and bypasses RLS, so
-- no INSERT / DELETE policies are required for it. The client never writes
-- directly; it only calls the edge function.
