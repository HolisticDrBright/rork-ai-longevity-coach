-- OAT (Organic Acid Test) Interpretation Protocol
-- ~84 biomarker interpretations across 6 categories

CREATE TABLE IF NOT EXISTS public.oat_biomarker_interpretations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  biomarker_name text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('high', 'low')),
  category text NOT NULL CHECK (category IN (
    'energy_metabolism', 'nutrition_oxalates', 'detoxification_oxidative_stress',
    'amino_acids', 'neurotransmitters', 'microbial'
  )),
  clinical_significance text NOT NULL,
  lifestyle_recommendations text NOT NULL,
  supplement_protocol text NOT NULL,
  additional_considerations text,
  recommended_lab_followup text[],
  clinical_pearl text NOT NULL,
  microbial_classification text CHECK (microbial_classification IN ('mold', 'fungal', 'bacterial', 'clostridia')),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(biomarker_name, direction)
);

ALTER TABLE public.oat_biomarker_interpretations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read OAT" ON public.oat_biomarker_interpretations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins manage OAT" ON public.oat_biomarker_interpretations FOR ALL USING (public.is_admin());
CREATE INDEX idx_oat_name ON public.oat_biomarker_interpretations(biomarker_name);
CREATE INDEX idx_oat_cat ON public.oat_biomarker_interpretations(category);

