-- ============================================================
-- Clinical Protocol Decision Engine
-- 4-level supplement logic + 15 condition-specific protocols
-- ============================================================

-- Protocol levels (foundational → optimization progression)
CREATE TABLE IF NOT EXISTS public.protocol_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level integer NOT NULL CHECK (level >= 1 AND level <= 4),
  level_name text NOT NULL,
  description text NOT NULL,
  prerequisites text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(level)
);

ALTER TABLE public.protocol_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read protocol levels" ON public.protocol_levels FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins manage protocol levels" ON public.protocol_levels FOR ALL USING (public.is_admin());

INSERT INTO public.protocol_levels (level, level_name, description, prerequisites) VALUES
(1, 'Foundational', 'Base nutrient coverage: MitoCore, Protect+10, Fish oil, Magnesium. Start here before adding anything else.', NULL),
(2, 'Terrain Correction', 'Address the dominant pattern: inflammation, detox burden, gut dysfunction, blood sugar. Add Resolve+, Ignite+, NAC, glutathione, colostrum, liver/bile support based on findings.', 'Level 1 established for 2+ weeks'),
(3, 'Driver-Specific Support', 'Target the root cause: mold, Lyme, parasites, hormones, blood sugar, metals, viral load. Use targeted antimicrobials, binders, hormone support.', 'Level 2 terrain correction underway'),
(4, 'Optimization', 'Longevity and performance: Prime Time+, Urolithin A, mitochondrial support, peptides, hormone refinement. Only when foundation is solid.', 'Levels 1-3 addressed, symptoms stabilizing')
ON CONFLICT (level) DO NOTHING;

-- Condition-specific clinical protocols
CREATE TABLE IF NOT EXISTS public.clinical_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  use_when text NOT NULL,
  products jsonb NOT NULL DEFAULT '[]',
  decision_logic jsonb NOT NULL DEFAULT '[]',
  notes text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.clinical_protocols ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read clinical protocols" ON public.clinical_protocols FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins manage clinical protocols" ON public.clinical_protocols FOR ALL USING (public.is_admin());
CREATE INDEX idx_clinical_protocols_name ON public.clinical_protocols(protocol_name);

-- Anchor product mapping (which product leads for which concern)
CREATE TABLE IF NOT EXISTS public.anchor_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concern text NOT NULL UNIQUE,
  anchor_product text NOT NULL,
  description text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.anchor_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read anchor products" ON public.anchor_products FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins manage anchor products" ON public.anchor_products FOR ALL USING (public.is_admin());

-- Seed anchor products
INSERT INTO public.anchor_products (concern, anchor_product, description) VALUES
('blood_sugar_weight', 'Ignite+', 'Lead product for glucose control, fat oxidation, weight loss resistance'),
('inflammation_pain_autoimmune', 'Resolve+', 'Core inflammatory-control formula for joint pain, tissue irritation, inflammaging'),
('micronutrient_mitochondrial_base', 'MitoCore', 'Comprehensive multinutrient foundation with mitochondrial support'),
('immune_fat_soluble_vitamins', 'Protect+10', 'Vitamin D/K2/A/E backbone for immune resilience'),
('oxidative_stress_detox', 'NAC 900 + Transdermal Glutathione', 'First-line antioxidant and detox support'),
('gut_barrier_resilience', 'bioREPAIR (Colostrum)', 'Gut barrier repair, immune globulins, mucosal immunity'),
('mitochondrial_upgrade', 'Urolithin A / MitoBlue / Prime Time+', 'Advanced mitochondrial support, mitophagy, longevity signaling'),
('hormone_optimization', 'Core Hormone Support / DHEA', 'Only after sleep, blood sugar, inflammation, and detox are addressed')
ON CONFLICT (concern) DO NOTHING;

-- Seed all 15 clinical protocols
INSERT INTO public.clinical_protocols (protocol_name, display_name, use_when, sort_order, products, decision_logic) VALUES

