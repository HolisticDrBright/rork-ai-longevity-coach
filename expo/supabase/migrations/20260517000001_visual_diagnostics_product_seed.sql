-- ============================================================
-- Visual Diagnostics: product DB seed (MVP catalog)
--
-- Seeds approved_brands, approved_products, recommendation_categories,
-- and recommendation_rules with a representative subset of Dr. Bright's
-- v2 product database. Enough breadth that the recommendation service
-- returns real products for every common skin finding tag emitted by
-- the analyzer, without trying to ingest the full Excel.
--
-- All seeded products are verification_level = 'verified'. The full
-- catalog ingest (driven by scripts/ingest-product-db.ts) will
-- progressively upgrade these to 'official' as Dr. Bright signs off.
--
-- Re-runnable via ON CONFLICT clauses + stable composite keys
-- (brand_name + product_name, category_name, finding_tag).
-- ============================================================

-- ─── Recommendation categories ──────────────────────────────
insert into public.recommendation_categories (id, category_name, best_use, core_products_summary)
values
  (gen_random_uuid(), 'Antioxidant Serum', 'Morning antioxidant protection against oxidative stress and photodamage.', 'L-ascorbic-acid + vitamin E + ferulic-acid serums.'),
  (gen_random_uuid(), 'Barrier Repair', 'Restore disrupted lipid barrier and reduce TEWL.', 'Ceramide-forward moisturizers, peptides, panthenol.'),
  (gen_random_uuid(), 'Daily SPF', 'Broad-spectrum UVA/UVB protection used daily.', 'Mineral and hybrid SPF 30-50 formulations.'),
  (gen_random_uuid(), 'Pigment & Even Tone', 'Address post-inflammatory hyperpigmentation and melasma.', 'Tyrosinase inhibitors, niacinamide, tranexamic acid.'),
  (gen_random_uuid(), 'Hydration Boost', 'Address dehydration and surface dryness.', 'Hyaluronic-acid and humectant serums.'),
  (gen_random_uuid(), 'Retinoid (Non-Pregnancy)', 'Cellular turnover, fine-line and texture support.', 'Retinol / retinaldehyde / prescription tretinoin (via MD/NP).'),
  (gen_random_uuid(), 'Soothing / Anti-Redness', 'Calm reactive or rosacea-prone skin.', 'Centella, azelaic acid <10%, niacinamide low %.'),
  (gen_random_uuid(), 'Gentle Cleanser', 'Daily non-stripping cleanse for sensitive or compromised skin.', 'Low-pH, fragrance-free cleansers.')
on conflict do nothing;

-- ─── Brands ──────────────────────────────────────────────────
insert into public.approved_brands (id, brand_name, status, coverage_tier)
values
  (gen_random_uuid(), 'SkinMedica', 'verified', 'tier_1'),
  (gen_random_uuid(), 'EltaMD', 'verified', 'tier_1'),
  (gen_random_uuid(), 'Skinceuticals', 'verified', 'tier_1'),
  (gen_random_uuid(), 'iS Clinical', 'verified', 'tier_1'),
  (gen_random_uuid(), 'Obagi', 'verified', 'tier_1'),
  (gen_random_uuid(), 'Alastin', 'verified', 'tier_1'),
  (gen_random_uuid(), 'Revision Skincare', 'verified', 'tier_1'),
  (gen_random_uuid(), 'CeraVe', 'verified', 'tier_2'),
  (gen_random_uuid(), 'La Roche-Posay', 'verified', 'tier_2'),
  (gen_random_uuid(), 'Avene', 'verified', 'tier_2')
on conflict do nothing;

-- ─── Products ────────────────────────────────────────────────
-- One INSERT per product, joining brand_id by brand_name and
-- recommendation_category_id by category_name. ON CONFLICT keyed off
-- the (brand_id, lower(product_name)) unique index.
insert into public.approved_products (
  brand_id, product_name, product_type, recommendation_category_id,
  actives_positioning, when_to_use, routine_slot, verification_level,
  source_url, exclusion_flags, finding_tags, best_skin_types, priority
)
select
  b.id, p.product_name, p.product_type, c.id,
  p.actives_positioning, p.when_to_use, p.routine_slot, 'verified',
  p.source_url, p.exclusion_flags, p.finding_tags, p.best_skin_types, p.priority
