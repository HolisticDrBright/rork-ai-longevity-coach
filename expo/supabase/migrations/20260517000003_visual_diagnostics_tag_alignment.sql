-- ============================================================
-- Visual Diagnostics — tag namespace alignment (audit bug #1)
--
-- The skin analyzer prompt (skin-analysis-v1.ts §RECOMMENDATIONS)
-- instructs the LLM to emit `recommendation_finding_tags` drawn from
-- a canonical set: barrier_stress_high, hydration_low,
-- fine_lines_present, elasticity_low, redness_present, dullness_present,
-- pore_visibility_high, texture_irregular, pigmentation_present,
-- dark_circles_present, acne_active_present, sensitivity_high, oil_high,
-- uv_damage_signs, glycation_signs.
--
-- The initial seed (20260517000001) used a different namespace
-- (oxidative_stress, photodamage, pih, melasma, barrier_disruption,
-- dehydration, wrinkles, redness, rosacea, dullness, dry_skin,
-- clogged_pores, laxity, texture_rough, sensitive, lip_dryness, acne)
-- so the .overlaps('finding_tags', findingTags) join in
-- recommendation-service.ts returned ZERO rows for any analyzer output.
--
-- This migration:
--   1. Updates approved_products.finding_tags to use the canonical
--      prompt-side namespace (multi-tagged where appropriate).
--   2. Replaces recommendation_rules with rows keyed on the canonical
--      finding_tag values.
--
-- Re-runnable: products use UPDATE WHERE; rules use INSERT ... ON
-- CONFLICT (finding_tag) DO UPDATE after the unique constraint added
-- in 20260517000002.
-- ============================================================

-- ─── Product tag remap (UPDATE in place, keyed off old tags) ──
-- We use array operations to convert the old tag namespace to the new.
-- For products that haven't yet been seeded (or already use the new
-- namespace), these UPDATEs are no-ops.

-- Build a translation table once
create temporary table _tag_remap (old_tag text primary key, new_tags text[]) on commit drop;
insert into _tag_remap values
  ('oxidative_stress',    array['uv_damage_signs','glycation_signs']),
  ('photodamage',         array['uv_damage_signs']),
  ('pih',                 array['pigmentation_present']),
  ('melasma',             array['pigmentation_present']),
  ('barrier_disruption',  array['barrier_stress_high']),
  ('dehydration',         array['hydration_low']),
  ('wrinkles',            array['fine_lines_present','elasticity_low']),
  ('redness',             array['redness_present']),
  ('rosacea',             array['redness_present','sensitivity_high']),
  ('dullness',            array['dullness_present']),
  ('dry_skin',            array['hydration_low','sensitivity_high']),
  ('clogged_pores',       array['pore_visibility_high','oil_high']),
  ('laxity',              array['elasticity_low']),
  ('texture_rough',       array['texture_irregular']),
  ('sensitive',           array['sensitivity_high']),
  ('lip_dryness',         array['hydration_low']),
  ('acne',                array['acne_active_present']);

-- For each product, replace its finding_tags with the canonical mapping
-- (deduplicated). We do this row-by-row in a CTE so the array math is
-- explicit and re-runnable.
update public.approved_products p
set finding_tags = (
  select coalesce(array_agg(distinct new_tag order by new_tag), array[]::text[])
  from (
    -- Tags that already match the canonical set pass through
    select unnest(p.finding_tags) as new_tag
    where exists (
      select 1 from unnest(p.finding_tags) t
      where t in (
        'barrier_stress_high','hydration_low','fine_lines_present','elasticity_low',
        'redness_present','dullness_present','pore_visibility_high','texture_irregular',
        'pigmentation_present','dark_circles_present','acne_active_present',
        'sensitivity_high','oil_high','uv_damage_signs','glycation_signs'
      )
    )
    union
    -- Old tags map through _tag_remap
    select unnest(r.new_tags)
    from unnest(p.finding_tags) old_t
    join _tag_remap r on r.old_tag = old_t
  ) sub
)
where exists (
  select 1 from unnest(p.finding_tags) t
  where t in (select old_tag from _tag_remap)
     or t in (
       'barrier_stress_high','hydration_low','fine_lines_present','elasticity_low',
       'redness_present','dullness_present','pore_visibility_high','texture_irregular',
       'pigmentation_present','dark_circles_present','acne_active_present',
       'sensitivity_high','oil_high','uv_damage_signs','glycation_signs'
     )
);

-- ─── Rules remap (delete the old, insert the new canonical set) ──
-- The 20260517000002 migration adds a UNIQUE(finding_tag) constraint, so
-- this ON CONFLICT will actually fire on re-runs.
delete from public.recommendation_rules
where finding_tag in (
  'oxidative_stress','photodamage','pih','melasma','barrier_disruption',
  'dehydration','wrinkles','redness','rosacea','dullness','dry_skin',
  'clogged_pores','laxity','texture_rough','sensitive','lip_dryness','acne'
);

