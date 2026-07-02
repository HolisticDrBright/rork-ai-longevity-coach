/**
 * Webhook client — sends app events to a Supabase Edge Function.
 *
 * Events: assessment_complete, labs_analyzed, lab_upload_started,
 * coaching_interest, supplement_purchased, coaching_enrolled.
 *
 * All events are stored in the `webhook_events` table via the
 * `app-webhooks` Supabase Edge Function. No external server needed.
 *
 * Privacy notes:
 * - Email is never sent when a userId is available (the server can look it
 *   up); detailed health data (risk scores, recommended supplement lists)
 *   is reduced to non-identifying counters before transmission.
 * - The EXPO_PUBLIC_WEBHOOK_SECRET is bundled into the client and therefore
 *   public by construction — it is spam protection, not authentication.
 *   Every request also carries the user's Supabase access token in the
 *   `x-user-jwt` header so the edge function can migrate to real auth.
 */

import { supabase } from './supabase';

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

    // Attach the user's Supabase access token so the edge function can
    // migrate from the (public) webhook secret to real per-user auth.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers['x-user-jwt'] = session.access_token;
      }
    } catch {
      // No session — send without the JWT header
    }

    // Never send email when a user id is available; the server can resolve
    // the email from the id.
    const sanitized: WebhookPayload = { ...payload };
    if (sanitized.userId) {
      sanitized.email = '';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(sanitized),
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

export interface AssessmentCompletePayload {
  userId: string;
  email: string;
  assessmentScore: AssessmentScore;
  recommendedLabs: string[];
}

export function sendAssessmentComplete(data: AssessmentCompletePayload): void {
  // Detailed risk scores and recommended lab categories are health data —
  // only non-identifying counters are transmitted.
  sendWebhook('assessment-complete', {
    eventType: 'assessment_complete',
    userId: data.userId,
    email: data.email,
    recommendedLabsCount: data.recommendedLabs.length,
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
  // The recommended supplement list is health data — send only a count.
  sendWebhook('labs-analyzed', {
    eventType: 'labs_analyzed',
    userId: data.userId,
    email: data.email,
    labType: data.labType,
    supplementsRecommendedCount: data.supplementsRecommended.length,
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
