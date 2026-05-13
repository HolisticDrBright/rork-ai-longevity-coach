-- Daily coach: data-driven contraindication rules + audit trail for the
-- unified-context recommendation engine.

-- ============================================================
-- 1. supplement_contraindication_rules (reference data)
-- ============================================================
create table if not exists public.supplement_contraindication_rules (
  id uuid primary key default gen_random_uuid(),
  supplement_name text not null,
  rule_type text not null check (rule_type in (
    'pregnancy', 'nursing', 'sex', 'age', 'condition',
    'medication', 'biomarker_high', 'biomarker_low', 'symptom_pattern'
  )),
  rule_value jsonb not null default '{}'::jsonb,
  severity text not null check (severity in ('block', 'caution')),
  reason text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scr_supplement_idx on public.supplement_contraindication_rules(supplement_name);
create index if not exists scr_rule_type_idx on public.supplement_contraindication_rules(rule_type);

alter table public.supplement_contraindication_rules enable row level security;

drop policy if exists "scr_read_authenticated" on public.supplement_contraindication_rules;
create policy "scr_read_authenticated"
  on public.supplement_contraindication_rules for select
  to authenticated
  using (true);

-- ============================================================
-- 2. coach_run_logs (audit trail)
-- ============================================================
create table if not exists public.coach_run_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  daily_recommendation_id uuid null references public.daily_recommendations(id) on delete set null,
  context_snapshot jsonb not null,
  safety_gates_triggered jsonb not null default '[]'::jsonb,
  llm_response_raw jsonb null,
  duration_ms int null,
  model_used text null,
  status text not null default 'success' check (status in ('success', 'failed', 'partial')),
  error text null,
  created_at timestamptz not null default now()
);

create index if not exists coach_run_logs_user_date_idx on public.coach_run_logs(user_id, date desc);
create index if not exists coach_run_logs_created_at_idx on public.coach_run_logs(created_at desc);

alter table public.coach_run_logs enable row level security;

drop policy if exists "coach_run_logs_owner_select" on public.coach_run_logs;
create policy "coach_run_logs_owner_select"
  on public.coach_run_logs for select
  to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- 3. Indexes the daily-coach aggregator depends on
-- ============================================================
-- Note: lab_analysis_jobs index removed - table does not exist in current schema.
-- Add it back once that table is created.

create index if not exists symptom_logs_user_logged_idx
  on public.symptom_logs(user_id, logged_at desc);

create index if not exists daily_biometric_records_user_date_idx
  on public.daily_biometric_records(user_id, date desc);

create index if not exists daily_nutrition_rollups_user_date_idx
  on public.daily_nutrition_rollups(user_id, date desc);

create index if not exists meal_logs_user_meal_time_idx
  on public.meal_logs(user_id, meal_time desc);

create index if not exists daily_recommendations_user_date_idx
  on public.daily_recommendations(user_id, date desc);

-- ============================================================
-- 4. Seed: common contraindication rules
-- ============================================================
insert into public.supplement_contraindication_rules
  (supplement_name, rule_type, rule_value, severity, reason)
