-- Unique indexes required for the rollup/baseline/score upserts to work
-- via onConflict 'user_id,date'. Without these, supabase-js upserts silently
-- fall back to inserts and you get duplicate rows per (user, date).

create unique index if not exists daily_nutrition_rollups_user_date_unique
  on public.daily_nutrition_rollups(user_id, date);

create unique index if not exists daily_baselines_user_date_unique
  on public.daily_baselines(user_id, date);

create unique index if not exists daily_scores_user_date_unique
  on public.daily_scores(user_id, date);

create unique index if not exists daily_subjective_rollups_user_date_unique
  on public.daily_subjective_rollups(user_id, date);

-- detected_patterns can have multiple rows per (user, date, pattern_type)
-- conceptually, but we want one canonical "current" row per type. Use a
-- partial unique index keyed on pattern_type so upserts work.
create unique index if not exists detected_patterns_user_date_type_unique
  on public.detected_patterns(user_id, date, pattern_type);

-- correlations are append-only by computed_at; no unique index needed.
