export type SupplementCategory = 
  | 'fish_oil'
  | 'blood_sugar'
  | 'vitamin_d'
  | 'fat_soluble_vitamins'
  | 'liver_support'
  | 'glutathione'
  | 'multi_foundation'
  | 'nac'
  | 'gut_health'
  | 'sleep'
  | 'stress'
  | 'energy'
  | 'detox'
  | 'immune'
  | 'cognitive'
  | 'hormone_support'
  | 'joint_support'
  | 'cardiovascular'
  | 'metabolic_health';

export type SupplementForm = 
  | 'capsule'
  | 'softgel'
  | 'liquid'
  | 'powder'
  | 'transdermal'
  | 'liposomal'
  | 'chewable'
  | 'sublingual';

export type AffiliateChannel = 'fullscript' | 'direct' | 'amazon';

export interface SupplementAffiliateUrls {
  fullscript_affiliate_url?: string;
  direct_affiliate_url?: string;
  fallback_url?: string;
}

export interface SupplementIngredient {
  name: string;
  amount?: string;
  unit?: string;
  form?: string;
}

export interface SupplementContraindication {
  condition: string;
  severity: 'absolute' | 'relative' | 'caution';
  notes?: string;
}

export interface SupplementInteraction {
  medication: string;
  severity: 'major' | 'moderate' | 'minor';
  notes?: string;
}

export interface CuratedProduct {
  id: string;
  name: string;
  brand: string;
  description: string;
  imageUrl?: string;
  form: SupplementForm;
  servingSize: string;
  servingsPerContainer?: number;
  categories: SupplementCategory[];
  useCaseTags: string[];
  ingredients: SupplementIngredient[];
  ingredientCoverage: string[];
  affiliateUrls: SupplementAffiliateUrls;
  priority: number;
  isPreferredMulti: boolean;
  contraindications: SupplementContraindication[];
  interactions: SupplementInteraction[];
  pregnancySafe: boolean;
  lactationSafe: boolean;
  vegetarian: boolean;
  vegan: boolean;
  glutenFree: boolean;
  dairyFree: boolean;
  suggestedDose?: string;
  timing?: string;
  notes?: string;
  priceRange?: 'budget' | 'moderate' | 'premium';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplementRecommendation {
  product: CuratedProduct;
  matchScore: number;
  matchedNeeds: string[];
  rationale: string;
  howToTake: string;
  safetyFlags: string[];
  affiliateUrl: string;
  affiliateChannel: AffiliateChannel;
}

export interface RecommendationBundle {
  products: SupplementRecommendation[];
  totalCoverage: string[];
  uncoveredNeeds: string[];
  totalProducts: number;
  bundleRationale: string;
}

export interface PatientSupplementNeeds {
  goals: string[];
  conditions: string[];
  labDeficiencies: string[];
  medications: string[];
  allergies: string[];
  preferences: PatientPreferences;
}

export interface PatientPreferences {
  preferredForms?: SupplementForm[];
  avoidForms?: SupplementForm[];
  budget?: 'budget' | 'moderate' | 'premium' | 'any';
  vegetarian?: boolean;
  vegan?: boolean;
  maxProducts?: number;
  pregnantOrNursing?: boolean;
}

export interface SupplementClickEvent {
  id: string;
  patientId: string;
  productId: string;
  affiliateChannel: AffiliateChannel;
  affiliateUrl: string;
  timestamp: string;
  campaignTag?: string;
  source?: string;
}

export interface AdminProductInput {
  name: string;
  brand: string;
  description: string;
  imageUrl?: string;
  form: SupplementForm;
  servingSize: string;
  servingsPerContainer?: number;
  categories: SupplementCategory[];
  useCaseTags: string[];
  ingredients: SupplementIngredient[];
  ingredientCoverage: string[];
  affiliateUrls: SupplementAffiliateUrls;
  priority: number;
  isPreferredMulti: boolean;
  contraindications: SupplementContraindication[];
  interactions: SupplementInteraction[];
  pregnancySafe: boolean;
  lactationSafe: boolean;
  vegetarian: boolean;
  vegan: boolean;
  glutenFree: boolean;
  dairyFree: boolean;
  suggestedDose?: string;
  timing?: string;
  notes?: string;
  priceRange?: 'budget' | 'moderate' | 'premium';
}

export const FTC_DISCLOSURE = `Affiliate Disclosure: Some links on this page are affiliate links. This means we may earn a small commission if you purchase through these links, at no additional cost to you. This helps support our practice and allows us to continue providing valuable health information. We only recommend products we trust and believe will benefit your health.`;

export const MEDICAL_DISCLAIMER = `Medical Disclaimer: The information provided here is for educational and informational purposes only and is not intended as medical advice. These supplement recommendations are not meant to diagnose, treat, cure, or prevent any disease. Always consult with a qualified healthcare provider before starting any new supplement regimen, especially if you are pregnant, nursing, have a medical condition, or are taking medications. Individual results may vary.`;