-- Energy Metabolism
INSERT INTO public.oat_biomarker_interpretations (biomarker_name,direction,category,clinical_significance,lifestyle_recommendations,supplement_protocol,additional_considerations,recommended_lab_followup,clinical_pearl) VALUES
('Pyruvic Acid','high','energy_metabolism','Mitochondrial dysfunction, nutrient deficiencies, liver dysfunction, metabolic acidosis','Nutrient-dense diet, low-glycemic index diet, limit alcohol','B-complex vitamins, alpha-lipoic acid, magnesium','Mitochondrial cofactor support',ARRAY['Micronutrient testing','Gut health assessment','Heavy metal testing'],'Indicates compromised energy production at the cellular level'),
('Lactic Acid','high','energy_metabolism','Lactic acidosis, hypoxia, mitochondrial disorders, severe infections','Assess oxygenation, low-glycemic diet','CoQ10, magnesium, alpha-lipoic acid','Evaluate oxygenation status',ARRAY['Micronutrient testing','Mitochondrial function','Infections'],'Reflects inadequate aerobic metabolism and tissue oxygenation'),
('Citric Acid','high','energy_metabolism','Oxidative stress, iron deficiency, glutathione insufficiency','Antioxidant-rich diet, limit foods with added citric acid','Glutathione, antioxidants','Screen for iron status',ARRAY['Oxidative stress markers','Heavy metal panels'],'Accumulation suggests blocked Krebs cycle and antioxidant depletion'),
('Cis-Aconitic Acid','low','energy_metabolism','Mitochondrial dysfunction, impaired aconitase activity','Antioxidant-rich diet, support mitochondrial function','Iron, antioxidants','Assess iron-dependent enzyme activity',ARRAY['Micronutrient testing','Mitochondrial panels'],'Low levels indicate aconitase enzyme impairment'),
('Cis-Aconitic Acid','high','energy_metabolism','Iron deficiency, oxidative stress, heavy metal toxicity','Support glutathione, iron, reduce oxidative stress','Iron, glutathione','Rule out heavy metal toxicity',ARRAY['Oxidative stress markers','Heavy metal panels'],'Reflects iron-dependent enzyme dysfunction'),
('Alpha-Ketoglutaric Acid','high','energy_metabolism','Liver dysfunction, renal dysfunction, oxidative stress','Nutrient-dense diet, avoid alcohol','B-complex vitamins, alpha-lipoic acid, magnesium','Support phase 1 detoxification',ARRAY['CMP','Micronutrient testing','Neurotransmitter panels'],'Krebs cycle stagnation and impaired oxidative capacity'),
('Succinic Acid','high','energy_metabolism','Inflammatory diseases, mitochondrial dysfunction, gut dysbiosis','Support oxygenation, assess gut health','CoQ10, B2, iron','Microbiome assessment essential',ARRAY['Gut microbiome panels','Oxidative stress testing'],'Linked to dysbiosis and impaired electron transport chain'),
('Fumaric Acid','high','energy_metabolism','Immune activation, metabolic disorders, oxidative stress','Nutrient-dense diet, reduce inflammation','Antioxidants, anti-inflammatory agents','Assess immune activation status',ARRAY['Inflammatory markers','Microbiome panels'],'Krebs cycle dysregulation and systemic inflammation'),
('Malic Acid','low','energy_metabolism','Mitochondrial dysfunction, nutrient deficiencies','Assess mitochondrial health, optimize nutrient intake','Vitamin B3, magnesium','Evaluate energy production capacity',ARRAY['Mitochondrial function tests','Nutrient panels'],'Impaired ATP production and energy crisis'),
('Malic Acid','high','energy_metabolism','Gut dysbiosis, vitamin B3 deficiency, fungal production','Assess gut microbiome, balance macronutrients','Vitamin B3, probiotics','Investigate fungal overgrowth',ARRAY['Gut microbiome testing','Fungal panels'],'Dysbiosis-driven metabolite production'),
('Adipic Acid','low','energy_metabolism','Inherited metabolic disorders, inadequate nutrient intake','Assess inherited conditions','Carnitine, B2','Consider genetic testing',ARRAY['Genetic testing','Metabolic disorder panels'],'Fatty acid oxidation pathway deficiency'),
('Adipic Acid','high','energy_metabolism','Carnitine deficiency, mitochondrial dysfunction','Optimize carnitine levels, balance fat intake','Carnitine, riboflavin','Assess fatty acid metabolism',ARRAY['Micronutrient tests','Gut health panels'],'Impaired beta-oxidation and carnitine insufficiency'),
('Ethylmalonic Acid','low','energy_metabolism','Enzyme deficiencies, metabolic disorders','Balance diet, assess enzyme activity','Assess butyrate levels, optimize carnitine','Investigate specific enzyme defects',ARRAY['Enzyme activity panels','Genetic testing'],'Butyrate production impairment'),
('Ethylmalonic Acid','high','energy_metabolism','Ethylmalonic acidemia, gut dysbiosis, carnitine deficiency','Optimize gut health','Carnitine, riboflavin','Evaluate dysbiosis severity',ARRAY['Microbiome panels','Heavy metal testing'],'Microbial-derived; indicates dysbiosis'),
('3-Hydroxybutyric Acid','high','energy_metabolism','Prolonged fasting, ketogenic diet, inborn errors of metabolism','Balance macronutrients','Carnitine, assess oxidative stress','Evaluate ketone metabolism',ARRAY['Gut health panels','Oxidative stress markers'],'Inappropriate ketone elevation or metabolic disorder'),
('Methylsuccinic Acid','low','energy_metabolism','Insufficient metabolic activity or enzyme deficiency','Support mitochondrial function','Relevant cofactors based on context','May indicate normal variation',ARRAY['Metabolic panel assessment'],'Clinical significance requires contextual interpretation'),
('Methylsuccinic Acid','high','energy_metabolism','Ethylmalonic encephalopathy, type 2 diabetes','Optimize energy balance, manage diabetes','N-acetylcysteine, riboflavin','Screen for metabolic diseases',ARRAY['Glucose tolerance','Genetic testing'],'Strong association with metabolic and neurological dysfunction'),
('Sebacic Acid','high','energy_metabolism','MADD, peroxisomal disorders, ALD','Optimize mitochondrial function','Carnitine','Serious metabolic disorder marker',ARRAY['CMP','Genetic testing'],'Severe fatty acid oxidation impairment'),
('3-Hydroxyglutaric Acid','high','energy_metabolism','Type 1 glutaric aciduria, mitochondrial dysfunction','Low-protein diet, assess mitochondrial health','Carnitine','Neurometabolic disorder consideration',ARRAY['Micronutrient panels','Mitochondrial panels'],'Severe protein/amino acid metabolism disorder'),
('3-Methylglutaconic Acid','high','energy_metabolism','3MGA aciduria, mitochondrial disorders','Limit leucine, support mitochondrial function','Carnitine','Genetic metabolic disorder',ARRAY['Genetic testing','Metabolic panels'],'Branched-chain amino acid oxidation defect'),
('3-Methylglutaric Acid','high','energy_metabolism','Metabolic disorders, mitochondrial dysfunction','Limit leucine, optimize mitochondrial health','Carnitine','Evaluate HMG-CoA lyase activity',ARRAY['Mitochondrial panels','Nutrient testing'],'Defects in ketone body synthesis')
ON CONFLICT (biomarker_name, direction) DO NOTHING;

