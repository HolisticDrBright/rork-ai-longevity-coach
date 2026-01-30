export interface FoodRule {
  id: string;
  ruleSetName: 'AIP' | 'LOW_FODMAP' | 'KETO' | 'LOW_HISTAMINE';
  forbiddenTags: string[];
  cautionTags: string[];
  notes: string;
}

export const foodRules: FoodRule[] = [
  {
    id: 'rule_aip',
    ruleSetName: 'AIP',
    forbiddenTags: [
      'gluten',
      'dairy',
      'eggs',
      'nightshade',
      'alcohol',
      'seed_oil',
      'legumes',
      'grains',
      'nuts',
      'seeds',
      'refined_sugar',
      'food_additives',
      'nsaids',
    ],
    cautionTags: [
      'coffee',
      'chocolate',
      'egg_yolk',
      'ghee',
      'grass_fed_butter',
    ],
    notes: 'Autoimmune Protocol focuses on eliminating inflammatory foods to heal the gut and reduce autoimmune symptoms.',
  },
  {
    id: 'rule_low_fodmap',
    ruleSetName: 'LOW_FODMAP',
    forbiddenTags: [
      'high_fodmap',
      'garlic',
      'onion',
      'wheat',
      'rye',
      'barley',
      'apple',
      'pear',
      'watermelon',
      'mango',
      'beans',
      'lentils',
      'chickpeas',
      'lactose',
      'honey',
      'high_fructose_corn_syrup',
      'sorbitol',
      'mannitol',
      'xylitol',
      'cauliflower',
      'mushrooms',
      'asparagus',
    ],
    cautionTags: [
      'moderate_fodmap',
      'avocado',
      'sweet_potato',
      'broccoli',
    ],
    notes: 'Low FODMAP diet reduces fermentable carbohydrates that can cause IBS symptoms.',
  },
  {
    id: 'rule_keto',
    ruleSetName: 'KETO',
    forbiddenTags: [
      'high_carb',
      'sugar',
      'grains',
      'starchy_vegetables',
      'fruit_high_sugar',
      'bread',
      'pasta',
      'rice',
      'potato',
      'corn',
      'beans',
      'honey',
      'maple_syrup',
      'agave',
    ],
    cautionTags: [
      'moderate_carb',
      'fruit',
      'root_vegetables',
      'quinoa',
    ],
    notes: 'Ketogenic diet limits carbs to 20-50g/day to maintain ketosis. Net carbs = total carbs - fiber.',
  },
  {
    id: 'rule_low_histamine',
    ruleSetName: 'LOW_HISTAMINE',
    forbiddenTags: [
      'high_histamine',
      'histamine_liberator',
      'fermented',
      'aged_cheese',
      'alcohol',
      'vinegar',
      'cured_meat',
      'smoked_fish',
      'shellfish',
      'sauerkraut',
      'kimchi',
      'soy_sauce',
      'fish_sauce',
      'leftover_meat',
      'canned_fish',
      'aged_meat',
    ],
    cautionTags: [
      'citrus',
      'tomato',
      'spinach',
      'eggplant',
      'avocado',
      'strawberry',
      'pineapple',
      'papaya',
      'banana_ripe',
      'chocolate',
      'nuts',
      'egg_white',
    ],
    notes: 'Low histamine diet avoids foods that contain or trigger histamine release.',
  },
];

export const dietDescriptions: Record<string, { name: string; description: string; benefits: string[] }> = {
  AIP: {
    name: 'Autoimmune Protocol (AIP)',
    description: 'An elimination diet designed to reduce inflammation and heal the gut for those with autoimmune conditions.',
    benefits: [
      'Reduces systemic inflammation',
      'Supports gut healing',
      'Identifies food sensitivities',
      'May reduce autoimmune flares',
    ],
  },
  LOW_FODMAP: {
    name: 'Low FODMAP',
    description: 'A diet that limits fermentable carbohydrates to reduce IBS and digestive symptoms.',
    benefits: [
      'Reduces bloating and gas',
      'Eases IBS symptoms',
      'Improves gut motility',
      'Identifies trigger foods',
    ],
  },
  KETO: {
    name: 'Ketogenic',
    description: 'A very low-carb, high-fat diet that puts the body into a metabolic state called ketosis.',
    benefits: [
      'Promotes fat burning',
      'Stabilizes blood sugar',
      'Reduces hunger/cravings',
      'May improve mental clarity',
    ],
  },
  LOW_HISTAMINE: {
    name: 'Low Histamine',
    description: 'A diet that avoids foods high in histamine or that trigger histamine release.',
    benefits: [
      'Reduces allergy-like symptoms',
      'Eases headaches/migraines',
      'Improves skin conditions',
      'Reduces digestive issues',
    ],
  },
};

export const swapSuggestions: Record<string, { violation: string; suggestion: string; affiliateCategory?: string }> = {
  gluten: {
    violation: 'Contains gluten',
    suggestion: 'Try gluten-free alternatives like rice flour, almond flour, coconut flour, or cassava flour.',
    affiliateCategory: 'gluten_free',
  },
  dairy: {
    violation: 'Contains dairy',
    suggestion: 'Use coconut milk, almond milk, cashew cheese, or coconut yogurt instead.',
    affiliateCategory: 'dairy_free',
  },
  eggs: {
    violation: 'Contains eggs',
    suggestion: 'Try flax eggs (1 tbsp ground flax + 3 tbsp water) or chia eggs for baking.',
  },
  nightshade: {
    violation: 'Contains nightshades',
    suggestion: 'Replace with carrots, beets, sweet potatoes, or cauliflower.',
  },
  high_fodmap: {
    violation: 'High in FODMAPs',
    suggestion: 'Choose low-FODMAP alternatives like zucchini, carrots, spinach, or firm tofu.',
  },
  garlic: {
    violation: 'Contains garlic (high FODMAP)',
    suggestion: 'Use garlic-infused oil (strain out garlic solids) or asafoetida powder.',
  },
  onion: {
    violation: 'Contains onion (high FODMAP)',
    suggestion: 'Try the green part of scallions, chives, or leek leaves instead.',
  },
  high_carb: {
    violation: 'High in carbohydrates',
    suggestion: 'Swap for cauliflower rice, zucchini noodles, or leafy greens.',
  },
  grains: {
    violation: 'Contains grains',
    suggestion: 'Use cauliflower rice, shirataki noodles, or vegetable-based alternatives.',
  },
  sugar: {
    violation: 'Contains added sugar',
    suggestion: 'Try stevia, monk fruit, erythritol, or small amounts of raw honey (if not FODMAP restricted).',
  },
  high_histamine: {
    violation: 'High in histamine',
    suggestion: 'Choose fresh meats (cooked immediately), fresh vegetables, and avoid aged/fermented foods.',
  },
  fermented: {
    violation: 'Fermented food (high histamine)',
    suggestion: 'Opt for fresh, unfermented versions of the food.',
  },
  legumes: {
    violation: 'Contains legumes',
    suggestion: 'Replace with vegetables or moderate amounts of nuts (if tolerated).',
  },
  seed_oil: {
    violation: 'Contains seed/vegetable oils',
    suggestion: 'Use olive oil, avocado oil, coconut oil, or animal fats instead.',
  },
};
