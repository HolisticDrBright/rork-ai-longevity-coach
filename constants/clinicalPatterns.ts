import { TCMPattern, TCMOrganSystem, FunctionalSystem } from '@/types';

export interface TCMPatternInfo {
  id: TCMPattern;
  name: string;
  description: string;
  modernInterpretation: string;
  commonSymptoms: string[];
  tongueIndications: string[];
  pulseIndications: string[];
  dietaryGuidance: {
    foods: string[];
    avoid: string[];
  };
  lifestyleGuidance: string[];
}

export interface FunctionalSystemInfo {
  id: FunctionalSystem;
  name: string;
  description: string;
  keySymptoms: string[];
  relatedBiomarkers: string[];
  rootCauses: string[];
  supportStrategies: string[];
}

export interface TCMOrganInfo {
  id: TCMOrganSystem;
  name: string;
  governs: string[];
  emotionalAspect: string;
  imbalanceSymptoms: string[];
  supportingFoods: string[];
}

export const TCM_PATTERNS: TCMPatternInfo[] = [
  {
    id: 'qi_deficiency',
    name: 'Qi Deficiency',
    description: 'Insufficient vital energy leading to fatigue and weakness',
    modernInterpretation: 'May reflect mitochondrial dysfunction, adrenal fatigue, or nutrient deficiencies affecting cellular energy production',
    commonSymptoms: [
      'Fatigue that worsens with activity',
      'Shortness of breath on exertion',
      'Weak voice',
      'Spontaneous sweating',
      'Poor appetite',
      'Loose stools',
      'Pale complexion',
      'Frequent colds',
    ],
    tongueIndications: ['Pale tongue', 'Teethmarks on edges'],
    pulseIndications: ['Weak pulse', 'Empty pulse'],
    dietaryGuidance: {
      foods: [
        'Warm cooked foods',
        'Root vegetables (sweet potato, carrots)',
        'Bone broth',
        'Rice and oats',
        'Chicken and beef',
        'Dates and goji berries',
        'Ginger tea',
      ],
      avoid: [
        'Cold raw foods',
        'Ice water',
        'Excessive salads',
        'Dairy',
        'Sugar',
      ],
    },
    lifestyleGuidance: [
      'Regular gentle exercise (tai chi, walking)',
      'Adequate rest and sleep',
      'Avoid overexertion',
      'Stress management',
      'Deep breathing exercises',
    ],
  },
  {
    id: 'qi_stagnation',
    name: 'Qi Stagnation',
    description: 'Blocked or stuck energy flow causing tension and emotional disturbance',
    modernInterpretation: 'Often correlates with chronic stress, sympathetic dominance, and impaired detoxification or lymphatic flow',
    commonSymptoms: [
      'Mood swings and irritability',
      'Feeling of chest or throat tightness',
      'Sighing frequently',
      'Abdominal bloating',
      'Irregular periods (women)',
      'Breast distension before periods',
      'Tension headaches',
      'Difficulty relaxing',
    ],
    tongueIndications: ['Normal or slightly purple tongue', 'Distended sublingual veins'],
    pulseIndications: ['Wiry pulse', 'Tight pulse'],
    dietaryGuidance: {
      foods: [
        'Peppermint tea',
        'Citrus fruits',
        'Leafy greens',
        'Turmeric',
        'Radishes',
        'Fennel',
        'Chamomile tea',
      ],
      avoid: [
        'Alcohol',
        'Coffee (excess)',
        'Greasy foods',
        'Heavy meals',
      ],
    },
    lifestyleGuidance: [
      'Regular physical exercise',
      'Yoga and stretching',
      'Emotional expression (journaling, therapy)',
      'Nature walks',
      'Acupuncture',
      'Deep breathing',
    ],
  },
  {
    id: 'blood_deficiency',
    name: 'Blood Deficiency',
    description: 'Insufficient blood nourishment causing pallor and dryness',
    modernInterpretation: 'May indicate iron deficiency, B12/folate deficiency, or inadequate protein intake affecting red blood cell production',
    commonSymptoms: [
      'Pale face and lips',
      'Dizziness',
      'Dry skin and hair',
      'Brittle nails',
      'Poor memory',
      'Insomnia or light sleep',
      'Scanty or absent periods',
      'Blurred vision',
      'Numbness or tingling',
    ],
    tongueIndications: ['Pale thin tongue'],
    pulseIndications: ['Thin choppy pulse'],
    dietaryGuidance: {
      foods: [
        'Dark leafy greens',
        'Beets and beet juice',
        'Organ meats (liver)',
        'Red meat',
        'Black beans',
        'Blackstrap molasses',
        'Eggs',
        'Bone broth',
      ],
      avoid: [
        'Excessive raw foods',
        'Coffee and tea with meals (blocks iron)',
        'Processed foods',
      ],
    },
    lifestyleGuidance: [
      'Gentle exercise only',
      'Adequate sleep (8+ hours)',
      'Avoid excessive screen time',
      'Stress reduction',
    ],
  },
  {
    id: 'blood_stasis',
    name: 'Blood Stasis',
    description: 'Impaired blood circulation causing pain and discoloration',
    modernInterpretation: 'May correlate with poor circulation, clotting tendencies, chronic inflammation, or endometriosis',
    commonSymptoms: [
      'Fixed stabbing pain',
      'Dark complexion or dark circles',
      'Varicose veins',
      'Clots in menstrual blood',
      'Painful periods',
      'Masses or lumps',
      'Memory problems',
      'Purple lips or nails',
    ],
    tongueIndications: ['Purple tongue', 'Dark spots on tongue', 'Distended sublingual veins'],
    pulseIndications: ['Choppy pulse', 'Wiry pulse'],
    dietaryGuidance: {
      foods: [
        'Turmeric',
        'Ginger',
        'Garlic',
        'Onions',
        'Eggplant',
        'Peaches',
        'Chestnuts',
        'Hawthorn berries',
      ],
      avoid: [
        'Cold foods and drinks',
        'Dairy',
        'Fatty meats',
        'Refined sugar',
      ],
    },
    lifestyleGuidance: [
      'Regular movement',
      'Massage and bodywork',
      'Avoid sitting for long periods',
      'Warm compresses for pain',
      'Acupuncture',
    ],
  },
  {
    id: 'yin_deficiency',
    name: 'Yin Deficiency',
    description: 'Depleted cooling and moistening aspects causing heat and dryness',
    modernInterpretation: 'May reflect chronic stress, adrenal burnout, dehydration, or menopausal changes with declining estrogen',
    commonSymptoms: [
      'Night sweats',
      'Hot flashes',
      'Dry mouth and throat',
      'Insomnia',
      'Afternoon low-grade fever',
      'Restlessness',
      'Dry skin',
      'Constipation',
      'Tinnitus',
    ],
    tongueIndications: ['Red tongue with little coating', 'Cracked tongue'],
    pulseIndications: ['Thin rapid pulse'],
    dietaryGuidance: {
      foods: [
        'Pears and apples',
        'Watermelon',
        'Cucumber',
        'Tofu',
        'Seaweed',
        'Mung beans',
        'Black sesame seeds',
        'Duck',
        'Eggs',
      ],
      avoid: [
        'Spicy foods',
        'Alcohol',
        'Coffee',
        'Lamb',
        'Deep fried foods',
      ],
    },
    lifestyleGuidance: [
      'Go to bed by 10pm',
      'Meditation and relaxation',
      'Avoid overwork',
      'Stay hydrated',
      'Yin yoga',
    ],
  },
  {
    id: 'yang_deficiency',
    name: 'Yang Deficiency',
    description: 'Depleted warming energy causing cold and sluggishness',
    modernInterpretation: 'May indicate hypothyroidism, low testosterone, or mitochondrial dysfunction affecting metabolic heat production',
    commonSymptoms: [
      'Cold hands and feet',
      'Cold intolerance',
      'Fatigue',
      'Frequent urination (especially at night)',
      'Low libido',
      'Edema',
      'Loose stools',
      'Lower back pain',
      'Slow metabolism',
    ],
    tongueIndications: ['Pale swollen tongue', 'Wet coating'],
    pulseIndications: ['Deep weak pulse', 'Slow pulse'],
    dietaryGuidance: {
      foods: [
        'Warming spices (cinnamon, ginger, cloves)',
        'Lamb',
        'Chicken',
        'Walnuts',
        'Chestnuts',
        'Onions and leeks',
        'Warm cooked foods',
      ],
      avoid: [
        'Raw foods',
        'Cold drinks',
        'Excessive salt',
        'Bananas',
        'Watermelon',
      ],
    },
    lifestyleGuidance: [
      'Keep warm',
      'Moxibustion',
      'Moderate exercise',
      'Sunlight exposure',
      'Avoid cold environments',
    ],
  },
  {
    id: 'dampness',
    name: 'Dampness',
    description: 'Accumulation of fluid and heaviness in the body',
    modernInterpretation: 'May correlate with poor lymphatic drainage, water retention, candida overgrowth, or sluggish metabolism',
    commonSymptoms: [
      'Heavy limbs',
      'Foggy thinking',
      'Loose stools or sticky stool',
      'Bloating',
      'Fatigue',
      'Excess mucus',
      'Skin conditions (eczema, acne)',
      'Joint stiffness',
      'Weight gain',
    ],
    tongueIndications: ['Swollen tongue', 'Thick greasy coating'],
    pulseIndications: ['Slippery pulse', 'Soggy pulse'],
    dietaryGuidance: {
      foods: [
        'Bitter greens',
        'Barley',
        'Aduki beans',
        'Corn',
        'Celery',
        'Lettuce',
        'Turnips',
        'Green tea',
      ],
      avoid: [
        'Dairy',
        'Sugar',
        'Refined carbs',
        'Greasy foods',
        'Excessive raw foods',
        'Alcohol',
        'Bananas',
      ],
    },
    lifestyleGuidance: [
      'Regular exercise',
      'Dry brushing',
      'Sauna',
      'Avoid damp environments',
      'Don\'t overeat',
    ],
  },
  {
    id: 'phlegm',
    name: 'Phlegm',
    description: 'Congealed dampness creating nodules and obstruction',
    modernInterpretation: 'May indicate lipid abnormalities, thyroid nodules, cysts, or chronic sinus congestion',
    commonSymptoms: [
      'Productive cough',
      'Nodules or lumps',
      'Dizziness',
      'Nausea',
      'Mental fogginess',
      'Obesity',
      'Chest oppression',
      'Sinus congestion',
    ],
    tongueIndications: ['Swollen tongue', 'Thick greasy coating'],
    pulseIndications: ['Slippery pulse', 'Wiry pulse'],
    dietaryGuidance: {
      foods: [
        'Radishes',
        'Seaweed',
        'Mushrooms',
        'Onions',
        'Garlic',
        'Mustard greens',
        'Watercress',
      ],
      avoid: [
        'Dairy',
        'Peanuts',
        'Bananas',
        'Fatty meats',
        'Fried foods',
        'Excessive sweets',
      ],
    },
    lifestyleGuidance: [
      'Vigorous exercise',
      'Deep breathing',
      'Avoid overeating',
      'Intermittent fasting',
    ],
  },
  {
    id: 'heat',
    name: 'Heat',
    description: 'Excess heat causing inflammation and agitation',
    modernInterpretation: 'May reflect systemic inflammation, infection, or hyperactive immune response',
    commonSymptoms: [
      'Feeling hot',
      'Thirst for cold drinks',
      'Red face',
      'Irritability',
      'Constipation',
      'Dark urine',
      'Skin rashes',
      'Mouth ulcers',
      'Rapid pulse',
    ],
    tongueIndications: ['Red tongue', 'Yellow coating'],
    pulseIndications: ['Rapid pulse', 'Full pulse'],
    dietaryGuidance: {
      foods: [
        'Watermelon',
        'Cucumber',
        'Mung beans',
        'Bitter melon',
        'Mint',
        'Green tea',
        'Celery',
        'Tofu',
      ],
      avoid: [
        'Spicy foods',
        'Alcohol',
        'Red meat',
        'Fried foods',
        'Coffee',
        'Garlic (excess)',
      ],
    },
    lifestyleGuidance: [
      'Avoid hot environments',
      'Swimming',
      'Meditation',
      'Avoid anger and frustration',
    ],
  },
  {
    id: 'cold',
    name: 'Cold',
    description: 'Internal cold causing contraction and slowing',
    modernInterpretation: 'May indicate hypothyroidism, poor circulation, or slow metabolic rate',
    commonSymptoms: [
      'Cold limbs',
      'Pale face',
      'Preference for warm drinks',
      'Clear profuse urination',
      'Loose stools',
      'Abdominal pain relieved by warmth',
      'Slow digestion',
      'Low energy',
    ],
    tongueIndications: ['Pale tongue', 'White wet coating'],
    pulseIndications: ['Slow pulse', 'Deep pulse'],
    dietaryGuidance: {
      foods: [
        'Ginger',
        'Cinnamon',
        'Lamb',
        'Chicken',
        'Fennel',
        'Black pepper',
        'Cloves',
        'Warm soups',
      ],
      avoid: [
        'Cold raw foods',
        'Ice cream',
        'Cold drinks',
        'Salads',
        'Bananas',
      ],
    },
    lifestyleGuidance: [
      'Stay warm',
      'Moxibustion',
      'Warm baths',
      'Exercise to generate heat',
    ],
  },
  {
    id: 'wind',
    name: 'Wind',
    description: 'Erratic movement and sudden onset symptoms',
    modernInterpretation: 'May correlate with neurological symptoms, allergies, or conditions with sudden onset and movement',
    commonSymptoms: [
      'Sudden onset symptoms',
      'Symptoms that move locations',
      'Tremors',
      'Dizziness',
      'Itching',
      'Spasms',
      'Headaches',
      'Aversion to wind',
    ],
    tongueIndications: ['Trembling tongue', 'Deviated tongue'],
    pulseIndications: ['Floating pulse', 'Wiry pulse'],
    dietaryGuidance: {
      foods: [
        'Celery',
        'Mulberries',
        'Black sesame',
        'Chrysanthemum tea',
        'Peppermint',
      ],
      avoid: [
        'Shrimp and shellfish',
        'Eggs (if allergic)',
        'Alcohol',
        'Spicy foods',
      ],
    },
    lifestyleGuidance: [
      'Avoid drafts',
      'Protect neck from wind',
      'Regular sleep schedule',
      'Tai chi for balance',
    ],
  },
];