from (values
  -- Antioxidant Serum
  ('Skinceuticals', 'CE Ferulic', 'serum', 'Antioxidant Serum',
   '15% L-ascorbic acid + 1% vit E + 0.5% ferulic',
   'AM, after cleanse, before SPF', 'am_serum',
   'https://www.skinceuticals.com/skincare/serums/c-e-ferulic',
   ARRAY['active_eczema']::text[],
   ARRAY['oxidative_stress','photodamage','dullness']::text[],
   ARRAY['all']::text[], 1),
  ('Skinceuticals', 'Phloretin CF', 'serum', 'Antioxidant Serum',
   '10% L-ascorbic + 2% phloretin + 0.5% ferulic',
   'AM, oily/combination skin alternative to CE Ferulic', 'am_serum',
   'https://www.skinceuticals.com/skincare/serums/phloretin-cf',
   ARRAY['active_eczema']::text[],
   ARRAY['oxidative_stress','photodamage','pih']::text[],
   ARRAY['oily','combination']::text[], 2),
  ('Obagi', 'Professional-C Serum 20%', 'serum', 'Antioxidant Serum',
   '20% L-ascorbic acid',
   'AM, normal to oily skin', 'am_serum',
   'https://www.obagi.com/products/professional-c-serum-20',
   ARRAY['active_eczema','rosacea_active']::text[],
   ARRAY['oxidative_stress','dullness']::text[],
   ARRAY['oily','normal']::text[], 3),
  ('iS Clinical', 'Active Serum', 'serum', 'Antioxidant Serum',
   'Glycolic + salicylic + mandelic + bilberry',
   'AM or PM, oily/acne-prone', 'pm_serum',
   'https://isclinical.com/active-serum',
   ARRAY['pregnant','breastfeeding','active_eczema']::text[],
   ARRAY['oxidative_stress','pih','clogged_pores']::text[],
   ARRAY['oily','combination']::text[], 2),

  -- Barrier Repair
  ('SkinMedica', 'HA5 Rejuvenating Hydrator', 'moisturizer', 'Barrier Repair',
   'Multi-MW hyaluronic acid + VITISENSCE',
   'AM and PM, after serum', 'moisturizer',
   'https://www.skinmedica.com/ha5-rejuvenating-hydrator',
   ARRAY[]::text[],
   ARRAY['barrier_disruption','dehydration','wrinkles']::text[],
   ARRAY['all']::text[], 1),
  ('Alastin', 'Restorative Skin Complex', 'moisturizer', 'Barrier Repair',
   'TriHex Technology peptides, niacinamide',
   'AM and PM', 'moisturizer',
   'https://alastin.com/products/restorative-skin-complex',
   ARRAY[]::text[],
   ARRAY['barrier_disruption','laxity','wrinkles']::text[],
   ARRAY['all']::text[], 2),
  ('CeraVe', 'Moisturizing Cream', 'moisturizer', 'Barrier Repair',
   'Ceramides 1, 3, 6-II + hyaluronic acid',
   'AM and PM, dry skin', 'moisturizer',
   'https://www.cerave.com/skincare/moisturizers/moisturizing-cream',
   ARRAY[]::text[],
   ARRAY['barrier_disruption','dehydration','dry_skin']::text[],
   ARRAY['dry','sensitive','all']::text[], 3),

  -- Daily SPF
  ('EltaMD', 'UV Clear Broad-Spectrum SPF 46', 'sunscreen', 'Daily SPF',
   '9% zinc oxide + 7.5% octinoxate + niacinamide',
   'AM, last step before makeup', 'spf',
   'https://eltamd.com/products/uv-clear-broad-spectrum-spf-46',
   ARRAY[]::text[],
   ARRAY['photodamage','pih','rosacea','acne']::text[],
   ARRAY['oily','combination','sensitive','all']::text[], 1),
  ('EltaMD', 'UV Daily Tinted Broad-Spectrum SPF 40', 'sunscreen', 'Daily SPF',
   '9% zinc oxide + iron oxides (visible-light)',
   'AM, melasma/pigmentation patients', 'spf',
   'https://eltamd.com/products/uv-daily-tinted-broad-spectrum-spf-40',
   ARRAY[]::text[],
   ARRAY['photodamage','pih','melasma']::text[],
   ARRAY['all']::text[], 1),
  ('La Roche-Posay', 'Anthelios Mineral SPF 50', 'sunscreen', 'Daily SPF',
   'Titanium dioxide + zinc oxide',
   'AM, sensitive or post-procedure', 'spf',
   'https://www.laroche-posay.us/anthelios-mineral-sunscreen',
   ARRAY[]::text[],
   ARRAY['photodamage','rosacea','sensitive']::text[],
   ARRAY['sensitive','all']::text[], 2),

  -- Pigment & Even Tone
  ('SkinMedica', 'Lytera 2.0 Pigment Correcting Serum', 'serum', 'Pigment & Even Tone',
   'Tranexamic acid + niacinamide + phytic acid',
   'AM and PM, melasma/PIH', 'am_serum',
   'https://www.skinmedica.com/lytera-2-0-pigment-correcting-serum',
   ARRAY['pregnant','breastfeeding']::text[],
   ARRAY['pih','melasma','dullness']::text[],
   ARRAY['all']::text[], 1),
  ('Revision Skincare', 'Brightening Facial Wash', 'cleanser', 'Pigment & Even Tone',
   'Glycolic + lactic + arbutin + vitamin C',
   'AM, even tone over time', 'cleanser',
   'https://www.revisionskincare.com/brightening-facial-wash',
   ARRAY['pregnant','active_eczema']::text[],
   ARRAY['dullness','pih']::text[],
   ARRAY['oily','combination']::text[], 3),
  ('Obagi', 'Nu-Derm Clear FX', 'corrector', 'Pigment & Even Tone',
   '7% arbutin + antioxidants',
   'AM and PM, hyperpigmentation', 'pm_serum',
   'https://www.obagi.com/products/nu-derm-clear-fx',
   ARRAY['pregnant','breastfeeding']::text[],
   ARRAY['pih','melasma']::text[],
   ARRAY['all']::text[], 2),

  -- Hydration Boost
  ('SkinMedica', 'HA5 Smooth and Plump Lip System', 'lip', 'Hydration Boost',
   'Hyaluronic-acid lip complex',
   'AM and PM, dehydration', 'spot',
   'https://www.skinmedica.com/ha5-smooth-and-plump-lip-system',
   ARRAY[]::text[],
   ARRAY['dehydration','lip_dryness']::text[],
   ARRAY['all']::text[], 3),
  ('Skinceuticals', 'Hydrating B5 Gel', 'serum', 'Hydration Boost',
   'Hyaluronic acid + vit B5',
   'AM and PM, layer under moisturizer', 'am_serum',
   'https://www.skinceuticals.com/skincare/serums/hydrating-b5-gel',
   ARRAY[]::text[],
   ARRAY['dehydration','barrier_disruption']::text[],
   ARRAY['all']::text[], 1),

  -- Retinoid (Non-Pregnancy)
  ('SkinMedica', 'Retinol Complex 0.5', 'serum', 'Retinoid (Non-Pregnancy)',
   '0.5% retinol',
   'PM, every other night to start', 'pm_serum',
   'https://www.skinmedica.com/retinol-complex-0-5',
   ARRAY['pregnant','breastfeeding','isotretinoin_active']::text[],
   ARRAY['wrinkles','clogged_pores','texture_rough']::text[],
   ARRAY['oily','combination','normal']::text[], 1),
  ('Alastin', 'Renewal Retinol', 'serum', 'Retinoid (Non-Pregnancy)',
   'Encapsulated retinol + peptides + bakuchiol',
   'PM, gentler retinol alternative', 'pm_serum',
   'https://alastin.com/products/renewal-retinol',
   ARRAY['pregnant','breastfeeding','isotretinoin_active']::text[],
   ARRAY['wrinkles','laxity']::text[],
   ARRAY['sensitive','all']::text[], 2),

  -- Soothing / Anti-Redness
  ('Avene', 'Antirougeurs Calm Soothing Mask', 'mask', 'Soothing / Anti-Redness',
   'Thermal spring water + sweet almond oil',
   '2-3x weekly, redness flares', 'spot',
   'https://www.aveneusa.com/antirougeurs-calm-soothing-mask',
   ARRAY[]::text[],
   ARRAY['redness','rosacea','sensitive']::text[],
   ARRAY['sensitive','all']::text[], 2),
  ('La Roche-Posay', 'Toleriane Double Repair Face Moisturizer', 'moisturizer', 'Soothing / Anti-Redness',
   'Ceramides + niacinamide + prebiotic',
   'AM and PM, sensitive', 'moisturizer',
   'https://www.laroche-posay.us/toleriane-double-repair-face-moisturizer',
   ARRAY[]::text[],
   ARRAY['redness','barrier_disruption','sensitive']::text[],
   ARRAY['sensitive','all']::text[], 1),

  -- Gentle Cleanser
  ('CeraVe', 'Hydrating Cleanser', 'cleanser', 'Gentle Cleanser',
   'Ceramides + hyaluronic acid, non-foaming',
   'AM and PM, dry/sensitive', 'cleanser',
   'https://www.cerave.com/skincare/cleansers/hydrating-facial-cleanser',
   ARRAY[]::text[],
   ARRAY['dry_skin','barrier_disruption','sensitive']::text[],
   ARRAY['dry','sensitive','all']::text[], 1),
  ('La Roche-Posay', 'Toleriane Hydrating Gentle Cleanser', 'cleanser', 'Gentle Cleanser',
   'Niacinamide + ceramide + prebiotic',
   'AM and PM, normal to dry', 'cleanser',
   'https://www.laroche-posay.us/toleriane-hydrating-gentle-cleanser',
   ARRAY[]::text[],
   ARRAY['barrier_disruption','sensitive']::text[],
   ARRAY['all']::text[], 2)
) as p(brand_name, product_name, product_type, category_name,
        actives_positioning, when_to_use, routine_slot, source_url,
        exclusion_flags, finding_tags, best_skin_types, priority)