('gallbladder_function', 'Gallbladder Function', 'Nausea after fats, floating stools, right upper quadrant fullness, bloating after meals, constipation with sluggish bile, chemical sensitivity, poor toxin clearance', 1,
'[{"name":"Tudca Ox+BILE","role":"Sluggish bile that needs a push","level":2},{"name":"Taurine","role":"Bile acid conjugation support","level":2},{"name":"BitterX","role":"First-line when fats feel heavy","level":2},{"name":"Liver Sauce","role":"When bile is sluggish and detox burden is high","level":2},{"name":"NAC 900","role":"When gallbladder dysfunction overlaps with toxic burden","level":2},{"name":"Transdermal Glutathione","role":"When toxic burden is driving symptoms","level":2},{"name":"Magnesium","role":"Foundational support","level":1}]'::jsonb,
'[{"condition":"fats_feel_heavy","first_choice":"BitterX"},{"condition":"sluggish_bile_needs_push","first_choice":"Tudca Ox+BILE"},{"condition":"bile_sluggish_high_detox","first_choice":"Liver Sauce"},{"condition":"toxic_burden_overlap","add":"NAC 900 + Glutathione"},{"condition":"active_antimicrobial","note":"Hold heavy antimicrobial pushes until bile flow is better"}]'::jsonb),

('leaky_gut', 'Leaky Gut', 'Food reactions, bloating, loose stools, skin flares, autoimmunity overlap, post-antibiotic issues, mold history', 2,
'[{"name":"GI Revive Powder","role":"Basic leaky gut, post-antibiotic repair","level":2},{"name":"GlutaShield","role":"Leaky gut with inflammation, toxic + inflamed gut","level":2},{"name":"Gut Feeling","role":"Mold/MCAS/immune dysregulation, chronic weird symptoms","level":3},{"name":"Ultimate GI Repair","role":"Athlete/recovery, longevity/optimization phase","level":2},{"name":"Resolve+","role":"When gut inflammation is obvious","level":2},{"name":"bioREPAIR","role":"When barrier support is the main need","level":2},{"name":"NAC 900","role":"When driven by mold, chemicals, or chronic inflammation","level":2},{"name":"Magnesium","role":"If constipated or tense","level":1}]'::jsonb,
'[{"use_case":"basic_leaky_gut","best":"GI Revive Powder"},{"use_case":"leaky_gut_inflammation","best":"GlutaShield"},{"use_case":"mold_mcas_immune","best":"Gut Feeling"},{"use_case":"athlete_recovery_mild","best":"Ultimate GI Repair"},{"use_case":"chronic_weird_symptoms","best":"Gut Feeling"},{"use_case":"post_antibiotic_simple","best":"GI Revive Powder"},{"use_case":"toxic_inflamed_gut","best":"GlutaShield"},{"use_case":"longevity_optimization","best":"Ultimate GI Repair"}]'::jsonb),

('blood_sugar', 'Blood Sugar Dysregulation', 'Cravings, belly fat, afternoon crashes, elevated fasting glucose/insulin, weight loss resistance, nocturnal waking from cortisol/glucose instability', 3,
'[{"name":"Ignite+","role":"Lead product: glucose control + fat oxidation. Contains DNF peptide for appetite","level":2},{"name":"GlycoPrime","role":"Stronger insulin/glucose reduction without appetite peptide","level":2},{"name":"Pro Omega 2000","role":"Membrane and eicosanoid support","level":1},{"name":"Magnesium","role":"When insulin resistance, poor sleep, constipation travel together","level":1},{"name":"Protect+10","role":"If vitamin D is low","level":1},{"name":"Prime Time+","role":"When stable enough for longevity optimization, not symptom firefighting","level":4}]'::jsonb,
'[{"condition":"glucose_control_fat_loss","first_choice":"Ignite+"},{"condition":"stronger_insulin_reduction","first_choice":"GlycoPrime"},{"condition":"stable_longevity_phase","add":"Prime Time+"},{"peptide":"Retatrutide","note":"GLP-3 peptide for blood sugar"},{"peptide":"MOTSc","note":"Mitochondrial peptide for blood sugar"}]'::jsonb),

