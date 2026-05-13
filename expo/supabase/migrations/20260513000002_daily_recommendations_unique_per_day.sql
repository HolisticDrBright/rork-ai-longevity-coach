-- One coach output per user per day. Required for the daily-coach edge
-- function's upsert with onConflict: 'user_id,date'.
--
-- If this fails because duplicate (user_id, date) rows already exist,
-- deduplicate first by keeping the most recent row per pair:
--   delete from public.daily_recommendations a using public.daily_recommendations b
--   where a.user_id = b.user_id and a.date = b.date and a.created_at < b.created_at;
create unique index if not exists daily_recommendations_user_date_unique
  on public.daily_recommendations(user_id, date);
