import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../create-context";

const SupplementFormSchema = z.enum([
  'capsule', 'softgel', 'liquid', 'powder', 'transdermal', 'liposomal', 'chewable', 'sublingual'
]);

const SupplementCategorySchema = z.enum([
  'fish_oil', 'blood_sugar', 'vitamin_d', 'fat_soluble_vitamins', 'liver_support',
  'glutathione', 'multi_foundation', 'nac', 'gut_health', 'sleep', 'stress',
  'energy', 'detox', 'immune', 'cognitive', 'hormone_support', 'joint_support', 'cardiovascular'
]);

const AffiliateChannelSchema = z.enum(['fullscript', 'direct', 'amazon']);

const IngredientSchema = z.object({
  name: z.string(),
  amount: z.string().optional(),
  unit: z.string().optional(),
  form: z.string().optional(),
});

const ContraindicationSchema = z.object({
  condition: z.string(),
  severity: z.enum(['absolute', 'relative', 'caution']),
  notes: z.string().optional(),
});

const InteractionSchema = z.object({
  medication: z.string(),
  severity: z.enum(['major', 'moderate', 'minor']),
  notes: z.string().optional(),
});

const AffiliateUrlsSchema = z.object({
  fullscript_affiliate_url: z.string().optional(),
  direct_affiliate_url: z.string().optional(),
  fallback_url: z.string().optional(),
});

const ProductInputSchema = z.object({
  name: z.string().min(1),
  brand: z.string().min(1),
  description: z.string(),
  imageUrl: z.string().optional(),
  form: SupplementFormSchema,
  servingSize: z.string(),
  servingsPerContainer: z.number().optional(),
  categories: z.array(SupplementCategorySchema),
  useCaseTags: z.array(z.string()),
  ingredients: z.array(IngredientSchema),
  ingredientCoverage: z.array(z.string()),
  affiliateUrls: AffiliateUrlsSchema,
  priority: z.number().min(1).max(10),
  isPreferredMulti: z.boolean(),
  contraindications: z.array(ContraindicationSchema),
  interactions: z.array(InteractionSchema),
  pregnancySafe: z.boolean(),
  lactationSafe: z.boolean(),
  vegetarian: z.boolean(),
  vegan: z.boolean(),
  glutenFree: z.boolean(),
  dairyFree: z.boolean(),
  suggestedDose: z.string().optional(),
  timing: z.string().optional(),
  notes: z.string().optional(),
  priceRange: z.enum(['budget', 'moderate', 'premium']).optional(),
});

const PatientPreferencesSchema = z.object({
  preferredForms: z.array(SupplementFormSchema).optional(),
  avoidForms: z.array(SupplementFormSchema).optional(),
  budget: z.enum(['budget', 'moderate', 'premium', 'any']).optional(),
  vegetarian: z.boolean().optional(),
  vegan: z.boolean().optional(),
  maxProducts: z.number().optional(),
  pregnantOrNursing: z.boolean().optional(),
});

const PatientNeedsSchema = z.object({
  goals: z.array(z.string()),
  conditions: z.array(z.string()),
  labDeficiencies: z.array(z.string()),
  medications: z.array(z.string()),
  allergies: z.array(z.string()),
  preferences: PatientPreferencesSchema,
});

const ClickEventSchema = z.object({
  patientId: z.string(),
  productId: z.string(),
  affiliateChannel: AffiliateChannelSchema,
  affiliateUrl: z.string(),
  campaignTag: z.string().optional(),
  source: z.string().optional(),
});

export const supplementsRouter = createTRPCRouter({
  getProducts: publicProcedure
    .input(z.object({
      category: SupplementCategorySchema.optional(),
      activeOnly: z.boolean().optional().default(true),
    }).optional())
    .query(async ({ input }) => {
      console.log('[Supplements API] Getting products with filter:', input);
      return {
        success: true,
        message: 'Products retrieved from client-side storage',
        filter: input,
      };
    }),

  getProduct: publicProcedure
    .input(z.object({ productId: z.string() }))
    .query(async ({ input }) => {
      console.log('[Supplements API] Getting product:', input.productId);
      return {
        success: true,
        productId: input.productId,
        message: 'Product retrieved from client-side storage',
      };
    }),

  createProduct: publicProcedure
    .input(ProductInputSchema)
    .mutation(async ({ input }) => {
      console.log('[Supplements API] Creating product:', input.name);
      const productId = `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      return {
        success: true,
        productId,
        message: `Product "${input.name}" created successfully`,
      };
    }),

  updateProduct: publicProcedure
    .input(z.object({
      productId: z.string(),
      updates: ProductInputSchema.partial(),
    }))
    .mutation(async ({ input }) => {
      console.log('[Supplements API] Updating product:', input.productId);
      return {
        success: true,
        productId: input.productId,
        message: 'Product updated successfully',
      };
    }),

  deleteProduct: publicProcedure
    .input(z.object({ productId: z.string() }))
    .mutation(async ({ input }) => {
      console.log('[Supplements API] Deleting product:', input.productId);
      return {
        success: true,
        productId: input.productId,
        message: 'Product deleted successfully',
      };
    }),

  getRecommendations: publicProcedure
    .input(PatientNeedsSchema)
    .mutation(async ({ input }) => {
      console.log('[Supplements API] Generating recommendations for:', input);
      return {
        success: true,
        message: 'Recommendations generated on client-side',
        needsReceived: {
          goals: input.goals.length,
          conditions: input.conditions.length,
          medications: input.medications.length,
        },
      };
    }),

  trackClick: publicProcedure
    .input(ClickEventSchema)
    .mutation(async ({ input }) => {
      const eventId = `click_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      console.log('[Supplements API] Click tracked:', {
        eventId,
        patientId: input.patientId,
        productId: input.productId,
        channel: input.affiliateChannel,
        timestamp: new Date().toISOString(),
      });
      return {
        success: true,
        eventId,
        message: 'Click tracked successfully',
      };
    }),

  getClickStats: publicProcedure
    .input(z.object({
      productId: z.string().optional(),
      patientId: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      console.log('[Supplements API] Getting click stats:', input);
      return {
        success: true,
        message: 'Click stats retrieved from client-side storage',
        filter: input,
      };
    }),

  validateAffiliateUrl: publicProcedure
    .input(z.object({
      url: z.string().url(),
      channel: AffiliateChannelSchema,
    }))
    .mutation(async ({ input }) => {
      console.log('[Supplements API] Validating affiliate URL:', input.url);
      const isValid = input.url.startsWith('http');
      return {
        success: true,
        isValid,
        url: input.url,
        channel: input.channel,
      };
    }),
});