-- Nutrition & Oxalates
INSERT INTO public.oat_biomarker_interpretations (biomarker_name,direction,category,clinical_significance,lifestyle_recommendations,supplement_protocol,additional_considerations,recommended_lab_followup,clinical_pearl) VALUES
('Pyridoxic Acid','low','nutrition_oxalates','Vitamin B6 deficiency, impaired metabolism','Increase B6-rich foods','Vitamin B6 (pyridoxine)','Address malabsorption',ARRAY['Nutrient panels','Gut health testing'],'Insufficient vitamin B6 intake or metabolism'),
('Pyridoxic Acid','high','nutrition_oxalates','High B6 intake, renal insufficiency','Reduce B6 supplementation','None specific','Evaluate renal function',ARRAY['Renal function tests','Inflammation markers'],'Excessive catabolism or kidney dysfunction'),
('Ascorbic Acid','low','nutrition_oxalates','Vitamin C deficiency, poor antioxidant defenses','Increase vitamin C-rich foods','Vitamin C','Assess for chronic stress',ARRAY['Antioxidant panels'],'Reduced antioxidant protection and immune support'),
('Ascorbic Acid','high','nutrition_oxalates','Excessive vitamin C, stress, kidney dysfunction','Reassess supplementation','None specific','Monitor kidney health',ARRAY['Kidney function panels'],'Paired with elevated oxalic acid suggests oxalate formation'),
('Oxalic Acid','high','nutrition_oxalates','Kidney stones, oxalate-rich diet, fungal overgrowth','Avoid high-oxalate foods, increase hydration','Calcium citrate, magnesium citrate','Address fungal overgrowth',ARRAY['Stool testing','Fungal markers'],'Paired with succinic acid suggests fungal contributions'),
('Methylmalonic Acid','high','nutrition_oxalates','Vitamin B12 deficiency, methylation defects','Address B12 status with methylcobalamin','Vitamin B12','Evaluate methylation pathways',ARRAY['Methylation panel','B12 levels'],'Sensitive marker for B12 deficiency'),
('Methylcitric Acid','high','nutrition_oxalates','Propionic acidemia, biotin deficiency','Ensure adequate biotin','Biotin','Evaluate enzyme function',ARRAY['Genetic testing for organic acidemia'],'Propionyl-CoA metabolism dysfunction'),
('Uracil','high','nutrition_oxalates','Folate cycle disruption','Increase folate-rich foods','Folate, B12','Evaluate for MTHFR mutations',ARRAY['Methylation testing'],'Folate cycle dysfunction affecting DNA synthesis'),
('Glutaric Acid','high','nutrition_oxalates','Impaired lysine metabolism, mitochondrial dysfunction','Reduce lysine intake','Carnitine','Investigate metabolic conditions',ARRAY['Mitochondrial function tests'],'Disruptions in mitochondrial energy production')
ON CONFLICT (biomarker_name, direction) DO NOTHING;

-- Detoxification & Oxidative Stress
INSERT INTO public.oat_biomarker_interpretations (biomarker_name,direction,category,clinical_significance,lifestyle_recommendations,supplement_protocol,additional_considerations,recommended_lab_followup,clinical_pearl) VALUES
('Mandelic Acid','high','detoxification_oxidative_stress','Exposure to environmental toxins like styrene','Reduce exposure to solvents, increase water','Glutathione, NAC','Evaluate detoxification pathways',ARRAY['Environmental toxin panels','Liver function tests'],'Reflects solvent exposure, particularly styrene'),
('Mandelic Acid','low','detoxification_oxidative_stress','Insufficient metabolism or poor detoxification','Support detoxification pathways','NAC, glutathione precursors','Assess liver detox markers',ARRAY['Liver function tests','Detox pathway panels'],'Poor enzymatic activity in phase 1 detoxification'),
('2-Hydroxybutyric Acid','high','detoxification_oxidative_stress','Oxidative stress, transsulfuration pathway dysfunction','Support sulfur metabolism','NAC, alpha-lipoic acid','Check for metabolic disorders affecting cysteine',ARRAY['Sulfur metabolism','Oxidative stress markers'],'Transsulfuration pathway overload'),
('Orotic Acid','high','detoxification_oxidative_stress','Impaired urea cycle, high ammonia, liver dysfunction','Reduce dietary protein','L-arginine, L-citrulline','Assess liver and kidney function',ARRAY['Ammonia levels','Urea cycle enzyme testing'],'Associated with urea cycle disorders or ammonia overload')
ON CONFLICT (biomarker_name, direction) DO NOTHING;

