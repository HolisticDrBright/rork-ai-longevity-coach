/**
 * Glue between the app's locally persisted QuestionnaireResponse rows and the
 * registry's scoring input. Special answers (not applicable / unsure / prefer
 * not to answer) pass through as themselves so scoring.v2 can exclude them
 * from both numerator and denominator — they are never coerced to zero.
 */
import type { SubmittedAnswer } from '@/registry';
import type { QuestionnaireResponse } from '@/types';

export function toSubmittedAnswers(responses: QuestionnaireResponse[]): SubmittedAnswer[] {
  return responses.map((r) => ({
    questionId: r.questionId,
    value: r.special ?? (r.severity as 0 | 1 | 2 | 3 | 4),
  }));
}