export const TCM_ORGANS: TCMOrganInfo[] = [
  {
    id: 'liver',
    name: 'Liver',
    governs: ['Free flow of Qi', 'Blood storage', 'Tendons', 'Eyes', 'Nails'],
    emotionalAspect: 'Anger, frustration, and planning',
    imbalanceSymptoms: [
      'Irritability and mood swings',
      'Headaches (especially temples)',
      'Eye problems',
      'Menstrual irregularities',
      'Muscle tension',
      'Digestive issues with stress',
    ],
    supportingFoods: ['Leafy greens', 'Sour foods', 'Beets', 'Artichokes', 'Dandelion'],
  },
  {
    id: 'heart',
    name: 'Heart',
    governs: ['Blood circulation', 'Spirit (Shen)', 'Tongue', 'Complexion', 'Joy'],
    emotionalAspect: 'Joy, connection, and consciousness',
    imbalanceSymptoms: [
      'Anxiety and restlessness',
      'Insomnia',
      'Palpitations',
      'Poor memory',
      'Dream-disturbed sleep',
      'Speech problems',
    ],
    supportingFoods: ['Red foods', 'Bitter greens', 'Hawthorn', 'Lotus seed', 'Wheat'],
  },
  {
    id: 'spleen',
    name: 'Spleen',
    governs: ['Digestion and transformation', 'Muscles', 'Lips', 'Blood containment'],
    emotionalAspect: 'Worry, pensiveness, and overthinking',
    imbalanceSymptoms: [
      'Poor appetite',
      'Bloating after eating',
      'Loose stools',
      'Fatigue',
      'Bruising easily',
      'Muscle weakness',
      'Overthinking',
    ],
    supportingFoods: ['Yellow/orange foods', 'Sweet potato', 'Rice', 'Cooked vegetables', 'Ginger'],
  },
  {
    id: 'lung',
    name: 'Lung',
    governs: ['Respiration', 'Skin', 'Wei Qi (immune)', 'Nose', 'Body hair'],
    emotionalAspect: 'Grief, sadness, and letting go',
    imbalanceSymptoms: [
      'Shortness of breath',
      'Frequent colds',
      'Dry skin',
      'Sinus issues',
      'Skin conditions',
      'Sadness or grief',
    ],
    supportingFoods: ['White foods', 'Pears', 'Radishes', 'Almonds', 'Honey'],
  },
  {
    id: 'kidney',
    name: 'Kidney',
    governs: ['Essence (Jing)', 'Bones', 'Marrow', 'Brain', 'Hearing', 'Hair on head'],
    emotionalAspect: 'Fear and willpower',
    imbalanceSymptoms: [
      'Low back pain',
      'Knee weakness',
      'Frequent urination',
      'Low libido',
      'Premature aging',
      'Hearing loss',
      'Fear and anxiety',
    ],
    supportingFoods: ['Black foods', 'Kidney beans', 'Walnuts', 'Seaweed', 'Bone broth'],
  },
];