('adrenal_fatigue', 'Adrenal Fatigue / Stress Burnout', 'Wired-but-tired, poor recovery, overwhelm, afternoon crashes, reliance on caffeine, low stress tolerance', 4,
'[{"name":"MitoCore","role":"Baseline: micronutrient + mitochondrial + nervous system depletion","level":1},{"name":"Protect+10","role":"Foundational immune/vitamin support","level":1},{"name":"Magnesium","role":"Evening for nervous system regulation","level":1},{"name":"Regenzyme Adrenal","role":"Stronger glandular support to boost energy. Avoid if anxiety","level":2},{"name":"Cortisol Manager","role":"At night to reduce cortisol spikes","level":2},{"name":"Pure DHEA","role":"Only when real androgen/adrenal depletion confirmed","level":3},{"name":"Urolithin A","role":"When not just stressed but flat","level":4},{"name":"MB MitoBlue","role":"When mitochondrial dysfunction is part of burnout","level":4}]'::jsonb,
'[{"condition":"baseline_burnout","first_choice":"MitoCore"},{"condition":"real_adrenal_depletion","add":"Pure DHEA","note":"Only with labs/symptoms"},{"condition":"has_anxiety","avoid":"Regenzyme Adrenal"},{"condition":"not_just_stressed_but_flat","add":"Urolithin A or MitoBlue"}]'::jsonb),

('hormonal_imbalance', 'Hormonal Imbalance', 'Cycle symptoms, low libido, poor recovery, PMS, estrogen detox issues, low drive, poor muscle retention, hair/skin changes', 5,
'[{"name":"Core Hormone Support","role":"Women entering perimenopause. DHEA + pregnenolone + adaptogens","level":3},{"name":"Bi-Est+","role":"When low estrogens across the board","level":3},{"name":"Pro Estradiol","role":"When low estradiol specifically","level":3},{"name":"Pro Estriol+","role":"When low estriol specifically","level":3},{"name":"dailyDIM+","role":"DIM + Calcium D-Glucarate + Sulforaphane for estrogen dominance","level":2},{"name":"MitoCore","role":"Foundational","level":1},{"name":"Protect+10","role":"Vitamin D support for hormone optimization","level":1},{"name":"Magnesium","role":"Foundational","level":1},{"name":"Liver Sauce","role":"When estrogen dominance or poor detox pattern","level":2},{"name":"Ignite+","role":"When hormonal imbalance is downstream of blood sugar dysfunction","level":2}]'::jsonb,
'[{"condition":"perimenopause","first_choice":"Core Hormone Support + Bi-Est+"},{"condition":"low_estradiol","first_choice":"Pro Estradiol"},{"condition":"low_estriol","first_choice":"Pro Estriol+"},{"condition":"estrogen_dominance","first_choice":"dailyDIM+"},{"condition":"poor_estrogen_clearance","add":"Liver Sauce"},{"condition":"blood_sugar_driven","add":"Ignite+"}]'::jsonb),

('autoimmunity', 'Autoimmunity', 'Flare cycles, multiple inflammatory symptoms, gut involvement, thyroid antibodies, joint pain, reactivity', 6,
'[{"name":"MitoCore","role":"Foundational","level":1},{"name":"Resolve+","role":"Core inflammatory-control","level":2},{"name":"BPC + PEA","role":"Reduce inflammation and histamine upstream","level":2},{"name":"Hista-Aid","role":"Contains DAO enzyme for gut histamine breakdown","level":2},{"name":"D-Hist","role":"Break down environmental histamine","level":2},{"name":"Pro Omega 2000","role":"Foundational omega-3","level":1},{"name":"Protect+10","role":"Immune support backbone","level":1},{"name":"bioREPAIR","role":"If gut barrier is involved","level":2},{"name":"NAC 900","role":"If toxic burden is driving flares","level":2},{"name":"Transdermal Glutathione","role":"If mold/metals/chemical stress perpetuating flares","level":2}]'::jsonb,
'[{"condition":"environmental_histamine","first_choice":"D-Hist"},{"condition":"gut_histamine","first_choice":"Hista-Aid"},{"condition":"upstream_inflammation","first_choice":"BPC + PEA"},{"condition":"gut_barrier_involved","add":"bioREPAIR"},{"condition":"toxic_burden_driver","add":"NAC + Glutathione"},{"note":"Remove triggers before overbuilding the stack"}]'::jsonb),

