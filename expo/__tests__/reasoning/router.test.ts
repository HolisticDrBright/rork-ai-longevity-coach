import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mockFrom, createChainableMock, setupMockFrom, mockCtx, MOCK_USER } from '../setup';

import { reasoningRouter } from '../../backend/trpc/routes/reasoning';
import { createTRPCRouter } from '../../backend/trpc/create-context';

const OTHER_PATIENT = '11111111-1111-4111-8111-111111111111';
const PRACTITIONER_ROLE_ROW = { role: 'practitioner' };

function createTestCaller() {
  const router = createTRPCRouter({ reasoning: reasoningRouter });
  const caller = router.createCaller(mockCtx as never);
  return (caller as unknown as { reasoning: any }).reasoning;
}

function makeRelationshipRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    practitioner_id: MOCK_USER.id,
    patient_id: OTHER_PATIENT,
    status: 'active',
    consent_scope: { timeline: true },
    granted_by: OTHER_PATIENT,
    note: 'Jane D.',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ended_at: null,
    ...overrides,
  };
}

function makeHypothesisRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: OTHER_PATIENT,
    name: 'Low iron stores contributing to fatigue',
    description: null,
    status: 'proposed',
    support_score: 50,
    prior_support_score: null,
    score_change_reason: null,
    missing_evidence: [],
    systems: ['metabolic'],
    alternatives: [],
    earliest_supporting_at: null,
    source_type: 'practitioner_entered',
    review_status: 'accepted',
    created_by: MOCK_USER.id,
    reviewed_by: MOCK_USER.id,
    reviewed_at: '2026-07-01T00:00:00Z',
    archived_at: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function makeReviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    patient_id: OTHER_PATIENT,
    subject_type: 'snapshot_change',
    subject_id: 'hrv',
    priority: 'elevated',
    proposed_summary: 'HRV decrease of 22% vs baseline',
    context: {},
    status: 'pending',
    decision_note: null,
    modified_payload: null,
    created_by: OTHER_PATIENT,
    decided_by: null,
    created_at: '2026-07-10T00:00:00Z',
    decided_at: null,
    ...overrides,
  };
}

