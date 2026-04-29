const WEBHOOK_BASE_URL = process.env.EXPO_PUBLIC_WEBHOOK_URL || '';

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
  const secret = getWebhookSecret();
  if (!secret || !WEBHOOK_BASE_URL) {
    // No webhook configured — skip silently
    return false;
  }

  const url = `${WEBHOOK_BASE_URL}/${endpoint}`;
  console.log('[Webhooks] Sending webhook, event:', payload.eventType);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': secret,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      console.log('[Webhooks] Success:', endpoint);
      return true;
    }

    console.log('[Webhooks] Failed:', endpoint, 'status:', response.status);
    return false;
  } catch (error) {
    console.log('[Webhooks] Error sending webhook:', endpoint, error instanceof Error ? error.message : String(error));
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

export interface AssessmentCompletePayload {
  userId: string;
  email: string;
  assessmentScore: AssessmentScore;
  recommendedLabs: string[];
}

export function sendAssessmentComplete(data: AssessmentCompletePayload): void {
  const payload: WebhookPayload = {
    eventType: 'assessment_complete',
    userId: data.userId,
    email: data.email,
    assessmentScore: data.assessmentScore,
    recommendedLabs: data.recommendedLabs,
    timestamp: new Date().toISOString(),
  };

  sendWebhook('assessment-complete', payload).catch(() => {});
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
  const payload: WebhookPayload = {
    eventType: 'labs_analyzed',
    userId: data.userId,
    email: data.email,
    labType: data.labType,
    supplementsRecommended: data.supplementsRecommended,
    timestamp: new Date().toISOString(),
  };

  sendWebhook('labs-analyzed', payload).catch(() => {});
}

export interface LabUploadStartedPayload {
  userId: string;
  email: string;
}

export function sendLabUploadStarted(data: LabUploadStartedPayload): void {
  const payload: WebhookPayload = {
    eventType: 'lab_upload_started',
    userId: data.userId,
    email: data.email,
    timestamp: new Date().toISOString(),
  };

  sendWebhook('lab-upload-started', payload).catch(() => {});
}

export type CoachingInterest = 'peptide_program' | 'longevity_program' | 'practitioner_portal';

export interface CoachingInterestPayload {
  userId: string;
  email: string;
  interestedIn: CoachingInterest;
}

export function sendCoachingInterest(data: CoachingInterestPayload): void {
  const payload: WebhookPayload = {
    eventType: 'coaching_interest',
    userId: data.userId,
    email: data.email,
    interestedIn: data.interestedIn,
    timestamp: new Date().toISOString(),
  };

  sendWebhook('coaching-interest', payload).catch(() => {});
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
  const payload: WebhookPayload = {
    eventType: 'supplement_purchased',
    userId: data.userId,
    email: data.email,
    affiliateCode: data.affiliateCode,
    productName: data.productName,
    affiliateLink: data.affiliateLink,
    purchaseAmount: data.purchaseAmount,
    commissionRate: data.commissionRate,
    timestamp: new Date().toISOString(),
  };

  sendWebhook('supplement-purchased', payload).catch(() => {});
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
  const payload: WebhookPayload = {
    eventType: 'coaching_enrolled',
    userId: data.userId,
    email: data.email,
    programTier: data.programTier,
    programCost: data.programCost,
    enrollmentDate: data.enrollmentDate,
    timestamp: new Date().toISOString(),
  };

  sendWebhook('coaching-enrolled', payload).catch(() => {});
}

export async function testWebhookConnection(): Promise<boolean> {
  const secret = getWebhookSecret();
  if (!secret) {
    console.log('[Webhooks] No webhook secret configured');
    return false;
  }

  try {
    const response = await fetch(`${WEBHOOK_BASE_URL}/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': secret,
      },
      body: JSON.stringify({ test: true }),
    });

    if (response.ok) {
      const result = await response.json();
      console.log('[Webhooks] Test successful');
      return result.success === true;
    }

    console.log('[Webhooks] Test failed, status:', response.status);
    return false;
  } catch (error) {
    console.log('[Webhooks] Test error:', error instanceof Error ? error.message : String(error));
    return false;
  }
}