('parasites', 'Parasites', 'Unexplained GI issues, eosinophil patterns, travel history, food reactivity, itching, anemia patterns, intermittent bowel changes', 7,
'[{"name":"Para 1 + Para 2 (CellCore)","role":"Month 1 for adults with Biotoxin Binder. Order at cellcore.com with code HQ91SbRn","level":3},{"name":"Para 3 + Para 4 (CellCore)","role":"Month 2 for adults with Biotoxin Binder. Order at cellcore.com with code HQ91SbRn","level":3},{"name":"Biotoxin Binder (CellCore)","role":"Concurrent with kill phase. Order at cellcore.com with code HQ91SbRn","level":3},{"name":"NDF Happy","role":"First choice for pediatric parasite support","level":3},{"name":"Microbe Slayer","role":"Pediatric antimicrobial alternative","level":3},{"name":"NAC 900","role":"If tolerated during kill phase","level":2},{"name":"Transdermal Glutathione","role":"Detox support during kill phase","level":2}]'::jsonb,
'[{"phase":"month_1_adults","use":"Para 1 + Para 2 + Biotoxin Binder"},{"phase":"month_2_adults","use":"Para 3 + Para 4 + Biotoxin Binder"},{"phase":"pediatric","use":"NDF Happy or Microbe Slayer"},{"condition":"constipated","note":"Do not overdo binders too early"},{"condition":"post_kill","note":"Gut repair comes AFTER reduction of burden, not before"},{"condition":"iron_depletion","note":"Iron-building support may be necessary after parasite burden"}]'::jsonb),

('lyme_disease', 'Lyme Disease / Chronic Vector-Borne', 'Migrating symptoms, neuro symptoms, fatigue, pain, cognitive impairment, autonomic dysfunction', 8,
'[{"name":"Crypto Co-Max","role":"Kills Lyme bacteria","level":3},{"name":"Immune Rmor","role":"Boost immune system","level":2},{"name":"Japanese Knotweed","role":"Anti-Lyme botanical","level":3},{"name":"NAC 900","role":"Oxidative stress and toxic burden","level":2},{"name":"Transdermal Glutathione","role":"Detox support","level":2},{"name":"Resolve+","role":"For inflammatory load","level":2},{"name":"MitoCore","role":"Foundational — chronic infections hammer mitochondria","level":1},{"name":"Biotoxin Binder","role":"Detox/binder as tolerated","level":3}]'::jsonb,
'[{"condition":"active_lyme","first_choice":"Crypto Co-Max + Immune Rmor"},{"condition":"inflammatory_load","add":"Resolve+"},{"condition":"oxidative_stress","add":"NAC + Glutathione"},{"condition":"low_energy","add":"Mitochondrial support"},{"note":"Chronic infections often hammer mitochondria hard"}]'::jsonb),

('emf_sensitivity', 'EMF Sensitivity', 'Headaches, wired feeling, palpitations, sleep disruption, brain fog, symptom worsening in high-device environments', 9,
'[{"name":"Leela Quantum Technology","role":"EMF mitigation device","level":2},{"name":"MitoCore","role":"Foundational","level":1},{"name":"Magnesium","role":"Quickest support for nervous-system reactivity","level":1},{"name":"Pro Omega 2000","role":"Membrane support","level":1},{"name":"NAC 900","role":"When oxidative stress is part of symptom pattern","level":2},{"name":"Transdermal Glutathione","role":"Antioxidant support","level":2}]'::jsonb,
'[{"condition":"nervous_reactivity","first_choice":"Magnesium"},{"condition":"oxidative_stress_pattern","add":"NAC + Glutathione"},{"condition":"fatigue_cognitive_drag","add":"Mitochondrial support"}]'::jsonb),