describe('reasoning router RBAC', () => {
  let caller: any;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = createTestCaller();
  });

  test('self timeline works without any role', async () => {
    setupMockFrom({
      user_roles: createChainableMock({ data: [] }),
    });
    const events = await caller.timeline.get({});
    expect(Array.isArray(events)).toBe(true);
    // Never queried roles for self-access
    expect(mockFrom).not.toHaveBeenCalledWith('practitioner_patient_relationships');
  });

  test('cross-patient timeline is FORBIDDEN without practitioner role', async () => {
    setupMockFrom({
      user_roles: createChainableMock({ data: [] }),
      practitioner_patient_relationships: createChainableMock({ data: [makeRelationshipRow()] }),
    });
    await expect(caller.timeline.get({ patientId: OTHER_PATIENT })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  test('cross-patient timeline is FORBIDDEN without an active relationship', async () => {
    setupMockFrom({
      user_roles: createChainableMock({ data: [PRACTITIONER_ROLE_ROW] }),
      practitioner_patient_relationships: createChainableMock({ data: [] }),
    });
    await expect(caller.timeline.get({ patientId: OTHER_PATIENT })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  test('cross-patient timeline succeeds with role + relationship and writes an audit event', async () => {
    const auditChain = createChainableMock({ data: [] });
    setupMockFrom({
      user_roles: createChainableMock({ data: [PRACTITIONER_ROLE_ROW] }),
      practitioner_patient_relationships: createChainableMock({ data: [makeRelationshipRow()] }),
      audit_events: auditChain,
    });
    const events = await caller.timeline.get({ patientId: OTHER_PATIENT });
    expect(Array.isArray(events)).toBe(true);
    expect(auditChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reasoning.timeline.read', patient_id: OTHER_PATIENT })
    );
  });

  test('hypotheses.create requires the practitioner role', async () => {
    setupMockFrom({
      user_roles: createChainableMock({ data: [] }),
    });
    await expect(
      caller.hypotheses.create({ patientId: OTHER_PATIENT, name: 'Test hypothesis' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('hypotheses.create stores a practitioner_entered, accepted hypothesis', async () => {
    const hypothesisChain = createChainableMock({ data: [makeHypothesisRow()] });
    setupMockFrom({
      user_roles: createChainableMock({ data: [PRACTITIONER_ROLE_ROW] }),
      practitioner_patient_relationships: createChainableMock({ data: [makeRelationshipRow()] }),
      clinical_hypotheses: hypothesisChain,
      audit_events: createChainableMock({ data: [] }),
    });
    const result = await caller.hypotheses.create({
      patientId: OTHER_PATIENT,
      name: 'Low iron stores contributing to fatigue',
    });
    expect(result.sourceType).toBe('practitioner_entered');
    expect(result.reviewStatus).toBe('accepted');
    expect(hypothesisChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: 'practitioner_entered',
        created_by: MOCK_USER.id,
        support_score: 50,
      })
    );
  });
});

describe('review queue', () => {
  let caller: any;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = createTestCaller();
  });

  test('listQueue requires practitioner role', async () => {
    setupMockFrom({
      user_roles: createChainableMock({ data: [] }),
    });
    await expect(caller.reviews.listQueue({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('listQueue returns mapped pending reviews', async () => {
    setupMockFrom({
      user_roles: createChainableMock({ data: [PRACTITIONER_ROLE_ROW] }),
      practitioner_reviews: createChainableMock({ data: [makeReviewRow()] }),
    });
    const reviews = await caller.reviews.listQueue({});
    expect(reviews).toHaveLength(1);
    expect(reviews[0].proposedSummary).toContain('HRV decrease');
    expect(reviews[0].status).toBe('pending');
  });

  test('decide records the decision and propagates to the underlying fact', async () => {
    const reviewChain = createChainableMock({
      data: [makeReviewRow({ status: 'accepted', decided_by: MOCK_USER.id, decision_note: 'Confirmed on exam' })],
    });
    const factsChain = createChainableMock({ data: [] });
    setupMockFrom({
      user_roles: createChainableMock({ data: [PRACTITIONER_ROLE_ROW] }),
      practitioner_reviews: reviewChain,
      clinical_facts: factsChain,
      audit_events: createChainableMock({ data: [] }),
    });
    const decided = await caller.reviews.decide({
      reviewId: '44444444-4444-4444-8444-444444444444',
      decision: 'accepted',
      note: 'Confirmed on exam',
    });
    expect(decided.status).toBe('accepted');
    expect(reviewChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'accepted', decided_by: MOCK_USER.id })
    );
    expect(factsChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ review_status: 'accepted', reviewed_by: MOCK_USER.id })
    );
  });
});

describe('relationships', () => {
  let caller: any;

  beforeEach(() => {
    vi.clearAllMocks();
    caller = createTestCaller();
  });

  test('grant rejects granting access to yourself', async () => {
    setupMockFrom({});
    await expect(
      caller.relationships.grant({ practitionerId: MOCK_USER.id })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  test('grant upserts an active relationship from the patient', async () => {
    const relChain = createChainableMock({ data: [makeRelationshipRow({ practitioner_id: OTHER_PATIENT, patient_id: MOCK_USER.id })] });
    setupMockFrom({
      practitioner_patient_relationships: relChain,
      audit_events: createChainableMock({ data: [] }),
    });
    const rel = await caller.relationships.grant({ practitionerId: OTHER_PATIENT, note: 'Dr. Smith' });
    expect(rel.status).toBe('active');
    expect(relChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        practitioner_id: OTHER_PATIENT,
        patient_id: MOCK_USER.id,
        status: 'active',
        granted_by: MOCK_USER.id,
      }),
      expect.objectContaining({ onConflict: 'practitioner_id,patient_id' })
    );
  });
});