insert into public.recommendation_rules (
  finding_tag, primary_category, avoid_caution, example_copy_template, category_id
)
select
  r.finding_tag, r.primary_category, r.avoid_caution, r.example_copy_template, c.id
from (values
  ('barrier_stress_high', 'Barrier Repair', 'Pause exfoliants until barrier recovers (typically 2-4 weeks).',
   'Findings suggest the barrier appears stressed. A ceramide-rich repair moisturizer twice daily may support recovery. Discuss with Dr. Bright.'),
  ('hydration_low', 'Hydration Boost', 'Confirm cleanser is not stripping; check water intake.',
   'Findings consistent with surface dehydration. A hyaluronic-acid serum layered under your moisturizer may help. Discuss with your practitioner.'),
  ('fine_lines_present', 'Retinoid (Non-Pregnancy)', 'Hard contraindication: pregnancy, breastfeeding, active isotretinoin.',
   'Findings show fine lines. A nightly retinoid (non-pregnancy) can support cellular turnover. Discuss with Dr. Bright.'),
  ('elasticity_low', 'Retinoid (Non-Pregnancy)', 'Hard contraindication: pregnancy, breastfeeding.',
   'Findings consistent with reduced elasticity. A retinoid plus peptide-rich moisturizer may support firmness over time. Discuss with Dr. Bright.'),
  ('redness_present', 'Soothing / Anti-Redness', 'Patch test before broad use; avoid hot water.',
   'Findings consistent with visible redness. A soothing routine with ceramides and centella may support calmer skin. Discuss with your practitioner.'),
  ('dullness_present', 'Antioxidant Serum', 'Confirm exfoliation cadence is not excessive.',
   'Findings consistent with dullness. A morning antioxidant serum may support a brighter complexion. Discuss with your practitioner.'),
  ('pore_visibility_high', 'Antioxidant Serum', 'Confirm comedogenicity of current moisturizer/SPF.',
   'Findings consistent with visible pore congestion. A leave-on AHA/BHA serum two to three nights weekly may help. Discuss with your practitioner.'),
  ('texture_irregular', 'Retinoid (Non-Pregnancy)', 'Start every-third-night and titrate.',
   'Findings consistent with irregular texture. A nightly retinoid (non-pregnancy) can smooth texture over 8-12 weeks. Discuss with your practitioner.'),
  ('pigmentation_present', 'Pigment & Even Tone', 'Do not pair with high-strength retinoid until tolerated.',
   'Findings suggest visible pigmentation. Pigment-correcting serums and consistent SPF may help even tone over 8-12 weeks. Discuss with Dr. Bright.'),
  ('dark_circles_present', 'Hydration Boost', 'Check sleep and iron status with Dr. Bright if persistent.',
   'Findings consistent with under-eye darkness. A peptide eye serum plus addressing systemic factors (sleep, hydration) may help. Discuss with your practitioner.'),
  ('acne_active_present', 'Antioxidant Serum', 'Confirm non-comedogenic SPF and moisturizer.',
   'Findings consistent with active acne. A leave-on salicylic or mandelic serum may help; discuss prescription options with Dr. Bright.'),
  ('sensitivity_high', 'Soothing / Anti-Redness', 'Patch test new products on inner forearm 48 hours.',
   'Findings consistent with heightened sensitivity. A minimal soothing routine with ceramides is foundational. Discuss with Dr. Bright.'),
  ('oil_high', 'Antioxidant Serum', 'Avoid heavy occlusives; confirm non-comedogenic SPF.',
   'Findings consistent with high sebum production. A lightweight antioxidant serum plus oil-control routine may help. Discuss with your practitioner.'),
  ('uv_damage_signs', 'Daily SPF', 'Confirm broad-spectrum coverage; reapply every 2 hours outdoors.',
   'Patterns consistent with UV damage signs. Daily broad-spectrum SPF is foundational. Discuss the right formulation with your practitioner.'),
  ('glycation_signs', 'Antioxidant Serum', 'Avoid layering with high-% acids in same routine.',
   'Findings consistent with glycation-related dullness. A morning antioxidant serum may support the skin''s defense. Discuss with Dr. Bright.')
) as r(finding_tag, primary_category, avoid_caution, example_copy_template)
left join public.recommendation_categories c on c.category_name = r.primary_category
on conflict (finding_tag) do update set
  primary_category = excluded.primary_category,
  avoid_caution = excluded.avoid_caution,
  example_copy_template = excluded.example_copy_template,
  category_id = excluded.category_id;