('mold_toxicity', 'Mold Toxicity', 'Sinus issues, fatigue, brain fog, MCAS-like symptoms, chemical sensitivity, static shocks, weird reactivity, stubborn inflammation', 10,
'[{"name":"MitoCore","role":"Foundational","level":1},{"name":"NAC 900","role":"First-line terrain support","level":2},{"name":"Transdermal Glutathione","role":"First-line cellular detox","level":2},{"name":"Ultra Binder","role":"Essential when recirculation is part of the picture","level":2},{"name":"Carboxy (CellCore)","role":"Humic/fulvic binding. Order at cellcore.com with code HQ91SbRn","level":2},{"name":"Liver Sauce","role":"Opens liver and gallbladder to release toxins","level":2},{"name":"Resolve+","role":"If inflammatory symptoms are loud","level":2},{"name":"Pro Omega 2000","role":"Anti-inflammatory support","level":1},{"name":"bioREPAIR","role":"If gut is weak","level":2},{"name":"LymphActive (CellCore)","role":"Move stagnant lymph. Order at cellcore.com with code HQ91SbRn","level":3},{"name":"Drainage Activator (CellCore)","role":"Open drainage pathways. Order at cellcore.com with code HQ91SbRn","level":3}]'::jsonb,
'[{"condition":"first_line","use":"NAC + Glutathione"},{"condition":"recirculation","add":"Ultra Binder or Carboxy"},{"condition":"liver_gallbladder","add":"Liver Sauce"},{"condition":"stagnant_lymph","add":"LymphActive + Drainage Activator (CellCore, code HQ91SbRn)"},{"condition":"loud_inflammation","add":"Resolve+"},{"note":"Do NOT jump into aggressive longevity stack while still drowning in mold burden"}]'::jsonb),

('methylation', 'Methylation Dysfunction', 'High homocysteine tendencies, poor detox tolerance, anxiety with supplements, sluggish energy, neurotransmitter fragility', 11,
'[{"name":"InspiraCell","role":"Base methylation support (priority 1)","level":2},{"name":"Homocysteine Supreme","role":"Alternative methylation support (priority 2)","level":2},{"name":"SAMe or TMG","role":"Additional methyl donor support","level":3},{"name":"Magnesium","role":"Foundational cofactor","level":1},{"name":"NAC 900","role":"Carefully if sulfur handling is sensitive","level":2},{"name":"Transdermal Glutathione","role":"Based on tolerance","level":2},{"name":"Mineral 650","role":"Mineral repletion","level":1}]'::jsonb,
'[{"condition":"baseline","first_choice":"InspiraCell or Homocysteine Supreme"},{"condition":"sensitive_patient","note":"Start low, go slow with methyl support"},{"condition":"sulfur_sensitive","note":"NAC/glutathione useful but not everyone tolerates at first"},{"note":"Do not overmethylate fast in sensitive people"}]'::jsonb),

('bladder_ic', 'Bladder Congestion / Interstitial Cystitis', 'Urinary frequency, bladder irritation, pelvic irritation, symptom flares from stress, foods, chemicals, mold', 12,
'[{"name":"Cir-Q Tonic","role":"Kidney, bladder, and circulation support","level":2},{"name":"Resolve+","role":"When bladder picture is inflammatory","level":2},{"name":"Magnesium","role":"When pelvic tension is part of symptom loop","level":1},{"name":"Pro Omega 2000","role":"Anti-inflammatory support","level":1}]'::jsonb,
'[{"condition":"inflammatory_bladder","first_choice":"Resolve+"},{"condition":"pelvic_tension","add":"Magnesium"},{"condition":"broader_inflammatory_terrain","add":"Toxin/mold support"}]'::jsonb),

