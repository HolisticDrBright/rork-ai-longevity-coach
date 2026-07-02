alter table public.profiles
  add column if not exists junction_user_id text;

create unique index if not exists profiles_junction_user_id_idx
  on public.profiles(junction_user_id)
  where junction_user_id is not null;
