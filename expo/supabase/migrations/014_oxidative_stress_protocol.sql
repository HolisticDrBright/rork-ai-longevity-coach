-- Migration 014: Oxidative Stress Biomarkers & SNPs Protocol
-- Creates reference tables for oxidative stress biomarkers and related SNPs

-- ============================================================
-- Table 1: Oxidative Stress Biomarkers
-- ============================================================

CREATE TABLE IF NOT EXISTS public.oxidative_stress_biomarkers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  biomarker_name text NOT NULL UNIQUE,
  what_it_measures text NOT NULL,
  nutrient_supplement_support text NOT NULL,
  recommended_dosing text,
  supportive_tests text[],
  lifestyle_factors text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.oxidative_stress_biomarkers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read oxidative stress biomarkers"
  ON public.oxidative_stress_biomarkers FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage oxidative stress biomarkers"
  ON public.oxidative_stress_biomarkers FOR ALL
  USING (public.is_admin());

CREATE INDEX idx_oxidative_stress_name ON public.oxidative_stress_biomarkers(biomarker_name);

-- Seed all 16 oxidative stress biomarkers
INSERT INTO public.oxidative_stress_biomarkers
  (biomarker_name, what_it_measures, nutrient_supplement_support, recommended_dosing, supportive_tests, lifestyle_factors)
VALUES
  (
    'Malondialdehyde (MDA)',
    'Lipid peroxidation due to reactive oxygen species (ROS); associated with Alzheimer''s disease, cardiovascular disease, and liver diseases.',
    'Magnesium, Vitamin E, Olive Oil, Melatonin, Vitamin C, Beta Carotene, Selenium, Glutathione, Grape Seed, Green Tea Extract, Neem, Curcumin, Holy Basil, Ashwagandha',
    '200-400 mg Magnesium; 400 IU Vitamin E; 500 mg Vitamin C; 200 mcg Selenium',
    ARRAY['Lipid Panel', 'Inflammatory Markers (CRP)'],
    'Anti-inflammatory diet, avoid processed foods, moderate exercise'
  ),
  (
    'Glutathione 4-Hydroxynonenal (GSH-4-HNE)',
    'Detoxifies 4-HNE, an aldehyde that mediates lipid peroxidation.',
    'Vitamin C, Carnosine, Quercetin, Tea Catechins, Anthocyanins, Vitamin E, Beta-Carotene, Lutein, Selenium, Manganese, Glutathione, Grape Seed, Green Tea Extract, Scutellaria baicalensis, Korean Red Ginseng, Curcumin, Ashwagandha',
    '500 mg Vitamin C; 10 mg Lutein; 200 mg Glutathione',
    ARRAY['LFTs', 'Lipid Panel'],
    'Limit alcohol, balanced diet rich in antioxidants'
  ),
  (
    '8-iso-Prostaglandin F2α (8-iso-PGF2α)',
    'Lipid peroxidation and DNA oxidative damage; associated with aging and cardiovascular disease.',
    'Vitamin E, Lycopene, Beta-Carotene, Selenium, Vitamin C, Omega-3 Fatty Acids',
    '400 IU Vitamin E; 1-3 g Omega-3s',
    ARRAY['Urinary Isoprostanes', 'CRP'],
    'Avoid smoking, manage stress, reduce toxin exposure'
  ),
  (
    '11-β-Prostaglandin F2α (11-PGF2α)',
    'Oxidation of arachidonic acid; associated with inflammation and cardiovascular disease.',
    'Omega-3 Fatty Acids',
    '1-3 g Omega-3s daily',
    ARRAY['CRP', 'ESR'],
    'Anti-inflammatory diet, reduce processed fats'
  ),
  (
    '15(R)-Prostaglandin F2α (15-F2t-IsoP)',
    'Lipid peroxidation and oxidative DNA damage; associated with aging, hypertension, and diabetes.',
    'Omega-3 Fatty Acids',
    '1-3 g Omega-3s daily',
    ARRAY['Lipid Panel', 'Blood Pressure'],
    'Healthy fats, avoid processed foods'
  ),
  (
    '8-Hydroxy-2''-Deoxyguanosine (8-OHdG)',
    'DNA oxidative damage; associated with cancer and atherosclerosis risk.',
    'Alpha Tocopherol, Garlic Extract, CoQ10, Red Yeast Rice-Olive Extract, Resveratrol, Curcumin, Vitamin C, Creatine',
    '500 mg Vitamin C; 100 mg CoQ10',
    ARRAY['Toxic Burden'],
    'Avoid tobacco, minimize pollutants'
  ),
  (
    '8-Hydroxyguanine (8-OHG)',
    'Oxidative RNA damage; associated with aging and neurodegeneration.',
    'Selenium',
    '200 mcg daily',
    ARRAY['Toxic Burden'],
    'Avoid smoking, balanced diet'
  ),
  (
    '8-Hydroxyguanosine (8-HdG)',
    'Oxidative RNA damage with high mutagenic potential.',
    'Tart Cherry Juice',
    '1 cup daily',
    ARRAY['Toxic Burden'],
    'Balanced diet, avoid processed foods'
  ),
  (
    'Dityrosine',
    'Protein oxidation; associated with inflammation and atherosclerosis.',
    'NAC',
    '600-1200 mg NAC',
    ARRAY['Protein Oxidation Tests'],
    'Limit processed foods, reduce toxin exposure'
  ),
  (
    '3-Bromotyrosine',
    'Eosinophil activation and immune-driven oxidative stress.',
    'Vitamin C',
    '500-1000 mg daily',
    ARRAY['CBC with differential', 'Eosinophil count'],
    'Minimize allergen exposure'
  ),
  (
    '3-Chlorotyrosine',
    'MPO-induced oxidative stress; associated with inflammation and atherosclerosis.',
    'Vitamin C',
    '500-1000 mg daily',
    ARRAY['MPO Activity Test'],
    'Avoid smoking, antioxidant diet'
  ),
  (
    '8-Nitroguanosine (8-NdG)',
    'RNA oxidative marker due to reactive nitrogen species (RNS); associated with inflammation and genetic mutations.',
    'L-Glutathione',
    '200-500 mg daily',
    ARRAY['Nitric Oxide Levels', 'Inflammatory Markers'],
    'Limit processed meats, anti-inflammatory diet'
  ),
  (
    '8-Nitroguanine (8-NO2-G)',
    'DNA nitrative stress; associated with neurodegeneration and cardiovascular disease.',
    'Curcumin, Dihydrolipoic Acid, NAC, Folic Acid',
    '500 mg Curcumin; 600 mg NAC',
    ARRAY['DNA Damage Tests', 'Urinary 8-NO2-G'],
    'Anti-inflammatory diet, reduce stress'
  ),
  (
    'Nitrotyrosine',
    'Protein modification due to reactive nitrogen species (RNS); associated with aging and inflammatory diseases.',
    'Resveratrol, Vitamin C, Vitamin E, Tetrahydrobiopterin, L-Arginine',
    '500 mg Vitamin C; 100 mg Resveratrol',
    ARRAY['Inflammatory Markers', 'Nitrative Stress'],
    'Avoid smoking, stress management'
  ),
  (
    'Nε-(Carboxymethyl)-Lysine (CML)',
    'Advanced glycation end product (AGE) marker; associated with oxidative stress and inflammation.',
    'EGCG, Quercetin, Alpha Lipoic Acid, Vitamin D',
    '500 mg Quercetin; 300 mg Alpha Lipoic Acid',
    ARRAY['HbA1c', 'Blood Sugar'],
    'Low-sugar diet, avoid processed carbs, exercise'
  ),
  (
    'Nε-(Carboxyethyl)-Lysine (CEL)',
    'Advanced glycation end product (AGE) marker; associated with oxidative stress and cellular dysfunction.',
    'Taurine',
    '500 mg Taurine',
    ARRAY['HbA1c', 'Blood Sugar'],
    'Low-sugar diet, exercise, stress management'
  )