values
  -- Pregnancy blocks
  ('DHEA', 'pregnancy', '{}', 'block', 'Steroid hormone precursor; contraindicated in pregnancy.'),
  ('Pregnenolone', 'pregnancy', '{}', 'block', 'Hormone precursor; contraindicated in pregnancy.'),
  ('DIM (Diindolylmethane)', 'pregnancy', '{}', 'block', 'Modulates estrogen metabolism; not for pregnancy.'),
  ('Calcium D-Glucarate', 'pregnancy', '{}', 'caution', 'Limited safety data in pregnancy.'),
  ('Vitex (Chaste Tree)', 'pregnancy', '{}', 'block', 'Affects prolactin/LH; not for pregnancy.'),
  ('Berberine', 'pregnancy', '{}', 'block', 'May stimulate uterine contractions; can displace bilirubin.'),
  ('Black Cohosh', 'pregnancy', '{}', 'block', 'Hormonal effects; contraindicated in pregnancy.'),
  ('Ashwagandha', 'pregnancy', '{}', 'block', 'Traditionally abortifacient at high doses.'),
  ('Rhodiola', 'pregnancy', '{}', 'caution', 'Insufficient data in pregnancy.'),
  ('Tribulus', 'pregnancy', '{}', 'block', 'Hormonal effects.'),
  ('High-dose Vitamin A (>10,000 IU)', 'pregnancy', '{}', 'block', 'Teratogenic above ~10,000 IU/day.'),
  ('Liver Sauce (Quicksilver Scientific)', 'pregnancy', '{}', 'caution', 'Contains herbs not validated in pregnancy.'),
  ('NAC 900+ (Healthgevity)', 'pregnancy', '{}', 'caution', 'Use only under practitioner supervision in pregnancy.'),
  ('Adrenal Restore (Healthgevity)', 'pregnancy', '{}', 'block', 'Contains adaptogens contraindicated in pregnancy.'),

  -- Nursing
  ('DHEA', 'nursing', '{}', 'block', 'Steroid hormones pass into breastmilk.'),
  ('Pregnenolone', 'nursing', '{}', 'block', 'Hormone precursor; passes into breastmilk.'),
  ('Vitex (Chaste Tree)', 'nursing', '{}', 'block', 'Suppresses prolactin; reduces milk supply.'),
  ('Sage (high dose)', 'nursing', '{}', 'block', 'Reduces milk supply.'),

  -- Sex-specific
  ('Vitex (Chaste Tree)', 'sex', '{"sex":"male"}', 'caution', 'Primarily indicated for female cycling.'),
  ('DIM (Diindolylmethane)', 'sex', '{"sex":"male"}', 'caution', 'Use carefully in males due to estrogen modulation.'),
  ('Tribulus', 'sex', '{"sex":"female"}', 'caution', 'Androgenic effects may not be desired in females.'),

  -- Age
  ('Ashwagandha', 'age', '{"max_age":18}', 'caution', 'Limited pediatric safety data for adaptogens.'),
  ('Rhodiola', 'age', '{"max_age":18}', 'caution', 'Limited pediatric safety data.'),
  ('DHEA', 'age', '{"max_age":18}', 'block', 'Hormone supplementation contraindicated in minors.'),
  ('Pregnenolone', 'age', '{"max_age":18}', 'block', 'Hormone supplementation contraindicated in minors.'),
  ('Adrenal Restore (Healthgevity)', 'age', '{"max_age":18}', 'caution', 'Adaptogen blend not validated in minors.'),

  -- Biomarker-driven
  ('DHEA', 'biomarker_high', '{"name":"DHEA-S","threshold":350,"unit":"ug/dL"}', 'block',
    'DHEA-S already elevated; further DHEA supplementation would push higher.'),
  ('DHEA', 'biomarker_high', '{"name":"Testosterone","threshold":900,"unit":"ng/dL","sex":"male"}', 'caution',
    'Testosterone already elevated; DHEA may push further.'),
  ('DHEA', 'biomarker_high', '{"name":"Testosterone","threshold":70,"unit":"ng/dL","sex":"female"}', 'caution',
    'Female testosterone already elevated; DHEA may push further.'),
  ('Tribulus', 'biomarker_high', '{"name":"Testosterone","threshold":900,"unit":"ng/dL","sex":"male"}', 'block',
    'Testosterone already elevated; androgenic herbs contraindicated.'),
  ('Iron', 'biomarker_high', '{"name":"Ferritin","threshold":300,"unit":"ng/mL"}', 'block',
    'Ferritin already elevated; iron supplementation contraindicated.'),
  ('Vitamin D3', 'biomarker_high', '{"name":"Vitamin D, 25-OH","threshold":80,"unit":"ng/mL"}', 'block',
    'Vitamin D already in upper range; avoid further supplementation.'),
  ('High-dose Niacin', 'biomarker_high', '{"name":"ALT","threshold":60,"unit":"U/L"}', 'caution',
    'Hepatic enzyme elevation; high-dose niacin may worsen.'),
  ('Berberine', 'biomarker_low', '{"name":"Glucose","threshold":70,"unit":"mg/dL"}', 'caution',
    'Glucose already low; further lowering risks hypoglycemia.'),

  -- Medication interactions
  ('Berberine', 'medication', '{"contains":["metformin"]}', 'caution',
    'Additive glucose-lowering effect; monitor closely.'),
  ('St. Johns Wort', 'medication', '{"contains":["ssri","sertraline","fluoxetine","escitalopram","paroxetine"]}', 'block',
    'Serotonin syndrome risk with SSRIs.'),
  ('Vitamin K2', 'medication', '{"contains":["warfarin","coumadin"]}', 'block',
    'Antagonizes warfarin anticoagulation.'),
  ('Fish Oil (ProOmega 2000)', 'medication', '{"contains":["warfarin","coumadin","apixaban","rivaroxaban"]}', 'caution',
    'Additive anticoagulant effect; monitor.'),

  -- Symptom-pattern (your DHEA-when-androgenic-symptoms example)
  ('DHEA', 'symptom_pattern', '{"any_of":["acne","hirsutism","male_pattern_hair_loss","jaw_acne","oily_skin","facial hair growth","hair loss"]}', 'caution',
    'Symptoms consistent with elevated androgens; DHEA may worsen.'),
  ('Tribulus', 'symptom_pattern', '{"any_of":["acne","hirsutism","male_pattern_hair_loss","oily_skin","facial hair growth"]}', 'caution',
    'Symptoms consistent with elevated androgens; androgenic herbs may worsen.'),
  ('High-dose Iodine', 'symptom_pattern', '{"any_of":["heart_palpitations","heat_intolerance","unexplained_weight_loss"]}', 'caution',
    'Symptoms suggest possible hyperthyroid pattern; iodine may worsen.')
on conflict do nothing;

create or replace function public.scr_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists scr_touch_updated_at on public.supplement_contraindication_rules;
create trigger scr_touch_updated_at
  before update on public.supplement_contraindication_rules
  for each row execute function public.scr_touch_updated_at();