export const FUNCTIONAL_SYSTEMS: FunctionalSystemInfo[] = [
  {
    id: 'blood_sugar',
    name: 'Blood Sugar Regulation',
    description: 'The body\'s ability to maintain stable glucose levels',
    keySymptoms: [
      'Energy crashes after meals',
      'Cravings for sugar/carbs',
      'Shakiness if meals delayed',
      'Afternoon fatigue',
      'Brain fog',
      'Difficulty losing weight',
    ],
    relatedBiomarkers: ['Fasting glucose', 'HbA1c', 'Fasting insulin', 'HOMA-IR', 'Triglycerides'],
    rootCauses: [
      'Insulin resistance',
      'Chronic stress (cortisol)',
      'Sedentary lifestyle',
      'High glycemic diet',
      'Sleep deprivation',
      'Gut dysbiosis',
    ],
    supportStrategies: [
      'Low glycemic diet',
      'Protein with every meal',
      'Post-meal walks',
      'Strength training',
      'Chromium and berberine',
    ],
  },
  {
    id: 'inflammation',
    name: 'Inflammation & Immune Activation',
    description: 'Chronic inflammatory responses affecting multiple systems',
    keySymptoms: [
      'Joint pain',
      'Skin issues',
      'Fatigue',
      'Brain fog',
      'Digestive issues',
      'Weight gain',
    ],
    relatedBiomarkers: ['hs-CRP', 'ESR', 'Ferritin', 'Homocysteine', 'IL-6', 'TNF-alpha'],
    rootCauses: [
      'Food sensitivities',
      'Gut permeability',
      'Chronic infections',
      'Toxin exposure',
      'Stress',
      'Poor sleep',
    ],
    supportStrategies: [
      'Elimination diet',
      'Omega-3 fatty acids',
      'Turmeric/curcumin',
      'Gut healing protocol',
      'Stress management',
    ],
  },
  {
    id: 'gut_function',
    name: 'Gut Function & Absorption',
    description: 'Digestive capacity, microbiome balance, and intestinal integrity',
    keySymptoms: [
      'Bloating',
      'Gas',
      'Irregular bowel movements',
      'Food reactions',
      'Nutrient deficiencies',
      'Skin issues',
    ],
    relatedBiomarkers: ['Stool analysis', 'Zonulin', 'Calprotectin', 'sIgA', 'Organic acids'],
    rootCauses: [
      'SIBO/SIFO',
      'Dysbiosis',
      'Low stomach acid',
      'Enzyme insufficiency',
      'Food sensitivities',
      'Stress',
    ],
    supportStrategies: [
      'Identify and remove triggers',
      'Support digestion (HCl, enzymes)',
      'Repair gut lining (L-glutamine)',
      'Restore microbiome',
      'Stress reduction',
    ],
  },
  {
    id: 'detoxification',
    name: 'Detoxification Pathways',
    description: 'The body\'s ability to process and eliminate toxins',
    keySymptoms: [
      'Chemical sensitivity',
      'Headaches',
      'Skin issues',
      'Fatigue',
      'Brain fog',
      'Hormone imbalances',
    ],
    relatedBiomarkers: ['Liver enzymes (AST/ALT)', 'GGT', 'Bilirubin', 'Organic acids', 'Heavy metals'],
    rootCauses: [
      'Genetic SNPs (MTHFR, GST)',
      'Toxin overload',
      'Nutrient deficiencies',
      'Poor elimination',
      'Gut dysfunction',
    ],
    supportStrategies: [
      'Support Phase 1 and 2 liver detox',
      'Methylation support',
      'Glutathione precursors',
      'Binders when appropriate',
      'Sweating (sauna)',
    ],
  },
  {
    id: 'hormone_signaling',
    name: 'Hormone Signaling',
    description: 'Endocrine function including thyroid, adrenal, and sex hormones',
    keySymptoms: [
      'Fatigue',
      'Weight changes',
      'Mood changes',
      'Temperature dysregulation',
      'Sleep issues',
      'Libido changes',
    ],
    relatedBiomarkers: ['TSH', 'Free T3/T4', 'Cortisol rhythm', 'DHEA-S', 'Estrogen/Progesterone', 'Testosterone'],
    rootCauses: [
      'HPA axis dysfunction',
      'Thyroid dysfunction',
      'Sex hormone imbalance',
      'Inflammation',
      'Nutrient deficiencies',
      'Toxin exposure',
    ],
    supportStrategies: [
      'Identify root imbalance',
      'Support adrenal function',
      'Optimize thyroid nutrients',
      'Balance estrogen metabolism',
      'Stress management',
    ],
  },
  {
    id: 'mitochondrial',
    name: 'Mitochondrial Energy Production',
    description: 'Cellular energy generation affecting all body systems',
    keySymptoms: [
      'Profound fatigue',
      'Exercise intolerance',
      'Brain fog',
      'Muscle weakness',
      'Poor recovery',
      'Cold intolerance',
    ],
    relatedBiomarkers: ['Organic acids', 'CoQ10', 'Carnitine', 'B vitamins', 'Lactate/pyruvate'],
    rootCauses: [
      'Nutrient deficiencies (CoQ10, B vitamins)',
      'Oxidative stress',
      'Toxin exposure',
      'Chronic infection',
      'Genetic factors',
    ],
    supportStrategies: [
      'CoQ10 supplementation',
      'B vitamins (methylated)',
      'Carnitine',
      'NAD+ precursors',
      'Reduce oxidative stress',
    ],
  },
  {
    id: 'nervous_system',
    name: 'Nervous System Regulation',
    description: 'Balance between sympathetic and parasympathetic tone',
    keySymptoms: [
      'Anxiety',
      'Poor stress tolerance',
      'Sleep issues',
      'Digestive problems',
      'Heart rate variability',
      'Hypervigilance',
    ],
    relatedBiomarkers: ['Cortisol awakening response', 'HRV', 'Neurotransmitter testing', 'Organic acids'],
    rootCauses: [
      'Chronic stress',
      'Trauma/PTSD',
      'Poor vagal tone',
      'Neurotransmitter imbalance',
      'Blood sugar dysregulation',
    ],
    supportStrategies: [
      'Vagal nerve stimulation',
      'Breathwork',
      'Meditation',
      'Adaptogens',
      'GABA support',
      'Sleep optimization',
    ],
  },
  {
    id: 'immune_activation',
    name: 'Immune System Activation',
    description: 'Appropriate immune response without over or under activity',
    keySymptoms: [
      'Frequent infections',
      'Autoimmune symptoms',
      'Allergies',
      'Chronic fatigue',
      'Slow wound healing',
    ],
    relatedBiomarkers: ['WBC with differential', 'Immunoglobulins', 'ANA', 'Complement', 'NK cell function'],
    rootCauses: [
      'Chronic infections',
      'Gut dysbiosis',
      'Nutrient deficiencies',
      'Toxin exposure',
      'Chronic stress',
      'Autoimmunity',
    ],
    supportStrategies: [
      'Address chronic infections',
      'Support gut immune axis',
      'Vitamin D optimization',
      'Zinc and selenium',
      'Immune modulators',
    ],
  },
];