join public.approved_brands b on b.brand_name = p.brand_name
left join public.recommendation_categories c on c.category_name = p.category_name
on conflict (brand_id, lower(product_name)) do update set
  actives_positioning = excluded.actives_positioning,
  when_to_use = excluded.when_to_use,
  routine_slot = excluded.routine_slot,
  source_url = excluded.source_url,
  exclusion_flags = excluded.exclusion_flags,
  finding_tags = excluded.finding_tags,
  best_skin_types = excluded.best_skin_types,
  priority = excluded.priority,
  updated_at = now();

-- ─── Recommendation rules — one row per common finding tag ──
insert into public.recommendation_rules (
  finding_tag, primary_category, avoid_caution, example_copy_template, category_id
)
select
  r.finding_tag, r.primary_category, r.avoid_caution, r.example_copy_template, c.id
from (values
  ('oxidative_stress', 'Antioxidant Serum', 'Avoid layering with high-% acids in same routine.',
   'Findings consistent with oxidative stress and dullness. A morning antioxidant serum can support the skin''s defense against free radicals. Discuss with Dr. Bright.'),
  ('photodamage', 'Daily SPF', 'Confirm broad-spectrum coverage; reapply every 2 hours outdoors.',
   'Patterns consistent with photodamage. Daily broad-spectrum SPF is foundational. Discuss the right formulation with your practitioner.'),
  ('pih', 'Pigment & Even Tone', 'Do not pair with high-strength retinoid until tolerated.',
   'Findings suggest post-inflammatory pigmentation. Pigment-correcting serums and consistent SPF may help even tone over 8-12 weeks. Discuss with Dr. Bright.'),
  ('melasma', 'Pigment & Even Tone', 'Confirm pregnancy/lactation status before any tyrosinase inhibitor.',
   'Pattern consistent with melasma. Tinted mineral SPF plus a tranexamic-acid-based corrector may support gradual fading. Discuss with your practitioner.'),
  ('barrier_disruption', 'Barrier Repair', 'Pause exfoliants until barrier recovers (typically 2-4 weeks).',
   'Findings suggest barrier disruption. A ceramide-rich repair moisturizer twice daily may support recovery. Discuss with Dr. Bright.'),
  ('dehydration', 'Hydration Boost', 'Confirm cleanser is not stripping; check water intake.',
   'Findings consistent with surface dehydration. A hyaluronic-acid serum layered under your moisturizer may help. Discuss with your practitioner.'),
  ('wrinkles', 'Retinoid (Non-Pregnancy)', 'Hard contraindication: pregnancy, breastfeeding, active isotretinoin.',
   'Findings show fine lines and texture changes. A nightly retinoid (non-pregnancy) can support cellular turnover. Discuss with Dr. Bright.'),
  ('redness', 'Soothing / Anti-Redness', 'Patch test before broad use; avoid hot water.',
   'Findings consistent with reactive skin. A soothing routine with ceramides and centella may support calmer skin. Discuss with your practitioner.'),
  ('rosacea', 'Soothing / Anti-Redness', 'Avoid known triggers; mineral SPF only.',
   'Patterns consistent with rosacea-prone skin. Gentle non-foaming cleansing and mineral SPF are foundational. Discuss with Dr. Bright.'),
  ('dullness', 'Antioxidant Serum', 'Confirm exfoliation cadence is not excessive.',
   'Findings consistent with dullness. A morning antioxidant serum and gentle exfoliation may support a brighter complexion. Discuss with your practitioner.'),
  ('dry_skin', 'Gentle Cleanser', 'Avoid foaming cleansers and hot water.',
   'Findings consistent with dry skin. A non-foaming hydrating cleanser may reduce post-cleanse tightness. Discuss with Dr. Bright.'),
  ('clogged_pores', 'Antioxidant Serum', 'Confirm comedogenicity of current moisturizer/SPF.',
   'Findings consistent with congested pores. A leave-on AHA/BHA serum two to three nights weekly may help. Discuss with your practitioner.'),
  ('laxity', 'Retinoid (Non-Pregnancy)', 'Hard contraindication: pregnancy, breastfeeding.',
   'Findings consistent with mild laxity. A retinoid plus peptide-rich moisturizer may support firmness over time. Discuss with Dr. Bright.'),
  ('texture_rough', 'Retinoid (Non-Pregnancy)', 'Start every-third-night and titrate.',
   'Findings consistent with rough texture. A nightly retinoid (non-pregnancy) can smooth texture over 8-12 weeks. Discuss with your practitioner.'),
  ('sensitive', 'Soothing / Anti-Redness', 'Patch test new products on inner forearm 48 hours.',
   'Findings consistent with sensitive skin. A minimal soothing routine with ceramides is foundational. Discuss with Dr. Bright.'),
  ('lip_dryness', 'Hydration Boost', null,
   'Findings consistent with lip dehydration. A humectant-rich lip system may help. Discuss with your practitioner.'),
  ('acne', 'Antioxidant Serum', 'Confirm non-comedogenic SPF and moisturizer.',
   'Findings consistent with active acne. A leave-on salicylic or mandelic serum may help; discuss prescription options with Dr. Bright.')
) as r(finding_tag, primary_category, avoid_caution, example_copy_template)
left join public.recommendation_categories c on c.category_name = r.primary_category
on conflict do nothing;
