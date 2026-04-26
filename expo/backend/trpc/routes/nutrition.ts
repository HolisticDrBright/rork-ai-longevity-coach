import * as z from "zod";
import { createTRPCRouter, protectedProcedure } from "../create-context";

const PASSIO_BASE_URL = process.env.PASSIO_BASE_URL || "https://api.passiolife.com/v2";
const PASSIO_API_KEY = process.env.PASSIO_API_KEY || "";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getPassioToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  if (!PASSIO_API_KEY) {
    throw new Error("PASSIO_API_KEY not configured");
  }

  try {
    const response = await fetch(`${PASSIO_BASE_URL}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": PASSIO_API_KEY,
      },
    });

    if (!response.ok) {
      console.log("Passio token request failed, using API key directly");
      return PASSIO_API_KEY;
    }

    const data = await response.json();
    cachedToken = {
      token: data.access_token || PASSIO_API_KEY,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000 - 60000,
    };
    return cachedToken.token;
  } catch (error) {
    console.log("Using API key directly for Passio requests");
    return PASSIO_API_KEY;
  }
}

const foodRules: Record<string, { forbidden: string[]; caution: string[] }> = {
  AIP: {
    forbidden: ["gluten", "dairy", "eggs", "nightshade", "alcohol", "seed_oil", "legumes", "grains", "nuts", "seeds"],
    caution: ["coffee", "chocolate"],
  },
  LOW_FODMAP: {
    forbidden: ["high_fodmap", "garlic", "onion", "wheat", "apple", "beans", "lactose", "honey", "watermelon"],
    caution: ["moderate_fodmap"],
  },
  KETO: {
    forbidden: ["high_carb", "sugar", "grains", "starchy_vegetables"],
    caution: ["moderate_carb", "fruit"],
  },
  LOW_HISTAMINE: {
    forbidden: ["high_histamine", "histamine_liberator", "fermented", "aged_cheese", "alcohol", "vinegar", "cured_meat"],
    caution: ["citrus", "tomato", "spinach"],
  },
};

const foodTagMappings: Record<string, string[]> = {
  bread: ["gluten", "grains", "high_carb", "wheat"],
  pasta: ["gluten", "grains", "high_carb", "wheat"],
  rice: ["grains", "high_carb"],
  milk: ["dairy", "lactose"],
  cheese: ["dairy", "lactose", "high_histamine", "aged_cheese"],
  yogurt: ["dairy", "lactose", "fermented"],
  egg: ["eggs"],
  tomato: ["nightshade", "histamine_liberator", "high_fodmap"],
  potato: ["nightshade", "starchy_vegetables", "high_carb"],
  pepper: ["nightshade"],
  eggplant: ["nightshade"],
  soy: ["legumes"],
  beans: ["legumes", "high_fodmap", "beans"],
  lentils: ["legumes", "high_fodmap"],
  peanut: ["legumes", "nuts"],
  wine: ["alcohol", "high_histamine"],
  beer: ["alcohol", "gluten", "high_histamine"],
  sausage: ["cured_meat", "high_histamine"],
  bacon: ["cured_meat", "high_histamine"],
  ham: ["cured_meat", "high_histamine"],
  salami: ["cured_meat", "high_histamine", "aged_cheese"],
  vinegar: ["vinegar", "high_histamine"],
  sauerkraut: ["fermented", "high_histamine"],
  kimchi: ["fermented", "high_histamine"],
  sugar: ["sugar", "high_carb"],
  candy: ["sugar", "high_carb"],
  cake: ["sugar", "high_carb", "gluten", "dairy", "eggs"],
  cookie: ["sugar", "high_carb", "gluten", "dairy"],
  garlic: ["garlic", "high_fodmap"],
  onion: ["onion", "high_fodmap"],
  apple: ["apple", "high_fodmap", "fruit"],
  watermelon: ["watermelon", "high_fodmap", "fruit"],
  honey: ["honey", "high_fodmap", "sugar"],
  avocado: ["high_histamine"],
  spinach: ["spinach", "histamine_liberator"],
  strawberry: ["high_histamine", "fruit"],
  citrus: ["citrus", "histamine_liberator"],
  orange: ["citrus", "histamine_liberator", "fruit"],
  lemon: ["citrus", "histamine_liberator"],
  chocolate: ["chocolate", "histamine_liberator"],
  fish: ["high_histamine"],
  shellfish: ["high_histamine"],
  vegetable_oil: ["seed_oil"],
  canola_oil: ["seed_oil"],
  sunflower_oil: ["seed_oil"],
  corn_oil: ["seed_oil"],
  almond: ["nuts"],
  walnut: ["nuts"],
  cashew: ["nuts"],
  coffee: ["coffee"],
};

function generateFoodTags(foodName: string): string[] {
  const tags: string[] = [];
  const lowerName = foodName.toLowerCase();

  for (const [keyword, keywordTags] of Object.entries(foodTagMappings)) {
    if (lowerName.includes(keyword)) {
      tags.push(...keywordTags);
    }
  }

  return [...new Set(tags)];
}

function calculateComplianceScore(
  items: Array<{ tags: string[] }>,
  activeDiets: string[],
  totals: { carbs_g: number; fiber_g: number }
): Record<string, { score: number; violations: string[]; cautions: string[] }> {
  const compliance: Record<string, { score: number; violations: string[]; cautions: string[] }> = {};

  for (const diet of activeDiets) {
    const rules = foodRules[diet];
    if (!rules) continue;

    let score = 100;
    const violations: string[] = [];
    const cautions: string[] = [];

    for (const item of items) {
      for (const tag of item.tags) {
        if (rules.forbidden.includes(tag)) {
          if (!violations.includes(tag)) {
            violations.push(tag);
            score = Math.min(score, 50);
            score -= 10;
          }
        }
        if (rules.caution.includes(tag)) {
          if (!cautions.includes(tag)) {
            cautions.push(tag);
            score -= 5;
          }
        }
      }
    }

    if (diet === "KETO") {
      const netCarbs = totals.carbs_g - totals.fiber_g;
      if (netCarbs > 40) {
        violations.push(`high_net_carbs_${Math.round(netCarbs)}g`);
        score = Math.min(score, 50);
        score -= Math.floor((netCarbs - 40) / 5) * 5;
      } else if (netCarbs > 20) {
        cautions.push(`moderate_net_carbs_${Math.round(netCarbs)}g`);
        score -= 10;
      }
    }

    compliance[diet] = {
      score: Math.max(0, score),
      violations,
      cautions,
    };
  }

  return compliance;
}

const swapSuggestions: Record<string, string> = {
  gluten: "Try gluten-free alternatives like rice, quinoa, or almond flour",
  dairy: "Use coconut milk, almond milk, or cashew cheese",
  eggs: "Try flax eggs or chia eggs for baking",
  nightshade: "Replace with carrots, beets, or sweet potatoes",
  high_fodmap: "Choose low-FODMAP alternatives like zucchini, carrots, or spinach",
  garlic: "Use garlic-infused oil (strain out garlic) or chives",
  onion: "Try the green part of scallions or chives",
  high_carb: "Swap for cauliflower rice, zucchini noodles, or leafy greens",
  grains: "Use cauliflower rice or vegetable-based alternatives",
  sugar: "Try stevia, monk fruit, or small amounts of maple syrup",
  high_histamine: "Choose fresh meats, fresh vegetables, and avoid aged/fermented foods",
  fermented: "Opt for fresh, unfermented versions",
  legumes: "Replace with vegetables or moderate amounts of nuts (if tolerated)",
};

export const nutritionRouter = createTRPCRouter({
  analyzePhoto: protectedProcedure
    .input(z.object({
      photoBase64: z.string(),
      mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]),
      userId: z.string(),
    }))
    .mutation(async ({ input }) => {
      console.log("Analyzing photo for meal:", input.mealType);

      const foodLogId = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      try {
        const token = await getPassioToken();

        const response = await fetch(`${PASSIO_BASE_URL}/products/visualsearch`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            image: input.photoBase64,
          }),
        });

        if (response.ok) {
          const passioData = await response.json();
          console.log("Passio response:", JSON.stringify(passioData).substring(0, 500));

          const detectedItems = (passioData.results || passioData.foods || []).map((item: any, index: number) => ({
            id: `item_${index}`,
            name: item.name || item.food_name || `Food ${index + 1}`,
            passioFoodId: item.passio_id || item.id || null,
            confidence: item.confidence || item.score || 0.8,
            portionQty: 1,
            portionUnit: "serving",
            suggestedPortions: ["g", "oz", "cup", "tbsp", "piece", "serving"],
          }));

          return {
            foodLogId,
            detectedItems: detectedItems.length > 0 ? detectedItems : getMockDetectedItems(),
            passioRawJson: passioData,
            clarifyingQuestions: generateClarifyingQuestions(detectedItems),
          };
        }
      } catch (error) {
        console.log("Passio API error, using mock data:", error);
      }

      return {
        foodLogId,
        detectedItems: getMockDetectedItems(),
        passioRawJson: { mock: true },
        clarifyingQuestions: [
          { id: "sauce", question: "Any sauces or dressings?", options: ["None", "Light", "Regular"] },
          { id: "oil", question: "Was it cooked with oil?", options: ["No", "Olive oil", "Butter", "Other oil"] },
        ],
      };
    }),

  calculateNutrition: protectedProcedure
    .input(z.object({
      foodLogId: z.string(),
      confirmedItems: z.array(z.object({
        id: z.string(),
        name: z.string(),
        passioFoodId: z.string().nullable(),
        portionQty: z.number(),
        portionUnit: z.string(),
      })),
      activeDiets: z.array(z.string()),
      userId: z.string(),
    }))
    .mutation(async ({ input }) => {
      console.log("Calculating nutrition for", input.confirmedItems.length, "items");

      const items: Array<{
        id: string;
        name: string;
        passioFoodId: string | null;
        portionQty: number;
        portionUnit: string;
        calories: number;
        protein_g: number;
        carbs_g: number;
        fat_g: number;
        fiber_g: number;
        sugar_g: number;
        sodium_mg: number;
        tags: string[];
      }> = [];

      for (const item of input.confirmedItems) {
        let nutrition = getNutritionEstimate(item.name, item.portionQty, item.portionUnit);

        if (item.passioFoodId && PASSIO_API_KEY) {
          try {
            const token = await getPassioToken();
            const response = await fetch(`${PASSIO_BASE_URL}/products/${item.passioFoodId}`, {
              headers: {
                "Authorization": `Bearer ${token}`,
              },
            });

            if (response.ok) {
              const data = await response.json();
              if (data.nutrients) {
                const multiplier = getPortionMultiplier(item.portionQty, item.portionUnit, data.serving_size);
                nutrition = {
                  calories: (data.nutrients.calories || 0) * multiplier,
                  protein_g: (data.nutrients.protein || 0) * multiplier,
                  carbs_g: (data.nutrients.carbohydrates || 0) * multiplier,
                  fat_g: (data.nutrients.fat || 0) * multiplier,
                  fiber_g: (data.nutrients.fiber || 0) * multiplier,
                  sugar_g: (data.nutrients.sugars || 0) * multiplier,
                  sodium_mg: (data.nutrients.sodium || 0) * multiplier,
                };
              }
            }
          } catch (error) {
            console.log("Failed to fetch Passio nutrition, using estimate");
          }
        }

        const tags = generateFoodTags(item.name);

        items.push({
          ...item,
          ...nutrition,
          tags,
        });
      }

      const totals = {
        calories: items.reduce((sum, i) => sum + i.calories, 0),
        protein_g: items.reduce((sum, i) => sum + i.protein_g, 0),
        carbs_g: items.reduce((sum, i) => sum + i.carbs_g, 0),
        fat_g: items.reduce((sum, i) => sum + i.fat_g, 0),
        fiber_g: items.reduce((sum, i) => sum + i.fiber_g, 0),
        sugar_g: items.reduce((sum, i) => sum + i.sugar_g, 0),
        sodium_mg: items.reduce((sum, i) => sum + i.sodium_mg, 0),
      };

      const compliance = calculateComplianceScore(items, input.activeDiets, totals);

      const suggestions: string[] = [];
      for (const [diet, result] of Object.entries(compliance)) {
        for (const violation of result.violations) {
          const baseTag = violation.split("_")[0];
          if (swapSuggestions[baseTag]) {
            suggestions.push(`${diet}: ${swapSuggestions[baseTag]}`);
          } else if (swapSuggestions[violation]) {
            suggestions.push(`${diet}: ${swapSuggestions[violation]}`);
          }
        }
      }

      return {
        foodLogId: input.foodLogId,
        items,
        totals,
        compliance,
        suggestions: [...new Set(suggestions)],
        calculatedAt: new Date().toISOString(),
      };
    }),

  searchFoods: protectedProcedure
    .input(z.object({
      query: z.string(),
    }))
    .query(async ({ input }) => {
      if (!input.query || input.query.length < 2) {
        return { results: [] };
      }

      try {
        const token = await getPassioToken();
        const response = await fetch(`${PASSIO_BASE_URL}/products/search?query=${encodeURIComponent(input.query)}`, {
          headers: {
            "Authorization": `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          return {
            results: (data.results || data.foods || []).slice(0, 10).map((item: any) => ({
              id: item.passio_id || item.id || `search_${Math.random()}`,
              name: item.name || item.food_name,
              brand: item.brand_name,
            })),
          };
        }
      } catch (error) {
        console.log("Search failed, using fallback");
      }

      const commonFoods = [
        "Chicken breast", "Salmon", "Rice", "Broccoli", "Eggs", "Avocado",
        "Sweet potato", "Spinach", "Almonds", "Greek yogurt", "Banana", "Apple",
      ];
      return {
        results: commonFoods
          .filter(f => f.toLowerCase().includes(input.query.toLowerCase()))
          .map((name, i) => ({ id: `common_${i}`, name, brand: null })),
      };
    }),

  lookupBarcode: protectedProcedure
    .input(z.object({
      barcode: z.string(),
    }))
    .query(async ({ input }) => {
      try {
        const token = await getPassioToken();
        const response = await fetch(`${PASSIO_BASE_URL}/products/barcode/${input.barcode}`, {
          headers: {
            "Authorization": `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          return {
            found: true,
            food: {
              id: data.passio_id || data.id,
              name: data.name || data.food_name,
              brand: data.brand_name,
              nutrients: data.nutrients,
            },
          };
        }
      } catch (error) {
        console.log("Barcode lookup failed");
      }

      return { found: false, food: null };
    }),
});

function getMockDetectedItems() {
  return [
    {
      id: "item_0",
      name: "Grilled Chicken",
      passioFoodId: null,
      confidence: 0.92,
      portionQty: 1,
      portionUnit: "serving",
      suggestedPortions: ["g", "oz", "piece", "serving"],
    },
    {
      id: "item_1",
      name: "Mixed Vegetables",
      passioFoodId: null,
      confidence: 0.85,
      portionQty: 1,
      portionUnit: "cup",
      suggestedPortions: ["g", "oz", "cup", "serving"],
    },
    {
      id: "item_2",
      name: "Brown Rice",
      passioFoodId: null,
      confidence: 0.78,
      portionQty: 0.5,
      portionUnit: "cup",
      suggestedPortions: ["g", "oz", "cup", "serving"],
    },
  ];
}

function generateClarifyingQuestions(items: any[]): Array<{ id: string; question: string; options: string[] }> {
  const questions: Array<{ id: string; question: string; options: string[] }> = [];

  const lowConfidence = items.some(i => i.confidence < 0.7);
  if (lowConfidence) {
    questions.push({
      id: "confirm",
      question: "We're not 100% sure about some items. Please review and correct if needed.",
      options: [],
    });
  }

  const hasProtein = items.some(i =>
    i.name.toLowerCase().includes("chicken") ||
    i.name.toLowerCase().includes("meat") ||
    i.name.toLowerCase().includes("fish")
  );
  if (hasProtein) {
    questions.push({
      id: "cooking_oil",
      question: "What was the protein cooked with?",
      options: ["No oil", "Olive oil", "Butter", "Avocado oil", "Other"],
    });
  }

  questions.push({
    id: "sauce",
    question: "Any sauces or dressings?",
    options: ["None", "Light amount", "Regular amount"],
  });

  return questions;
}

function getNutritionEstimate(name: string, qty: number, unit: string): {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sugar_g: number;
  sodium_mg: number;
} {
  const estimates: Record<string, { cal: number; p: number; c: number; f: number; fib: number; s: number; na: number }> = {
    chicken: { cal: 165, p: 31, c: 0, f: 3.6, fib: 0, s: 0, na: 74 },
    salmon: { cal: 208, p: 20, c: 0, f: 13, fib: 0, s: 0, na: 59 },
    rice: { cal: 206, p: 4.3, c: 45, f: 0.4, fib: 0.6, s: 0, na: 1 },
    broccoli: { cal: 55, p: 3.7, c: 11, f: 0.6, fib: 5.1, s: 2.2, na: 33 },
    egg: { cal: 78, p: 6, c: 0.6, f: 5, fib: 0, s: 0.6, na: 62 },
    avocado: { cal: 240, p: 3, c: 12, f: 22, fib: 10, s: 1, na: 10 },
    vegetables: { cal: 50, p: 2, c: 10, f: 0.5, fib: 3, s: 4, na: 30 },
    potato: { cal: 161, p: 4.3, c: 37, f: 0.2, fib: 3.8, s: 1.7, na: 17 },
    bread: { cal: 79, p: 2.7, c: 15, f: 1, fib: 0.6, s: 1.5, na: 147 },
    pasta: { cal: 220, p: 8, c: 43, f: 1.3, fib: 2.5, s: 0.6, na: 1 },
    beef: { cal: 250, p: 26, c: 0, f: 15, fib: 0, s: 0, na: 72 },
    pork: { cal: 242, p: 27, c: 0, f: 14, fib: 0, s: 0, na: 62 },
    default: { cal: 150, p: 5, c: 20, f: 5, fib: 2, s: 3, na: 100 },
  };

  const lowerName = name.toLowerCase();
  let match = estimates.default;

  for (const [key, value] of Object.entries(estimates)) {
    if (lowerName.includes(key)) {
      match = value;
      break;
    }
  }

  const portionMultipliers: Record<string, number> = {
    g: 0.01,
    oz: 0.28,
    cup: 1,
    tbsp: 0.0625,
    piece: 1,
    serving: 1,
  };

  const multiplier = (portionMultipliers[unit] || 1) * qty;

  return {
    calories: Math.round(match.cal * multiplier),
    protein_g: Math.round(match.p * multiplier * 10) / 10,
    carbs_g: Math.round(match.c * multiplier * 10) / 10,
    fat_g: Math.round(match.f * multiplier * 10) / 10,
    fiber_g: Math.round(match.fib * multiplier * 10) / 10,
    sugar_g: Math.round(match.s * multiplier * 10) / 10,
    sodium_mg: Math.round(match.na * multiplier),
  };
}

function getPortionMultiplier(qty: number, unit: string, servingSize?: { amount: number; unit: string }): number {
  if (!servingSize) return qty;

  const gramsPerUnit: Record<string, number> = {
    g: 1,
    oz: 28.35,
    cup: 240,
    tbsp: 15,
    piece: 100,
    serving: 100,
  };

  const requestedGrams = qty * (gramsPerUnit[unit] || 100);
  const servingGrams = servingSize.amount * (gramsPerUnit[servingSize.unit] || 100);

  return requestedGrams / servingGrams;
}