export const SYMPTOM_TO_PATTERN_MAP: Record<string, (TCMPattern | FunctionalSystem)[]> = {
  fatigue: ['qi_deficiency', 'yang_deficiency', 'blood_deficiency', 'mitochondrial', 'hormone_signaling'],
  brain_fog: ['dampness', 'phlegm', 'qi_deficiency', 'inflammation', 'blood_sugar'],
  anxiety: ['qi_stagnation', 'yin_deficiency', 'heat', 'nervous_system'],
  insomnia: ['yin_deficiency', 'blood_deficiency', 'heat', 'nervous_system'],
  bloating: ['dampness', 'qi_stagnation', 'gut_function'],
  cold_intolerance: ['yang_deficiency', 'cold', 'hormone_signaling', 'mitochondrial'],
  hot_flashes: ['yin_deficiency', 'heat', 'hormone_signaling'],
  joint_pain: ['blood_stasis', 'dampness', 'wind', 'inflammation'],
  skin_issues: ['heat', 'dampness', 'blood_deficiency', 'inflammation', 'detoxification'],
  digestive_issues: ['qi_deficiency', 'dampness', 'qi_stagnation', 'gut_function'],
  mood_swings: ['qi_stagnation', 'blood_deficiency', 'yin_deficiency', 'hormone_signaling', 'nervous_system'],
  low_libido: ['yang_deficiency', 'blood_deficiency', 'hormone_signaling'],
  weight_gain: ['dampness', 'phlegm', 'yang_deficiency', 'blood_sugar', 'hormone_signaling'],
  headaches: ['qi_stagnation', 'blood_stasis', 'wind', 'inflammation'],
  muscle_weakness: ['qi_deficiency', 'blood_deficiency', 'mitochondrial'],
};

