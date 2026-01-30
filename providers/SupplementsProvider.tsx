import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useCallback, useMemo } from 'react';

import {
  CuratedProduct,
  SupplementRecommendation,
  RecommendationBundle,
  PatientSupplementNeeds,
  PatientPreferences,
  SupplementClickEvent,
  AffiliateChannel,
} from '@/types/supplements';
import {
  CURATED_PRODUCTS,
  NEED_TO_INGREDIENT_MAP,
  CONDITION_TO_NEEDS_MAP,
  GOAL_TO_NEEDS_MAP,
} from '@/mocks/curatedProducts';

const STORAGE_KEYS = {
  CUSTOM_PRODUCTS: 'supplements_custom_products',
  CLICK_EVENTS: 'supplements_click_events',
};

const DEFAULT_MAX_PRODUCTS = 5;

export const [SupplementsProvider, useSupplements] = createContextHook(() => {
  const queryClient = useQueryClient();
  const [customProducts, setCustomProducts] = useState<CuratedProduct[]>([]);
  const [clickEvents, setClickEvents] = useState<SupplementClickEvent[]>([]);

  const customProductsQuery = useQuery({
    queryKey: ['customProducts'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.CUSTOM_PRODUCTS);
      return stored ? JSON.parse(stored) : [];
    },
  });

  const clickEventsQuery = useQuery({
    queryKey: ['clickEvents'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.CLICK_EVENTS);
      return stored ? JSON.parse(stored) : [];
    },
  });

  useEffect(() => {
    if (customProductsQuery.data) setCustomProducts(customProductsQuery.data);
  }, [customProductsQuery.data]);

  useEffect(() => {
    if (clickEventsQuery.data) setClickEvents(clickEventsQuery.data);
  }, [clickEventsQuery.data]);

  const allProducts = useMemo(() => {
    const combined = [...CURATED_PRODUCTS, ...customProducts];
    return combined.filter(p => p.isActive).sort((a, b) => a.priority - b.priority);
  }, [customProducts]);

  const { mutate: saveCustomProducts } = useMutation({
    mutationFn: async (products: CuratedProduct[]) => {
      await AsyncStorage.setItem(STORAGE_KEYS.CUSTOM_PRODUCTS, JSON.stringify(products));
      return products;
    },
    onSuccess: (data) => {
      setCustomProducts(data);
      queryClient.invalidateQueries({ queryKey: ['customProducts'] });
    },
  });

  const { mutate: saveClickEvents } = useMutation({
    mutationFn: async (events: SupplementClickEvent[]) => {
      await AsyncStorage.setItem(STORAGE_KEYS.CLICK_EVENTS, JSON.stringify(events));
      return events;
    },
    onSuccess: (data) => {
      setClickEvents(data);
      queryClient.invalidateQueries({ queryKey: ['clickEvents'] });
    },
  });

  const expandNeeds = useCallback((needs: PatientSupplementNeeds): string[] => {
    const allNeeds = new Set<string>();

    needs.goals.forEach(goal => {
      const mapped = GOAL_TO_NEEDS_MAP[goal.toLowerCase()];
      if (mapped) mapped.forEach(n => allNeeds.add(n));
      allNeeds.add(goal.toLowerCase());
    });

    needs.conditions.forEach(condition => {
      const mapped = CONDITION_TO_NEEDS_MAP[condition.toLowerCase()];
      if (mapped) mapped.forEach(n => allNeeds.add(n));
      allNeeds.add(condition.toLowerCase());
    });

    needs.labDeficiencies.forEach(deficiency => {
      allNeeds.add(deficiency.toLowerCase());
    });

    return Array.from(allNeeds);
  }, []);

  const getTargetIngredients = useCallback((expandedNeeds: string[]): string[] => {
    const ingredients = new Set<string>();

    expandedNeeds.forEach(need => {
      const mapped = NEED_TO_INGREDIENT_MAP[need.toLowerCase()];
      if (mapped) {
        mapped.forEach(i => ingredients.add(i.toLowerCase()));
      }
    });

    return Array.from(ingredients);
  }, []);

  const checkContraindications = useCallback((
    product: CuratedProduct,
    needs: PatientSupplementNeeds
  ): string[] => {
    const flags: string[] = [];

    if (needs.preferences.pregnantOrNursing) {
      if (!product.pregnancySafe) {
        flags.push('Not recommended during pregnancy');
      }
      if (!product.lactationSafe) {
        flags.push('Not recommended while nursing');
      }
    }

    product.contraindications.forEach(contra => {
      const hasCondition = needs.conditions.some(c => 
        c.toLowerCase().includes(contra.condition.toLowerCase())
      );
      if (hasCondition) {
        if (contra.severity === 'absolute') {
          flags.push(`CONTRAINDICATED: ${contra.condition}${contra.notes ? ` - ${contra.notes}` : ''}`);
        } else {
          flags.push(`Caution: ${contra.condition}${contra.notes ? ` - ${contra.notes}` : ''}`);
        }
      }
    });

    product.interactions.forEach(interaction => {
      const hasMed = needs.medications.some(m =>
        m.toLowerCase().includes(interaction.medication.toLowerCase()) ||
        interaction.medication.toLowerCase().includes(m.toLowerCase())
      );
      if (hasMed) {
        const severity = interaction.severity === 'major' ? 'MAJOR' : 
                        interaction.severity === 'moderate' ? 'Moderate' : 'Minor';
        flags.push(`${severity} interaction with ${interaction.medication}${interaction.notes ? ` - ${interaction.notes}` : ''}`);
      }
    });

    const hasAllergy = needs.allergies.some(allergy => {
      const allergyLower = allergy.toLowerCase();
      return product.ingredients.some(i => i.name.toLowerCase().includes(allergyLower)) ||
             product.name.toLowerCase().includes(allergyLower) ||
             product.useCaseTags.some(t => t.toLowerCase().includes(allergyLower));
    });
    if (hasAllergy) {
      flags.push('Potential allergen detected');
    }

    return flags;
  }, []);

  const calculateMatchScore = useCallback((
    product: CuratedProduct,
    targetIngredients: string[],
    expandedNeeds: string[]
  ): { score: number; matchedNeeds: string[] } => {
    const matchedNeeds: string[] = [];
    let score = 0;

    const productIngredients = product.ingredientCoverage.map(i => i.toLowerCase());
    const productTags = product.useCaseTags.map(t => t.toLowerCase());

    targetIngredients.forEach(target => {
      if (productIngredients.includes(target) || productTags.includes(target)) {
        score += 10;
        const relatedNeeds = Object.entries(NEED_TO_INGREDIENT_MAP)
          .filter(([_, ingredients]) => ingredients.map(i => i.toLowerCase()).includes(target))
          .map(([need]) => need);
        relatedNeeds.forEach(n => {
          if (!matchedNeeds.includes(n)) matchedNeeds.push(n);
        });
      }
    });

    expandedNeeds.forEach(need => {
      if (productTags.includes(need) || product.categories.some(c => c.includes(need))) {
        score += 5;
        if (!matchedNeeds.includes(need)) matchedNeeds.push(need);
      }
    });

    if (product.isPreferredMulti) {
      score += 15;
    }

    score += (10 - product.priority) * 2;

    return { score, matchedNeeds };
  }, []);

  const filterByPreferences = useCallback((
    product: CuratedProduct,
    preferences: PatientPreferences
  ): boolean => {
    if (preferences.preferredForms?.length && !preferences.preferredForms.includes(product.form)) {
      return false;
    }
    if (preferences.avoidForms?.includes(product.form)) {
      return false;
    }
    if (preferences.vegetarian && !product.vegetarian) {
      return false;
    }
    if (preferences.vegan && !product.vegan) {
      return false;
    }
    if (preferences.budget && preferences.budget !== 'any' && product.priceRange !== preferences.budget) {
      if (preferences.budget === 'budget' && product.priceRange !== 'budget') {
        return false;
      }
    }
    return true;
  }, []);

  const selectMinimalSet = useCallback((
    scoredProducts: { product: CuratedProduct; score: number; matchedNeeds: string[]; safetyFlags: string[] }[],
    targetIngredients: string[],
    maxProducts: number
  ): { product: CuratedProduct; score: number; matchedNeeds: string[]; safetyFlags: string[] }[] => {
    const selected: typeof scoredProducts = [];
    const coveredIngredients = new Set<string>();
    const remainingProducts = [...scoredProducts];

    while (selected.length < maxProducts && remainingProducts.length > 0) {
      let bestIdx = -1;
      let bestScore = -1;
      let bestNewCoverage = 0;

      remainingProducts.forEach((item, idx) => {
        const productIngredients = item.product.ingredientCoverage.map(i => i.toLowerCase());
        const newCoverage = productIngredients.filter(i => 
          !coveredIngredients.has(i) && targetIngredients.includes(i)
        ).length;

        const adjustedScore = item.score + (newCoverage * 20);

        if (adjustedScore > bestScore || (adjustedScore === bestScore && newCoverage > bestNewCoverage)) {
          bestScore = adjustedScore;
          bestIdx = idx;
          bestNewCoverage = newCoverage;
        }
      });

      if (bestIdx === -1 || bestNewCoverage === 0 && selected.length > 0) {
        break;
      }

      const selectedItem = remainingProducts.splice(bestIdx, 1)[0];
      selected.push(selectedItem);

      selectedItem.product.ingredientCoverage.forEach(i => coveredIngredients.add(i.toLowerCase()));
    }

    return selected;
  }, []);

  const getAffiliateUrl = useCallback((product: CuratedProduct): { url: string; channel: AffiliateChannel } => {
    if (product.affiliateUrls.fullscript_affiliate_url) {
      return { url: product.affiliateUrls.fullscript_affiliate_url, channel: 'fullscript' };
    }
    if (product.affiliateUrls.direct_affiliate_url) {
      return { url: product.affiliateUrls.direct_affiliate_url, channel: 'direct' };
    }
    return { url: product.affiliateUrls.fallback_url || '', channel: 'direct' };
  }, []);

  const generateRationale = useCallback((product: CuratedProduct, matchedNeeds: string[]): string => {
    const needsList = matchedNeeds.slice(0, 3).join(', ');
    return `Recommended for: ${needsList}. ${product.description.split('.')[0]}.`;
  }, []);

  const generateHowToTake = useCallback((product: CuratedProduct): string => {
    let text = product.suggestedDose || `Take as directed on label`;
    if (product.timing) {
      text += `. ${product.timing}`;
    }
    if (product.notes) {
      text += ` ${product.notes}`;
    }
    return text;
  }, []);

  const getRecommendations = useCallback((needs: PatientSupplementNeeds): RecommendationBundle => {
    console.log('[Supplements] Generating recommendations for needs:', needs);

    const expandedNeeds = expandNeeds(needs);
    const targetIngredients = getTargetIngredients(expandedNeeds);
    const maxProducts = needs.preferences.maxProducts || DEFAULT_MAX_PRODUCTS;

    console.log('[Supplements] Expanded needs:', expandedNeeds);
    console.log('[Supplements] Target ingredients:', targetIngredients);

    const scoredProducts = allProducts
      .filter(p => filterByPreferences(p, needs.preferences))
      .map(product => {
        const { score, matchedNeeds } = calculateMatchScore(product, targetIngredients, expandedNeeds);
        const safetyFlags = checkContraindications(product, needs);
        return { product, score, matchedNeeds, safetyFlags };
      })
      .filter(item => item.score > 0)
      .filter(item => !item.safetyFlags.some(f => f.startsWith('CONTRAINDICATED')))
      .sort((a, b) => b.score - a.score);

    console.log('[Supplements] Scored products:', scoredProducts.length);

    const selectedProducts = selectMinimalSet(scoredProducts, targetIngredients, maxProducts);

    const recommendations: SupplementRecommendation[] = selectedProducts.map(item => {
      const { url, channel } = getAffiliateUrl(item.product);
      return {
        product: item.product,
        matchScore: item.score / 100,
        matchedNeeds: item.matchedNeeds,
        rationale: generateRationale(item.product, item.matchedNeeds),
        howToTake: generateHowToTake(item.product),
        safetyFlags: item.safetyFlags,
        affiliateUrl: url,
        affiliateChannel: channel,
      };
    });

    const totalCoverage = [...new Set(selectedProducts.flatMap(p => p.product.ingredientCoverage.map(i => i.toLowerCase())))];
    const uncoveredNeeds = targetIngredients.filter(i => !totalCoverage.includes(i));

    const bundle: RecommendationBundle = {
      products: recommendations,
      totalCoverage,
      uncoveredNeeds,
      totalProducts: recommendations.length,
      bundleRationale: `This bundle of ${recommendations.length} products covers ${totalCoverage.length} key ingredients based on your health needs. ${
        uncoveredNeeds.length > 0 
          ? `Some needs (${uncoveredNeeds.slice(0, 3).join(', ')}) may require additional products.`
          : 'All identified needs are addressed.'
      }`,
    };

    console.log('[Supplements] Final bundle:', bundle);
    return bundle;
  }, [allProducts, expandNeeds, getTargetIngredients, filterByPreferences, calculateMatchScore, checkContraindications, selectMinimalSet, getAffiliateUrl, generateRationale, generateHowToTake]);

  const trackClick = useCallback((
    patientId: string,
    productId: string,
    affiliateChannel: AffiliateChannel,
    affiliateUrl: string,
    campaignTag?: string,
    source?: string
  ) => {
    const event: SupplementClickEvent = {
      id: `click_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      patientId,
      productId,
      affiliateChannel,
      affiliateUrl,
      timestamp: new Date().toISOString(),
      campaignTag,
      source,
    };

    console.log('[Supplements] Tracking click:', event);
    const updated = [...clickEvents, event];
    saveClickEvents(updated);
  }, [clickEvents, saveClickEvents]);

  const addProduct = useCallback((product: Omit<CuratedProduct, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newProduct: CuratedProduct = {
      ...product,
      id: `prod_custom_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [...customProducts, newProduct];
    saveCustomProducts(updated);
    return newProduct;
  }, [customProducts, saveCustomProducts]);

  const updateProduct = useCallback((productId: string, updates: Partial<CuratedProduct>) => {
    const isBuiltIn = CURATED_PRODUCTS.some(p => p.id === productId);
    
    if (isBuiltIn) {
      const existingCustom = customProducts.find(p => p.id === productId);
      if (existingCustom) {
        const updated = customProducts.map(p => 
          p.id === productId ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
        );
        saveCustomProducts(updated);
      } else {
        const builtIn = CURATED_PRODUCTS.find(p => p.id === productId);
        if (builtIn) {
          const customized: CuratedProduct = {
            ...builtIn,
            ...updates,
            updatedAt: new Date().toISOString(),
          };
          saveCustomProducts([...customProducts, customized]);
        }
      }
    } else {
      const updated = customProducts.map(p => 
        p.id === productId ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
      );
      saveCustomProducts(updated);
    }
  }, [customProducts, saveCustomProducts]);

  const deleteProduct = useCallback((productId: string) => {
    const updated = customProducts.filter(p => p.id !== productId);
    saveCustomProducts(updated);
  }, [customProducts, saveCustomProducts]);

  const getProductById = useCallback((productId: string): CuratedProduct | undefined => {
    return allProducts.find(p => p.id === productId);
  }, [allProducts]);

  const getClickStats = useCallback((productId?: string, patientId?: string) => {
    let filtered = clickEvents;
    if (productId) filtered = filtered.filter(e => e.productId === productId);
    if (patientId) filtered = filtered.filter(e => e.patientId === patientId);

    const byChannel: Record<AffiliateChannel, number> = { fullscript: 0, direct: 0, amazon: 0 };
    filtered.forEach(e => {
      byChannel[e.affiliateChannel] = (byChannel[e.affiliateChannel] || 0) + 1;
    });

    return {
      totalClicks: filtered.length,
      byChannel,
      recentClicks: filtered.slice(-10).reverse(),
    };
  }, [clickEvents]);

  const isLoading = customProductsQuery.isLoading || clickEventsQuery.isLoading;

  return {
    allProducts,
    customProducts,
    isLoading,
    getRecommendations,
    trackClick,
    addProduct,
    updateProduct,
    deleteProduct,
    getProductById,
    getClickStats,
    clickEvents,
  };
});