('ebv_chronic_virus', 'EBV / Chronic Viruses', 'Post-viral fatigue, swollen glands history, flares under stress, low stamina, recurrent malaise', 13,
'[{"name":"Immune Rmor","role":"Boosts immune system","level":2},{"name":"Cat''s Claw V-Max","role":"Antiviral botanical","level":3},{"name":"Protect+10","role":"Immune-support backbone","level":1},{"name":"NAC 900","role":"Oxidative stress and recovery","level":2},{"name":"Transdermal Glutathione","role":"Cellular recovery","level":2},{"name":"Pro Omega 2000","role":"Anti-inflammatory","level":1},{"name":"Resolve+","role":"If inflamed","level":2},{"name":"Urolithin A","role":"Mitochondrial support for chronic viral patterns","level":4}]'::jsonb,
'[{"condition":"active_viral","first_choice":"Immune Rmor + Cat''s Claw V-Max"},{"condition":"immune_backbone","add":"Protect+10"},{"condition":"oxidative_stress","add":"NAC + Glutathione"},{"note":"Chronic viral patterns often leave a mitochondrial signature"}]'::jsonb),

('heavy_metals', 'Heavy Metals', 'Neuro symptoms, detox intolerance, chemical sensitivity, mitochondrial dysfunction, unexplained inflammation', 14,
'[{"name":"MitoCore","role":"Foundational","level":1},{"name":"NAC 900","role":"Cellular detox support","level":2},{"name":"Transdermal Glutathione","role":"Cellular detox","level":2},{"name":"Liposomal EDTA","role":"Heavy metal binding (Quicksilver)","level":3},{"name":"Ultra Binder","role":"Keep symptoms from rebounding","level":2},{"name":"Liver Sauce","role":"Clear liver and gallbladder of toxins","level":2},{"name":"Mineral 650","role":"Mineral repletion before and during detox","level":1},{"name":"Magnesium","role":"Foundational","level":1},{"name":"Pro Omega 2000","role":"Anti-inflammatory","level":1}]'::jsonb,
'[{"condition":"cellular_detox","first_choice":"Transdermal Glutathione + Glutathione Complex"},{"condition":"liver_clearance","add":"Liver Sauce"},{"condition":"heavy_metal_binding","add":"Liposomal EDTA"},{"condition":"symptom_rebound","add":"Ultra Binder"},{"note":"Mineral repletion matters before and during detox"},{"note":"NAC/glutathione good support but not enough alone"}]'::jsonb),

('mitochondrial_dysfunction', 'Mitochondrial Dysfunction / Energy Production', 'Fatigue, poor exercise recovery, brain fog, weak stress resilience, low drive, aging support, post-infectious energy loss', 15,
'[{"name":"MitoCore","role":"Base nutrient coverage","level":1},{"name":"Urolithin A","role":"When recovery and cellular energy are main target","level":4},{"name":"MB MitoBlue","role":"Advanced mitochondrial electron transport support","level":4},{"name":"NAC 900","role":"Oxidative stress support","level":2},{"name":"Transdermal Glutathione","role":"Antioxidant support","level":2},{"name":"Pro Omega 2000","role":"Membrane support","level":1},{"name":"Prime Time+","role":"When longevity/mitophagy signaling is goal, not acute symptoms","level":4},{"name":"Ignite+","role":"When mitochondria impaired partly because glucose handling is poor","level":2}]'::jsonb,
'[{"condition":"baseline","first_choice":"MitoCore"},{"condition":"glucose_driven_mito","add":"Ignite+"},{"condition":"recovery_energy_target","add":"Urolithin A"},{"condition":"longevity_signaling","add":"Prime Time+"},{"note":"Urolithin A for cellular energy, Prime Time+ for longevity/mitophagy signaling"}]'::jsonb)

ON CONFLICT (protocol_name) DO NOTHING;