export const CLINICAL_AI_SYSTEM_PROMPT = `You are a clinical decision-support AI operating within a functional medicine and Traditional Chinese Medicine (TCM) framework. Your role is to analyze user-provided data, identify clinically relevant patterns, and explain correlations in a clear, patient-friendly way while maintaining medical caution.

CORE FRAMEWORK:

1. FUNCTIONAL MEDICINE LENS - Analyze through these systems:
- Blood sugar regulation
- Inflammation & immune activation
- Gut function & absorption
- Detoxification pathways
- Hormone signaling
- Mitochondrial energy production
- Nervous system regulation (sympathetic vs parasympathetic)

2. TCM PATTERN RECOGNITION - Overlay these patterns:
- Qi deficiency vs stagnation
- Blood deficiency or stasis
- Yin/Yang imbalance
- Dampness, heat, cold patterns
- Organ system associations (Liver, Spleen, Kidney, Heart, Lung)

3. COMMUNICATION RULES:
- Always anchor analysis to the chief complaint
- Use probabilistic language (may, might, suggests, could indicate)
- Translate TCM concepts into modern terms
- Explain correlations, not conclusions
- Separate what is known vs suspected vs needs clarification
- Be supportive, not fear-based
- Use analogies when helpful

4. RESPONSE STRUCTURE:
a) What stands out (key patterns)
b) How it may relate to symptoms
c) What additional info would improve accuracy
d) Reassurance and next-step framing

5. DIETARY RECOMMENDATIONS:
- Recommend foods based on TCM patterns
- Consider functional medicine principles
- Account for any contraindications

CRITICAL DISCLAIMERS:
- This is for educational purposes only
- Not a diagnosis or medical advice
- Always recommend consulting qualified healthcare practitioners
- Never suggest stopping prescribed medications`;