-- Amino Acids
INSERT INTO public.oat_biomarker_interpretations (biomarker_name,direction,category,clinical_significance,lifestyle_recommendations,supplement_protocol,additional_considerations,recommended_lab_followup,clinical_pearl) VALUES
('2-Hydroxyisocaproic Acid','high','amino_acids','Exercise/fasting factors, MSUD, fermented foods','Evaluate leucine intake, exercise, fasting','BCKDH cofactors (B1, B2, B3, B5, ALA, Mg)','Assess gut dysbiosis',ARRAY['Micronutrient test','Genetic testing'],'May be linked to MSUD or high fermented food intake'),
('N-Acetylaspartic Acid','high','amino_acids','Canavan Disease, neuronal dysfunction','Limit aspartic acid intake','None specific','Evaluate neurological and cancer markers',ARRAY['Genetic testing for Canavan Disease'],'Indicates neuronal damage or Canavan Disease'),
('Malonic Acid','high','amino_acids','Malonyl CoA decarboxylase deficiency','Low-fat, high-carbohydrate diet, avoid fasting','Carnitine','Evaluate mitochondrial energy production',ARRAY['Mitochondrial enzyme testing','Genetic panels'],'Inhibits succinic acid dehydrogenase'),
('Phenylpyruvic Acid','high','amino_acids','BH4 insufficiency, PKU','Limit phenylalanine, ensure oxygenation','BH4-supporting nutrients (folate, B3, zinc, Mg)','Assess thyroid and catecholamines',ARRAY['Neurotransmitter tests','Thyroid function'],'Elevated in PKU, requiring BH4 support'),
('Homogentisic Acid','high','amino_acids','Alkaptonuria, poor oxygenation, hyperglycemia','Limit vitamin C, improve oxygenation','None specific','Evaluate respiratory disorders',ARRAY['Genetic testing'],'Can lead to renal oxalate stone formation'),
('Branched-Chain Keto Acids','high','amino_acids','Nutrient deficiencies, insulin resistance, liver dysfunction','Balance dietary protein','Nutrient cofactors (B1, B2, B3, B5, ALA)','Address gut health and mitochondrial function',ARRAY['CMP','Acylcarnitine profile','Genetic testing'],'Impaired BCAA catabolism requiring cofactor support')
ON CONFLICT (biomarker_name, direction) DO NOTHING;

