-- Dr. Bright's Recommended Supplement Catalog with Affiliate Links
CREATE TABLE IF NOT EXISTS public.recommended_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text NOT NULL,
  company text NOT NULL,
  category text NOT NULL,
  best_for text NOT NULL,
  broad_match_keywords text[] NOT NULL,
  affiliate_url text NOT NULL,
  order_code text,
  priority integer DEFAULT 1,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(product_name, company)
);
ALTER TABLE public.recommended_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read products" ON public.recommended_products FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admin manage products" ON public.recommended_products FOR ALL USING (public.is_admin());
CREATE INDEX idx_rec_products_cat ON public.recommended_products(category);
CREATE INDEX idx_rec_products_name ON public.recommended_products(product_name);

INSERT INTO public.recommended_products (product_name,company,category,best_for,broad_match_keywords,affiliate_url,order_code,priority) VALUES
-- Inflammation, Pain & Immune
('Resolve+','Healthgevity','inflammation_pain_immune','Curcumin, inflammation, NF-kB, IL-6, joint pain',ARRAY['curcumin','turmeric','anti-inflammatory','nf-kb','il-6','cox-2','joint support'],'https://healthgev.com/products/resolve?rfsn=7188917.246a77',NULL,1),
('Immune Rmor','Vervita','inflammation_pain_immune','General immune support, infection prevention',ARRAY['immune support','immune blend','immune activation','antimicrobial support'],'https://vervitaproducts.com/collections/nutritional-supplements/products/immune-rmor?ref=drbrandonbright',NULL,1),
('ImmuneRESTORE+','Healthgevity','inflammation_pain_immune','Lactoferrin, immune restoration, iron regulation',ARRAY['lactoferrin','immune restoration','iron-binding protein','antimicrobial'],'https://healthgev.com/products/immunorestore?rfsn=7188917.246a77',NULL,1),
('bioREPAIR','Healthgevity','inflammation_pain_immune','Colostrum, gut barrier, immune globulins',ARRAY['colostrum','immunoglobulins','igg','gut barrier','mucosal immunity'],'https://healthgev.com/products/biorepair?rfsn=7188917.246a77',NULL,1),
('IgG Protect','Fullscript','inflammation_pain_immune','IgG supplementation, colostrum powder',ARRAY['igg','colostrum powder','immunoglobulin g','gut immune'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('D-Spiked','Holystic Solutions','inflammation_pain_immune','Spike protein removal, post-vaccine support',ARRAY['spike protein','nattokinase','post-vaccine detox','spike clearance'],'www.Dspiked.com',NULL,1),
-- Antioxidants & Detox
('NAC 900','Healthgevity','antioxidants_detox','NAC, glutathione precursor, oxidative stress',ARRAY['nac','n-acetylcysteine','glutathione precursor','oxidative stress','detox support'],'https://healthgev.com/products/nac900?rfsn=7188917.246a77',NULL,1),
('Transdermal Glutathione','Auro Wellness','antioxidants_detox','Glutathione (1st choice), oxidative stress, detox',ARRAY['glutathione','gsh','oxidative stress','detoxification','master antioxidant'],'https://aurowellness.com/?ref=987',NULL,1),
('Glutathione Complex','Quicksilver Scientific','antioxidants_detox','Liposomal glutathione (2nd choice)',ARRAY['glutathione','liposomal glutathione','gsh'],'https://us.fullscript.com/welcome/drbright/signup',NULL,2),
('Liposomal Vitamin C','Quicksilver Scientific','antioxidants_detox','Vitamin C, ascorbic acid, antioxidant',ARRAY['vitamin c','ascorbic acid','liposomal c','antioxidant'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('H2 Elite','Quicksilver Scientific','antioxidants_detox','Molecular hydrogen, selective antioxidant',ARRAY['h2','molecular hydrogen','antioxidant','hydroxyl radical'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Liver Sauce','Quicksilver Scientific','antioxidants_detox','Liver detox, phase I/II, bile flow',ARRAY['liver detox','liver support','bile flow','hepatoprotection','phase i','phase ii'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Tudca Ox+BILE','LVLUP Health','antioxidants_detox','TUDCA, bile acid support, cholestasis',ARRAY['tudca','bile acid','bile support','cholestasis','ox bile'],'https://lvluphealth.com/product/tudca-ox-bile/?ref=BRANDONBRIGHT',NULL,1),
('BitterX','Quicksilver Scientific','antioxidants_detox','Digestive bitters, bile stimulation',ARRAY['bitters','bile stimulation','gallbladder','digestive support'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Biotoxin Binder','CellCore','antioxidants_detox','Mold toxins, mycotoxins, biotoxin',ARRAY['biotoxin binder','mycotoxin binder','mold detox','biotoxin'],'https://cellcore.com/collections/products','HQ91SbRn',1),
('Carboxy','CellCore','antioxidants_detox','Humic acid, fulvic acid, heavy metal binding',ARRAY['humic acid','fulvic acid','carboxy','heavy metal binder'],'https://cellcore.com/collections/products','HQ91SbRn',1),
('Takesumi Supreme','Supreme Nutrition','antioxidants_detox','General toxin binding, activated carbon',ARRAY['binder','charcoal','toxin binder','general detox binder','activated carbon'],'https://shop.supremenutritionproducts.com/takesumi-supreme-capsules/?aff=47',NULL,1),
('Ultra Binder','Quicksilver Scientific','antioxidants_detox','Comprehensive multi-agent binder',ARRAY['ultra binder','multi-toxin binder','comprehensive binder'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
-- Mitochondria, Energy & Longevity
('NMN','Healthgevity','mitochondria_energy_longevity','NAD+ support, NMN, cellular aging',ARRAY['nmn','nad+','nicotinamide mononucleotide','nr','nad precursor','sirtuin activation'],'https://healthgev.com/products/nmn-1000?rfsn=7188917.246a77',NULL,1),
('NAD Patch','Ion Layer','mitochondria_energy_longevity','Transdermal NAD delivery',ARRAY['nad patch','transdermal nad','nad delivery'],'https://www.ionlayer.com/?rfsn=7400949.6c2c60',NULL,1),
('MB MitoBlue','LVLUP Health','mitochondria_energy_longevity','Methylene blue, mitochondrial support',ARRAY['methylene blue','mitochondrial support','electron transport chain','complex i'],'https://lvluphealth.com/product/mito-blue/?ref=BRANDONBRIGHT',NULL,1),
('Urolithin A','Timeline','mitochondria_energy_longevity','Mitophagy, mitochondrial recycling',ARRAY['urolithin a','mitophagy','mitochondrial autophagy','mitochondrial recycling'],'https://www.timeline.com/shop?rfsn=8540377.cd4d97b',NULL,1),
('Telomere Prime+','Healthgevity','mitochondria_energy_longevity','Telomere support, telomerase',ARRAY['telomere','telomerase','cellular aging','telomere support'],'https://healthgev.com/products/telomere-prime?rfsn=7188917.246a77',NULL,1),
('Crevolution','LVLUP Health','mitochondria_energy_longevity','Creatine, ATP regeneration',ARRAY['creatine','creatine monohydrate','atp','phosphocreatine'],'https://lvluphealth.com/product/crevolution/?ref=BRANDONBRIGHT',NULL,1),
-- Blood Sugar & Metabolic
('Ignite+','Healthgevity','blood_sugar_metabolic','Blood sugar, weight management, insulin sensitivity',ARRAY['blood sugar','weight loss','metabolic support','insulin sensitivity','glucose regulation'],'https://healthgev.com/products/ignite?rfsn=7188917.246a77',NULL,1),
('GlycoPrime','Healthgevity','blood_sugar_metabolic','Insulin regulation, glucose metabolism',ARRAY['insulin','glucose','glycemic control','insulin resistance','blood sugar regulation'],'https://healthgev.com/products/glucoprime?rfsn=7188917.246a77',NULL,1),
('BergaCor Plus','Xymogen','blood_sugar_metabolic','Cholesterol, bergamot, lipid support',ARRAY['cholesterol','lipid support','bergamot','ldl','hdl','statin alternative'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
-- Gut Health
('Prime Gut Health','Healthgevity','gut_health','Spore probiotic, butyrate, microbiome',ARRAY['probiotic','spore-based probiotic','butyrate','gut flora','microbiome','dysbiosis','scfa'],'https://healthgev.com/products/prime-gut-health?rfsn=7188917.246a77',NULL,1),
('BPC + PEA','Healthgevity','gut_health','BPC-157, PEA, gut healing peptide',ARRAY['bpc-157','bpc','pea','palmitoylethanolamide','gut healing peptide','mucosal repair'],'https://healthgev.com/products/bpc-pea-500-30?rfsn=7188917.246a77',NULL,1),
('Ultimate GI Repair','LVLUP Health','gut_health','Advanced gut repair, peptide GI healing',ARRAY['gi repair','gut repair','leaky gut','intestinal permeability','gut peptides'],'https://lvluphealth.com/product/ultimate-gi-repair/?ref=BRANDONBRIGHT',NULL,1),
('Gut Feeling','Integrative Peptides','gut_health','Peptide gut healing, GI support',ARRAY['gut healing peptide','gi peptide','intestinal peptide'],'https://integrativepeptides.com/store/affiliate/drbright/',NULL,2),
('Gastro Digest','Vervita','gut_health','Digestive enzymes, hypochlorhydria',ARRAY['digestive enzymes','enzyme blend','digestion','hypochlorhydria','malabsorption'],'https://vervitaproducts.com/collections/nutritional-supplements/products/gastro-digest-ii?ref=drbrandonbright',NULL,1),
('GI Revive Powder','Designs For Health','gut_health','Gut lining repair, L-glutamine, DGL',ARRAY['gi revive','gut lining','l-glutamine','dgl','mucosal support','gut repair powder'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('GlutaShield','Orthomolecular','gut_health','Glutamine gut barrier support',ARRAY['glutashield','glutamine','gut barrier','intestinal permeability'],'https://us.fullscript.com/welcome/drbright/signup',NULL,2),
('Candicid Forte','Orthomolecular','gut_health','Anti-candida, antifungal',ARRAY['candida','yeast','antifungal','fungal overgrowth','candidiasis'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Pyloricil','Orthomolecular','gut_health','H. pylori, mastic gum',ARRAY['h. pylori','helicobacter','mastic gum','gastric support','stomach ulcer'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Cats Claw V-Max','Quicksilver Scientific','gut_health','Antiviral, cats claw',ARRAY['antiviral','cats claw','viral support','uncaria tomentosa'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Crypto Co-Max','Quicksilver Scientific','gut_health','Lyme support, cryptolepis',ARRAY['lyme','tick-borne','cryptolepis','borrelia','co-infections'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
-- Brain, Mood & Neuro
('Brain Boost+','Healthgevity','brain_mood_neuro','Cognitive enhancement, memory, focus',ARRAY['cognitive','brain health','memory','focus','nootropic','mental clarity'],'https://healthgev.com/products/brain-boost?rfsn=7188917.246a77',NULL,1),
('NeuroGEVITY','Healthgevity','brain_mood_neuro','Dihexa, BDNF, synaptogenesis',ARRAY['dihexa','bdnf','synaptogenesis','neurodegenerative','advanced nootropic'],'https://healthgev.com/products/neurogevity?rfsn=7188917.246a77',NULL,1),
('Neuro Re-Generate','LVLUP Health','brain_mood_neuro','Neuropeptides, cognitive peptide',ARRAY['neuropeptide','cognitive peptide','neuroregeneration','brain peptide'],'https://lvluphealth.com/product/neuro-regenerate/?ref=BRANDONBRIGHT',NULL,1),
('Klamz','Vervita','brain_mood_neuro','Calming, anxiolytic, stress reduction',ARRAY['calming','anxiolytic','stress','nervous system','relaxation'],'https://vervitaproducts.com/collections/nutritional-supplements/products/kalmz?ref=drbrandonbright',NULL,1),
('Serenity','Healthgevity','brain_mood_neuro','Mood, serotonin, emotional balance',ARRAY['mood','serotonin','emotional balance','mood boosting','5-htp'],'https://healthgev.com/products/serenity?rfsn=7188917.246a77',NULL,1),
('CBD AX','Quicksilver Scientific','brain_mood_neuro','CBD, anxiety, endocannabinoid',ARRAY['cbd','anxiety','cannabidiol','endocannabinoid'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Liposomal GABA L-Theanine','Quicksilver Scientific','brain_mood_neuro','GABA, L-theanine, anxiety',ARRAY['gaba','l-theanine','anxiety','calming neurotransmitter','inhibitory support'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
-- Sleep
('SLEEPgevity','Healthgevity','sleep','Sleep support, insomnia, circadian',ARRAY['sleep','insomnia','circadian','melatonin','sleep quality'],'https://healthgev.com/products/sleepgevity?rfsn=7188917.246a77',NULL,1),
('Kill Switch','Switch Supplements','sleep','Sleep aid, nighttime relaxation',ARRAY['sleep aid','nighttime','sleep onset'],'https://www.switchsupplements.com/BRANDON',NULL,2),
-- Hormones & Endocrine
('dailyDIM+','Healthgevity','hormones_endocrine','Estrogen detox, DIM, estrogen dominance',ARRAY['dim','estrogen detox','estrogen metabolism','estrogen dominance','indole-3-carbinol'],'https://healthgev.com/products/dailydim?rfsn=7188917.246a77',NULL,1),
('Core Hormone Support','Quicksilver Scientific','hormones_endocrine','DHEA + pregnenolone, adrenal hormones',ARRAY['dhea','pregnenolone','hormone precursor','adrenal hormones'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Pure DHEA','Quicksilver Scientific','hormones_endocrine','DHEA, adrenal support',ARRAY['dhea','dehydroepiandrosterone','adrenal androgen'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Pro Progesterone','Quicksilver Scientific','hormones_endocrine','Progesterone cream, luteal phase',ARRAY['progesterone','progesterone cream','luteal phase','progesterone deficiency'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Chaste Tree Supreme','Supreme Nutrition','hormones_endocrine','Vitex, herbal progesterone, PMS',ARRAY['vitex','chaste tree','herbal progesterone','pms','menstrual regulation'],'https://shop.supremenutritionproducts.com/chaste-tree-supreme/?aff=47',NULL,1),
('Pro Estradiol','Quicksilver Scientific','hormones_endocrine','Estradiol, E2, menopausal support',ARRAY['estradiol','e2','estrogen replacement'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Pro Estriol+','Quicksilver Scientific','hormones_endocrine','Estriol, E3, vaginal health',ARRAY['estriol','e3','vaginal atrophy'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Bi-Est+','Quicksilver Scientific','hormones_endocrine','Combined estrogen, bioidentical',ARRAY['bi-est','combined estrogen','estradiol estriol','bioidentical estrogen'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Botanabolic','LVLUP Health','hormones_endocrine','Testosterone optimization, male hormone',ARRAY['testosterone','testosterone booster','male hormone','androgen support'],'https://lvluphealth.com/product/botanabolic/?ref=BRANDONBRIGHT',NULL,1),
('Regenzyme Thyroid','Vervita','hormones_endocrine','Thyroid glandular, iodine, selenium',ARRAY['thyroid','thyroid glandular','iodine','selenium','hypothyroid support'],'https://vervitaproducts.com/collections/nutritional-supplements/products/regenerzyme-thyroid-copy?ref=drbrandonbright',NULL,1),
('ThyroPep','Integrative Peptides','hormones_endocrine','Thyroid bioregulator peptide',ARRAY['thyroid peptide','bioregulator','thyropep','thyroid restoration'],'https://integrativepeptides.com/store/affiliate/drbright/',NULL,1),
('Regenzyme Adrenal','Vervita','hormones_endocrine','Adrenal glandular, HPA axis',ARRAY['adrenal','adrenal glandular','adrenal fatigue','hpa axis','cortisol support'],'https://vervitaproducts.com/collections/nutritional-supplements/products/regenerzyme-adrenal?ref=drbrandonbright',NULL,1),
('Liposomal GHKcu','Quicksilver Scientific','hormones_endocrine','GHK-Cu copper peptide, tissue repair',ARRAY['ghk-cu','copper peptide','tissue repair','anti-aging peptide'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
-- Vitamins, Minerals & Foundational
('Protect+ 10','Healthgevity','vitamins_minerals','Vitamin D, A, E, K2, immune modulation',ARRAY['vitamin d','vitamin d3','fat-soluble vitamins','vitamin k2','vitamin a','vitamin e'],'https://healthgev.com/products/protect?rfsn=7188917.246a77',NULL,1),
('MitoCore','Orthomolecular','vitamins_minerals','Multivitamin, micronutrient foundation',ARRAY['multivitamin','multi-mineral','b-complex','daily vitamin','micronutrient'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Mineral 650','Pure Encapsulations','vitamins_minerals','Multi-mineral, trace minerals',ARRAY['multi-mineral','trace minerals','mineral supplement','mineral deficiency'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Quinton Hypertonic','Quicksilver Scientific','vitamins_minerals','Electrolytes, hydration, mineral balance',ARRAY['electrolytes','hydration','mineral balance','sodium','potassium','trace minerals'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('FerraSorb','Thorne','vitamins_minerals','Iron supplementation, ferritin, anemia',ARRAY['iron','iron supplement','ferritin','anemia','iron deficiency'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Shilajit Gummies','Organifi','vitamins_minerals','Shilajit, fulvic minerals, adaptogen',ARRAY['shilajit','fulvic acid','mineral support','adaptogen'],'https://www.organifishop.com/products/shilajit-gummies?oid=18&affid=1211',NULL,1),
('Fatty15','Fatty15','vitamins_minerals','C15:0 fatty acid, cellular health',ARRAY['omega-3','fatty acid','c15:0','pentadecanoic acid','essential fatty acid'],'https://fatty15.com/DRBRIGHT',NULL,1),
('Pro Omega 2000','Nordic Naturals','vitamins_minerals','EPA/DHA fish oil, anti-inflammatory',ARRAY['fish oil','epa','dha','omega-3 fish oil','pro omega'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Pro Omega Gummies','Nordic Naturals','vitamins_minerals','Kids fish oil, pediatric omega-3',ARRAY['kids fish oil','pediatric omega-3','childrens dha'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Greens Powder','Organifi','vitamins_minerals','Greens supplement, superfood blend',ARRAY['greens powder','superfood','greens supplement','alkalizing greens'],'https://www.organifishop.com/products/green?oid=18&affid=1211',NULL,1),
('Organifi Red','Organifi','vitamins_minerals','Adrenal superfood, blood building, beet',ARRAY['red juice','blood building','beet powder','adrenal superfood','adaptogens'],'https://www.organifishop.com/products/red?oid=18&affid=1211',NULL,1),
-- Methylation
('InspiraCell','Vervita','methylation','Methylation support, MTHFR, SAMe',ARRAY['methylation','mthfr','methyl donors','same','homocysteine'],'https://vervitaproducts.com/collections/nutritional-supplements/products/inspiracell?ref=drbrandonbright',NULL,1),
('Homocysteine Supreme','Fullscript','methylation','Homocysteine reduction, B12/folate',ARRAY['homocysteine','methylation','b12','folate','methylcobalamin'],'https://us.fullscript.com/welcome/drbright/signup',NULL,2),
-- Histamine & Mast Cell
('D-Hist','Orthomolecular','histamine_mast_cell','Histamine, environmental allergies, sinus',ARRAY['histamine','allergy','environmental allergy','sinus','seasonal allergy'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('D-Hist Jr','Orthomolecular','histamine_mast_cell','Pediatric histamine support',ARRAY['kids histamine','pediatric allergy','childrens antihistamine'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
('Hista-Aid','Quicksilver Scientific','histamine_mast_cell','MCAS, mast cell activation, histamine intolerance',ARRAY['mcas','mast cell','histamine intolerance','mast cell activation syndrome'],'https://us.fullscript.com/welcome/drbright/signup',NULL,1),
-- Cardiovascular
('Regenzyme Heart','Vervita','cardiovascular','Heart support, cardiac glandular',ARRAY['heart support','cardiovascular','cardiac health','heart glandular'],'https://vervitaproducts.com/collections/nutritional-supplements/products/regenerzyme-heart?ref=drbrandonbright',NULL,1),
('VascuNOX','Calroy','cardiovascular','Nitric oxide, endothelial function',ARRAY['nitric oxide','no','endothelial function','vasodilation','blood pressure','enos'],'https://theholisticapproach.calroy.com/product/vascanox-hp/',NULL,1),
('Artirisol','Calroy','cardiovascular','Arterial wall, glycocalyx support',ARRAY['arterial wall','glycocalyx','arterial health','vascular integrity'],'https://theholisticapproach.calroy.com/product/arterosilhp/',NULL,1),
-- Musculoskeletal
('Cartigenix HP','Calroy','musculoskeletal','Cartilage, joint health, osteoarthritis',ARRAY['cartilage','joint health','collagen','osteoarthritis','joint repair'],'https://theholisticapproach.calroy.com/product/cartigenix-hp/',NULL,1),
-- Kidney, Bladder & Circulation
('Cir-Q Tonic','Vervita','kidney_bladder_circulation','Kidney, bladder, circulatory support',ARRAY['kidney','bladder','circulation','renal support','urinary health','vascular tone'],'https://vervitaproducts.com/collections/nutritional-supplements/products/cir-q-tonic?ref=drbrandonbright',NULL,1),
-- Pediatric
('NDF Happy','Bioray','pediatric','Kids parasite cleanse (1st choice)',ARRAY['kids parasite','pediatric parasite','childrens anti-parasitic'],'https://www.bioray.com/products/ndf-happy?aff=738',NULL,1),
('Black Walnut Tincture','Supreme Nutrition','pediatric','Anti-parasitic tincture (2nd choice)',ARRAY['black walnut','anti-parasitic','parasite tincture'],'https://shop.supremenutritionproducts.com/black-walnut-tincture/?aff=47',NULL,2),
('NDF Pooper','Bioray','pediatric','Kids constipation (1st choice)',ARRAY['kids constipation','pediatric constipation','childrens bowel'],'https://www.bioray.com/products/ndf-pooper?aff=738',NULL,1),
('Liquid Magnesium Citrate','Fullscript','pediatric','Kids constipation (2nd choice)',ARRAY['magnesium citrate','liquid magnesium','pediatric magnesium','osmotic laxative'],'https://us.fullscript.com/welcome/drbright/signup',NULL,2),
('Scutellaria Tincture','Supreme Nutrition','pediatric','Kids yeast, antifungal',ARRAY['kids yeast','pediatric fungal','childrens antifungal','scutellaria','baicalin'],'https://shop.supremenutritionproducts.com/scutellaria-baicalensis-tincture/?aff=47',NULL,1),
('Microbe Slayer','Bioray','pediatric','Kids antimicrobial',ARRAY['kids antimicrobial','pediatric antimicrobial','childrens infection support'],'https://www.bioray.com/products/microbe-slayer-organic?aff=738',NULL,1),
-- Lifestyle & Wellness
('NutriSense CGM','NutriSense','lifestyle_wellness','Continuous glucose monitoring',ARRAY['cgm','continuous glucose monitor','blood sugar monitor','glucose tracking'],'https://www.nutrisense.io/?rfsn=8310553.fab605&utm_source=affiliate&utm_medium=referral&utm_campaign=HolisticDrBright&utm_term=8310553.fab605&code=DrBright',NULL,1),
('Fringe Red Light','Fringe','lifestyle_wellness','Red light therapy, photobiomodulation',ARRAY['red light','photobiomodulation','infrared light','light therapy','pbm'],'https://fringeheals.com/ref/224/',NULL,1),
('Branch Basics','Branch Basics','lifestyle_wellness','Non-toxic cleaning, toxin reduction',ARRAY['non-toxic cleaning','clean home','environmental toxin','household toxin reduction'],'https://branchbasics.com/HOLISTICDRBRIGHT',NULL,1),
('Super Teeth','Super Teeth','lifestyle_wellness','Non-toxic toothpaste, oral microbiome',ARRAY['toothpaste','oral health','dental','oral microbiome'],'https://getsuperteeth.com/?ref=bwadrrdw',NULL,1)
ON CONFLICT (product_name, company) DO NOTHING;