export const DIFFERENTIATING_QUESTIONS: Record<string, string[]> = {
  fatigue: [
    'Does your fatigue feel worse in the morning or evening?',
    'Does rest improve your energy, or do you feel tired even after sleep?',
    'Does your fatigue worsen after physical activity or mental exertion?',
    'Do you notice any pattern with meals - better or worse after eating?',
  ],
  digestive: [
    'Do symptoms occur within 1-2 hours after eating, or later?',
    'Are symptoms worse with certain foods (fatty, spicy, cold)?',
    'Do you have more bloating, gas, pain, or changes in stool?',
    'Do symptoms improve or worsen with stress?',
  ],
  pain: [
    'Is the pain fixed in one location or does it move around?',
    'Is it sharp/stabbing or dull/achy?',
    'Does warmth or cold make it better or worse?',
    'Does the pain have any pattern with your menstrual cycle (if applicable)?',
  ],
  mood: [
    'Do mood changes follow any pattern (time of day, menstrual cycle)?',
    'Are you more anxious, irritable, or sad?',
    'Do you feel worse under stress or does stress not seem related?',
    'How is your sleep affecting your mood?',
  ],
  hormonal: [
    'For women: Where are you in your menstrual cycle or menopausal transition?',
    'Do symptoms fluctuate with your cycle?',
    'Have you noticed changes in libido, temperature regulation, or weight?',
    'What time of day do symptoms tend to be worst?',
  ],
};
