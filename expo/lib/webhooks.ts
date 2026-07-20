/**
 * Webhook client — sends app events to a Supabase Edge Function.
 *
 * Events: assessment_complete, labs_analyzed, lab_upload_started,
 * coaching_interest, supplement_purchased, coaching_enrolled.
 *
 * All events are stored in the `webhook_events` table via the
 * `app-webhooks` Supabase Edge Function. No external server needed.
 */

const getWebhookUrl = (): string => {
  // Auto-detect from Supabase URL — no separate config needed
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  if (supabaseUrl) {
    return `${supabaseUrl}/functions/v1/app-webhooks`;
  }
  // Fallback to explicit webhook URL if set
  return process.env.EXPO_PUBLIC_WEBHOOK_URL || '';
};

const getWebhookSecret = (): string => {
  return process.env.EXPO_PUBLIC_WEBHOOK_SECRET || '';
};

interface WebhookPayload {
  eventType: string;
  userId: string;
  email: string;
  timestamp: string;
  [key: string]: unknown;
}

async function sendWebhook(endpoint: string, payload: WebhookPayload): Promise<boolean> {
  const url = getWebhookUrl();
  if (!url) return false;

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const secret = getWebhookSecret();
    if (secret) {
      headers['X-Webhook-Secret'] = secret;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return true;
    }
    return false;
  } catch {
    // Network error — fail silently, don't block the user
    return false;
  }
}

export interface AssessmentScore {
  moldRisk: number;
  heavyMetalsRisk: number;
  parasitesRisk: number;
  lymeRisk: number;
  ebvRisk: number;
  gutIssuesRisk: number;
  thyroidRisk: number;
  hormoneRisk: number;
  adrenalRisk: number;
}

export interface AssessmentCategoryScoreV2 {
  categoryId: string;
  /** Symptom-pattern screening score (0-100 of ANSWERED max), null when insufficient data. */
  score: number | null;
  band: 'insufficient_data' | 'below-threshold' | 'moderate' | 'elevated';
  completeness: number;
}

/**
 * assessment_complete payload v2 — the corrected contract. Elevated CATEGORY
 * ids and recommended LAB ids are separate, correctly-named fields (v1 sent
 * category ids under `recommendedLabs`); questionnaire/scoring/rule versions
 * and the review state travel with every event. `legacyV1` carries the exact
 * old shape for existing consumers during migration.
 */
export interface AssessmentCompletePayload {
  userId: string;
  email: string;
  payloadVersion: 2;
  questionnaireVersion: string;
  scoringVersion: string;
  ruleVersion: string;
  registryVersion: string;
  contentHash: string;
  categoryScores: AssessmentCategoryScoreV2[];
  elevatedCategoryIds: string[];
  moderateOrHigherCategoryIds: string[];
  /** Registry LAB ids (e.g. lab_dutch_complete) — never category ids. */
  recommendedLabIds: string[];
  reviewState: 'pending_practitioner_review';
  legacyV1: {
    assessmentScore: AssessmentScore;
    /** v1 bug preserved verbatim for old consumers: these are CATEGORY ids. */
    recommendedLabs: string[];
  };
}

export function sendAssessmentComplete(data: AssessmentCompletePayload): void {
  sendWebhook('assessment-complete', {
    eventType: 'assessment_complete',
    userId: data.userId,
    email: data.email,
    payloadVersion: data.payloadVersion,
    questionnaireVersion: data.questionnaireVersion,
    scoringVersion: data.scoringVersion,
    ruleVersion: data.ruleVersion,
    registryVersion: data.registryVersion,
    contentHash: data.contentHash,
    categoryScores: data.categoryScores,
    elevatedCategoryIds: data.elevatedCategoryIds,
    moderateOrHigherCategoryIds: data.moderateOrHigherCategoryIds,
    recommendedLabIds: data.recommendedLabIds,
    reviewState: data.reviewState,
    // Legacy v1 fields, verbatim, for consumers not yet on payloadVersion 2.
    assessmentScore: data.legacyV1.assessmentScore,
    recommendedLabs: data.legacyV1.recommendedLabs,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
}

export interface SupplementRecommended {
  name: string;
  affiliateLink: string;
  reason: string;
}

export interface LabsAnalyzedPayload {
  userId: string;
  email: string;
  labType: string;
  supplementsRecommended: SupplementRecommended[];
}

export function sendLabsAnalyzed(data: LabsAnalyzedPayload): void {
  sendWebhook('labs-analyzed', {
    eventType: 'labs_analyzed',
    userId: data.userId,
    email: data.email,
    labType: data.labType,
    supplementsRecommended: data.supplementsRecommended,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
}

export interface LabUploadStartedPayload {
  userId: string;
  email: string;
}

export function sendLabUploadStarted(data: LabUploadStartedPayload): void {
  sendWebhook('lab-upload-started', {
    eventType: 'lab_upload_started',
    userId: data.userId,
    email: data.email,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
}

export type CoachingInterest = 'peptide_program' | 'longevity_program' | 'practitioner_portal';

export interface CoachingInterestPayload {
  userId: string;
  email: string;
  interestedIn: CoachingInterest;
}

export function sendCoachingInterest(data: CoachingInterestPayload): void {
  sendWebhook('coaching-interest', {
    eventType: 'coaching_interest',
    userId: data.userId,
    email: data.email,
    interestedIn: data.interestedIn,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
}

export interface SupplementPurchasedPayload {
  userId: string;
  email: string;
  affiliateCode: string;
  productName: string;
  affiliateLink: string;
  purchaseAmount: number;
  commissionRate: number;
}

export function sendSupplementPurchased(data: SupplementPurchasedPayload): void {
  sendWebhook('supplement-purchased', {
    eventType: 'supplement_purchased',
    userId: data.userId,
    email: data.email,
    affiliateCode: data.affiliateCode,
    productName: data.productName,
    affiliateLink: data.affiliateLink,
    purchaseAmount: data.purchaseAmount,
    commissionRate: data.commissionRate,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
}

export type CoachingProgramTier = 'peptide_program' | 'longevity_program' | 'practitioner_portal';

export interface CoachingEnrolledPayload {
  userId: string;
  email: string;
  programTier: CoachingProgramTier;
  programCost: number;
  enrollmentDate: string;
}

export function sendCoachingEnrolled(data: CoachingEnrolledPayload): void {
  sendWebhook('coaching-enrolled', {
    eventType: 'coaching_enrolled',
    userId: data.userId,
    email: data.email,
    programTier: data.programTier,
    programCost: data.programCost,
    enrollmentDate: data.enrollmentDate,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
}

export async function testWebhookConnection(): Promise<boolean> {
  const url = getWebhookUrl();
  if (!url) return false;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const secret = getWebhookSecret();
    if (secret) headers['X-Webhook-Secret'] = secret;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eventType: 'test', userId: 'test', email: 'test', timestamp: new Date().toISOString(), test: true }),
    });

    if (response.ok) {
      const result = await response.json();
      return result.success === true;
    }
    return false;
  } catch {
    return false;
  }
}
