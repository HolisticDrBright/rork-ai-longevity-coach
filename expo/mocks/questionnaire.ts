import { QuestionnaireCategory } from '@/types';
import { QUESTIONNAIRE } from '@/registry';

/**
 * COMPATIBILITY SHIM — the questionnaire content now lives in the shared,
 * versioned clinical content registry (`expo/registry/registry-content.v1.json`,
 * question IDs and wording preserved verbatim; see registry.test.ts).
 * Existing imports keep working; new code should import from '@/registry'.
 */
export const questionnaireCategories: QuestionnaireCategory[] =
  QUESTIONNAIRE.categories.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    description: c.description,
    questions: c.questions.map((q) => ({ id: q.id, text: q.text, categoryId: c.id })),
  }));

export const healthGoals = [
  'Increase energy levels',
  'Improve sleep quality',
  'Optimize body composition',
  'Enhance cognitive function',
  'Reduce inflammation',
  'Balance hormones',
  'Improve gut health',
  'Increase longevity',
  'Build muscle',
  'Reduce stress',
  'Improve metabolic health',
  'Enhance athletic performance',
  'Detoxification support',
  'Immune system optimization',
];

export const exerciseTypes = [
  'Strength training',
  'Cardio',
  'HIIT',
  'Yoga',
  'Pilates',
  'Swimming',
  'Cycling',
  'Running',
  'Walking',
  'Sports',
  'CrossFit',
  'Martial arts',
];
