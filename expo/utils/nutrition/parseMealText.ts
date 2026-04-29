import { generateObject } from '@rork-ai/toolkit-sdk';
import { z } from 'zod';
import { DetectedFoodItem } from '@/types';

const PORTION_UNITS = ['g', 'oz', 'cup', 'tbsp', 'tsp', 'piece', 'serving', 'slice', 'medium', 'large', 'small'] as const;

const MEAL_PARSE_SCHEMA = z.object({
  items: z.array(z.object({
    name: z.string(),
    portionQty: z.number(),
    portionUnit: z.enum(PORTION_UNITS),
    confidence: z.number().min(0).max(1),
  })).min(1),
});

const SYSTEM_PROMPT = `You are a nutrition parser. Extract individual food items, portion quantities, and units from a user's free-text or transcribed-voice description of a meal.

Rules:
- Split combined items (e.g. "chicken with rice and broccoli" -> 3 items)
- Infer reasonable portion sizes when the user did not specify (e.g. "a bowl of oatmeal" -> 1 cup oatmeal)
- Use the most appropriate unit from: g, oz, cup, tbsp, tsp, piece, serving, slice, medium, large, small
- Use lowercase common food names (e.g. "grilled chicken breast", not "Chicken Breast (Grilled)")
- confidence: 0.9+ for explicit foods/quantities, 0.7-0.9 for inferred portions, <0.7 for ambiguous items
- If the input is empty or has no food, return a single best-guess "snack" item with confidence 0.3`;

export async function parseMealText(text: string): Promise<DetectedFoodItem[]> {
  console.log('[parseMealText] Parsing text:', text);

  const result = await generateObject({
    messages: [
      {
        role: 'user' as const,
        content: `${SYSTEM_PROMPT}\n\nUser meal description:\n"${text}"\n\nReturn the parsed food items.`,
      },
    ],
    schema: MEAL_PARSE_SCHEMA,
  });

  console.log('[parseMealText] Parsed', result.items.length, 'items');

  return result.items.map((item, index) => ({
    id: `parsed_${Date.now()}_${index}`,
    name: item.name,
    passioFoodId: null,
    confidence: item.confidence,
    portionQty: item.portionQty,
    portionUnit: item.portionUnit,
    suggestedPortions: [...PORTION_UNITS],
  }));
}