-- Neurotransmitters
INSERT INTO public.oat_biomarker_interpretations (biomarker_name,direction,category,clinical_significance,lifestyle_recommendations,supplement_protocol,additional_considerations,recommended_lab_followup,clinical_pearl) VALUES
('DOPAC','high','neurotransmitters','Excessive dopamine breakdown, chronic stress','Stress reduction, monitor stimulant intake','Magnesium, vitamin C, adaptogenic herbs','Assess adrenal function',ARRAY['Catecholamine testing','Cortisol levels'],'Excessive dopamine turnover linked to chronic stress'),
('DOPAC','low','neurotransmitters','Impaired dopamine metabolism, low dopamine production','Support dopamine synthesis','Tyrosine, vitamin B6, magnesium','Address dopamine receptor sensitivity',ARRAY['Neurotransmitter panels'],'Insufficient dopamine synthesis or impaired breakdown'),
('HVA','high','neurotransmitters','Elevated dopamine metabolism, prolonged stress','Address stressors, improve sleep','Magnesium, vitamin B6, omega-3s','Evaluate chronic stress',ARRAY['Cortisol testing','Neurotransmitter analysis'],'Excessive dopamine metabolism due to stress'),
('HVA','low','neurotransmitters','Reduced dopamine synthesis, nutrient deficiencies','Increase dietary protein and B-vitamins','Tyrosine, folate, vitamin B6','Assess for MTHFR SNPs',ARRAY['MTHFR testing','Neurotransmitter panels'],'Dopamine deficiency linked to poor mood/energy'),
('VMA','high','neurotransmitters','Elevated norepinephrine/epinephrine, chronic stress','Reduce stimulants, stress management','Vitamin C, magnesium, adaptogenic herbs','Evaluate adrenal and SNS function',ARRAY['Catecholamine testing','Cortisol levels'],'Excessive catecholamine breakdown from prolonged stress'),
('VMA','low','neurotransmitters','Reduced catecholamine metabolism, adrenal fatigue','Support adrenal health','Vitamin C, magnesium, adaptogenic herbs','Evaluate for adrenal insufficiency',ARRAY['Adrenal function tests','Catecholamine panels'],'Adrenal insufficiency or reduced catecholamine production'),
('5-HIAA','high','neurotransmitters','Increased serotonin turnover, chronic inflammation','Manage inflammation','Omega-3s, curcumin, magnesium','Evaluate for carcinoid markers',ARRAY['Serotonin testing','Inflammatory markers'],'Inflammation-driven serotonin depletion'),
('5-HIAA','low','neurotransmitters','Reduced serotonin production, poor tryptophan intake','Increase tryptophan-rich foods','Tryptophan, vitamin B6, magnesium','Address gut dysbiosis',ARRAY['Tryptophan metabolism panels'],'Serotonin deficiency due to poor diet or inflammation'),
('Kynurenic Acid','high','neurotransmitters','Chronic inflammation, kynurenine pathway activation','Reduce inflammation, improve gut health','Omega-3s, curcumin, resveratrol','Assess systemic inflammation',ARRAY['CRP','IL-6','Kynurenine pathway testing'],'Chronic inflammation and serotonin pathway diversion'),
('Quinolinic Acid','high','neurotransmitters','Neuroinflammation, excitotoxicity','Reduce inflammation and glutamate excitotoxicity','Magnesium, NAC, curcumin, omega-3s','Evaluate for infections',ARRAY['Inflammatory markers','Glutamate testing'],'Neuroinflammation and potential excitotoxicity'),
('4-Hydroxybutyric Acid','high','neurotransmitters','GABA metabolism impairment, possible SSADH deficiency','Support GABA synthesis','Magnesium, GABA, B6','Investigate genetic disorders',ARRAY['Genetic panels for SSADH'],'GABA metabolism dysregulation')
ON CONFLICT (biomarker_name, direction) DO NOTHING;