ON CONFLICT (biomarker_name) DO NOTHING;

-- ============================================================
-- Table 2: Oxidative Stress SNPs
-- ============================================================

CREATE TABLE IF NOT EXISTS public.oxidative_stress_snps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gene_name text NOT NULL,
  full_gene_name text,
  wild_type text NOT NULL,
  heterozygous_variant text NOT NULL,
  homozygous_variant text NOT NULL,
  nutrient_support text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(gene_name)
);

ALTER TABLE public.oxidative_stress_snps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read oxidative stress SNPs"
  ON public.oxidative_stress_snps FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage oxidative stress SNPs"
  ON public.oxidative_stress_snps FOR ALL
  USING (public.is_admin());

CREATE INDEX idx_oxidative_stress_snps_gene ON public.oxidative_stress_snps(gene_name);

-- Seed all 24 oxidative stress SNPs
INSERT INTO public.oxidative_stress_snps
  (gene_name, full_gene_name, wild_type, heterozygous_variant, homozygous_variant, nutrient_support)
VALUES
  (
    'CAT',
    'Catalase',
    'AA/CC',
    'AT/CT',
    'TT',
    'Alpha Lipoic Acid, Vitamin D3, Vitamin E, CoQ10, Vitamin C, Vitamin A, Selenium, Manganese'
  ),
  (
    'COX-2',
    'Cyclooxygenase-2',
    'CC',
    'CG',
    'GG',
    'Vitamin D, Pycnogenol, Beta-Carotene, Quercetin'
  ),
  (
    'CYB5R3',
    'Cytochrome b5 Reductase 3',
    'GG',
    'AG',
    'AA',
    'Vitamin C, Glutathione'
  ),
  (
    'CYBA',
    'Cytochrome b-245 alpha chain',
    'TT/GG',
    'CT',
    'CC/AA',
    'Alpha Lipoic Acid, Quercetin, Epicatechin, Catechin, Myricetin, Red Grape Juice, Dealcoholised Red Wine'
  ),
  (
    'CYP1A1',
    'Cytochrome P450 1A1',
    'GG',
    'GA',
    'AA',
    'Indole-3-Carbinol, Soy Bean, Green Tea, Curcumin, Garlic, Fish Oil, Rosemary, Astaxanthin'
  ),
  (
    'GLUL',
    'Glutamate-Ammonia Ligase',
    'CC',
    'CT',
    'TT',
    'Vitamin C, Glutathione, Alpha Lipoic Acid'
  ),
  (
    'GPX1',
    'Glutathione Peroxidase 1',
    'CC',
    'CT',
    'TT',
    'Selenium, Vitamin D, Vitamin C, Lutein, Aged Garlic Extract'
  ),
  (
    'GPX2',
    'Glutathione Peroxidase 2',
    'CC',
    'CT',
    'TT',
    'Selenium, Vitamin D, Vitamin C, Lutein'
  ),
  (
    'GPX4',
    'Glutathione Peroxidase 4',
    'CT/TT',
    'CT',
    'TT',
    'Selenium, Glutathione'
  ),
  (
    'GSR',
    'Glutathione Reductase',
    'CC',
    'CT',
    'TT',
    'Vitamin C, Glutathione, Selenium'
  ),
  (
    'GSS',
    'Glutathione Synthetase',
    'TT',
    'TC',
    'CC',
    'Curcumin, Ellagic Acid, Garlic, Glutathione, Selenium, Vitamin C, Vitamin E, Alpha Lipoic Acid'
  ),
  (
    'GSTM1',
    'Glutathione S-Transferase M1',
    'TT',
    'CC',
    'CC',
    'Broccoli Extract, SAMe, Pomegranate-Black Carrot Juice, Grape Pomace Extract'
  ),
  (
    'GSTM5',
    'Glutathione S-Transferase M5',
    'TT',
    'GT',
    'GG',
    'Broccoli Extract, SAMe, Pomegranate-Black Carrot Juice, Grape Pomace Extract'
  ),
  (
    'GSTP1',
    'Glutathione S-Transferase Pi 1',
    'AA',
    'AG',
    'GG',
    'Broccoli Extract, SAMe, Pomegranate-Black Carrot Juice, Grape Pomace Extract'
  ),
  (
    'HMOX1',
    'Heme Oxygenase-1',
    'AA',
    'AT',
    'TT',
    'Vitamin C, Vitamin E, Curcumin'
  ),
  (
    'SOD1',
    'Superoxide Dismutase 1',
    'AA',
    'AC',
    'CC',
    'Resveratrol, Aged Garlic Extract, Extra Virgin Olive Oil'
  ),
  (
    'SOD2',
    'Superoxide Dismutase 2',
    'CC',
    'CT',
    'TT',
    'Copper, Vitamin E, Vitamin D3, Vitamin C, Selenium, Manganese, Green Tea Extract, CoQ10, Curcumin, NAC'
  ),
  (
    'SOD3',
    'Superoxide Dismutase 3',
    'CC/GG',
    'CG/GT',
    'GG',
    'Copper, Vitamin E, Vitamin D3, Vitamin C, Selenium, Manganese, Green Tea Extract, CoQ10, Curcumin, NAC'
  ),
  (
    'PRKAA2',
    'Protein Kinase AMP-Activated Catalytic Subunit Alpha 2',
    'AA',
    'AG',
    'GG',
    'Folate, Alpha-Lipoic Acid, Magnesium, Vitamin C'
  ),
  (
    'SELENOP',
    'Selenoprotein P',
    'CC',
    'CT',
    'TT',
    'Selenium, Selenomethionine'
  ),
  (
    'TrxR2',
    'Thioredoxin Reductase 2',
    'TT',
    'CT',
    'CC',
    'Selenomethionine'
  ),
  (
    'TXNRD1',
    'Thioredoxin Reductase 1',
    'CC',
    'CA',
    'AA',
    'Quercetin, Selenomethionine'
  ),
  (
    'TXNRD2',
    'Thioredoxin Reductase 2',
    'TT',
    'CT',
    'CC',
    'Quercetin, Selenomethionine'
  ),
  (
    'XDH',
    'Xanthine Dehydrogenase',
    'GG/TT',
    'AG/TC',
    'CC',
    'Quercetin, Papaya'
  )
ON CONFLICT (gene_name) DO NOTHING;