-- Microbial
INSERT INTO public.oat_biomarker_interpretations (biomarker_name,direction,category,clinical_significance,lifestyle_recommendations,supplement_protocol,additional_considerations,recommended_lab_followup,clinical_pearl,microbial_classification) VALUES
('DHPPA','low','microbial','Reduced beneficial bacteria','Increase polyphenol-rich foods','Probiotics, prebiotics','Address gut dysbiosis',ARRAY['Stool analysis','Dietary analysis'],'Low polyphenol metabolism and possible dysbiosis','bacterial'),
('Hippuric Acid','low','microbial','GI disorders, glycine/pantothenic acid deficiencies','Increase glycine-rich foods','Glycine, pantothenic acid','Evaluate gut health',ARRAY['Stool microbiota analysis'],'Low with high benzoic acid suggests glycine deficiency','bacterial'),
('4-Hydroxybenzoic Acid','high','microbial','Bacterial overgrowth, paraben exposure','Limit paraben exposure, increase fiber','Probiotics','Check for bacterial/fungal overgrowth',ARRAY['Environmental toxin panels','Amino acid testing'],'Environmental toxin exposure or dysbiosis','bacterial'),
('4-Hydroxyhippuric Acid','high','microbial','Bacterial overgrowth, paraben exposure','Limit parabens, support gut health','Glycine','Address possible toxic exposures',ARRAY['Stool testing','Environmental toxin panels'],'Glycine depletion due to conjugation demands','bacterial'),
('2-Hydroxyphenylacetic Acid','high','microbial','C. difficile, PKU, vitamin B6 deficiency','Support gut health with prebiotics','Vitamin B6','Assess genetic conditions',ARRAY['Gut microbiome testing','Genetic testing for PKU'],'Bacterial overgrowth or genetic disorders','bacterial'),
('4-Hydroxyphenylacetic Acid','high','microbial','Small bowel diseases, SIBO, tyrosine malabsorption','Address bacterial overgrowth','Digestive enzymes, probiotics','Evaluate for SIBO',ARRAY['SIBO breath test','Stool analysis'],'Anaerobic bacterial activity','clostridia'),
('HPHPA','high','microbial','Clostridia overgrowth, neuropsychiatric associations','Support gut health, reduce Clostridia','Probiotics (Lactobacilli)','Address gut-brain axis',ARRAY['Stool analysis','Neurotransmitter testing'],'Marker for Clostridia overgrowth','clostridia'),
('4-Cresol','high','microbial','Clostridia overgrowth, impaired dopamine metabolism','Reduce sugar, support dopamine','Tyrosine, magnesium','Evaluate dopamine/norepinephrine balance',ARRAY['Stool analysis','Neurotransmitter testing'],'Inhibits dopamine-beta-hydroxylase','clostridia'),
('3-Indoleacetic Acid','high','microbial','Bacterial overgrowth, high tryptophan, digestive dysfunction','Optimize protein digestion','Digestive enzymes','Assess for bacterial species producing IAA',ARRAY['Stool analysis','Gut microbiota profiling'],'Bacterial overgrowth or impaired tryptophan absorption','clostridia'),
('Citramalic Acid','high','microbial','Intestinal dysbiosis, dietary sources','Balance dietary intake','None specific','Address dietary contributions',ARRAY['Stool testing','Metabolic panels'],'May indicate dietary excess or dysbiosis','mold'),
('3-Oxoglutaric Acid','high','microbial','Yeast overgrowth, intestinal dysbiosis','Address yeast overgrowth','Probiotics, antifungal supplements','Assess for Candida',ARRAY['Stool analysis','Fungal antibody testing'],'Yeast overgrowth or other dysbiosis','mold'),
('Carboxycitric Acid','high','microbial','Fungal overgrowth, ASD associations','Support fungal eradication','Antifungal supplements','Investigate fungal dysbiosis',ARRAY['Stool analysis','Fungal testing'],'Linked to fungal overgrowth and ASD','mold'),
('Arabinose','high','microbial','Candida overgrowth, dietary contributions','Reduce high-arabinose foods','Antifungal agents','Evaluate for Candida',ARRAY['Stool analysis','Fungal antibody testing'],'Reflects Candida overgrowth; monitors antifungal efficacy','fungal'),
('Tartaric Acid','high','microbial','Associated with autism, dietary sources, dysbiosis','Limit high-tartaric acid foods','Antioxidants (vitamin C)','Address dietary and microbial contributions',ARRAY['Stool testing','Fungal antibody testing'],'Fungal overgrowth or dietary excess','mold'),
('Tricarballylic Acid','high','microbial','Mold exposure, Fusarium bacterial overgrowth','Avoid mold-contaminated foods','Antifungal agents','Address environmental mold exposure',ARRAY['Mycotoxin panels','Fungal testing'],'Mold exposure or bacterial overgrowth','mold'),
('5-Hydroxymethylfuroic Acid','high','microbial','Aspergillus fungal exposure, dysbiosis','Limit mold-contaminated foods','Antifungal agents, probiotics','Investigate fungal contributions',ARRAY['Stool analysis','Mycotoxin testing'],'Aspergillus contamination or gut dysbiosis','mold'),
('5-Furandicarboxylic Acid','high','microbial','Dysbiosis, Candida albicans, dietary factors','Reduce high-fructose, high-heat foods','Antifungal agents','Investigate fungal overgrowth',ARRAY['Stool analysis','Fungal antibody testing'],'Fungal overgrowth or dietary contributions','mold'),
('Furancarbonylglycine','high','microbial','Aspergillus exposure, fungal overgrowth','Support antifungal treatment','Antifungal agents','Investigate Aspergillus infections',ARRAY['Stool analysis','Mycotoxin testing'],'Aspergillus-related fungal overgrowth','mold')
ON CONFLICT (biomarker_name, direction) DO NOTHING;
