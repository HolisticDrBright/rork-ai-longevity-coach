import { describe, test, expect, vi, beforeEach } from 'vitest';
import { mockFrom, createChainableMock, setupMockFrom } from '../setup';

// Deterministic-only pipeline: server AI is not configured in these tests.
vi.mock('../../backend/services/ai/aiClient', () => ({
  getServerAiConfig: vi.fn(() => null),
  generateStructured: vi.fn(),
  generateNarrative: vi.fn(),
  uploadProviderFile: vi.fn(),
  deleteProviderFile: vi.fn(),
}));

import { runReasoningPipeline, REASONING_PIPELINE_VERSION } from '../../backend/services/reasoning/pipelineRunner';

const USER = '99999999-9999-4999-8999-999999999999';

function makeHypothesisRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: USER,
    code: null,
    name: 'Low iron stores pattern',
    description: 'desc',
    status: 'proposed',
    support_score: 50,
    prior_support_score: null,
    score_change_reason: null,
    missing_evidence: [],
    systems: ['mitochondrial_energy'],
    alternatives: [],
    earliest_supporting_at: null,
    source_type: 'rule_engine',
    review_status: 'pending_review',
    created_by: USER,
    reviewed_by: null,
    reviewed_at: null,
    archived_at: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

function makeSnapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    user_id: USER,
    snapshot_number: 1,
    trigger: 'manual',
    pipeline_version: REASONING_PIPELINE_VERSION,
    inputs_summary: {},
    hypotheses_state: [],
    detected_changes: [],
    data_quality_issues: [],
    missing_data: [],
    diff_from_previous: {},
    systems_state: [],
    previous_snapshot_id: null,
    created_by: USER,
    created_at: '2026-07-15T00:00:00Z',
    ...overrides,
  };
}

describe('runReasoningPipeline (deterministic)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('low ferritin + fatigue creates a rule hypothesis with evidence and review', async () => {
    const hypothesesChain = createChainableMock({ data: [makeHypothesisRow()] });
    const evidenceChain = createChainableMock({ data: [] });
    const reviewsChain = createChainableMock({ data: [] });
    const snapshotChain = createChainableMock({ data: [makeSnapshotRow()] });
    const aiOpsChain = createChainableMock({ data: [] });

    setupMockFrom({
      daily_biometric_records: createChainableMock({ data: [] }),
      daily_baselines: createChainableMock({ data: [] }),
      lab_markers: createChainableMock({
        data: [
          {
            marker_name: 'Ferritin',
            marker_value: 12,
            unit: 'ng/mL',
            reference_range_low: 30,
            reference_range_high: 400,
            collected_at: '2026-06-01T00:00:00Z',
          },
        ],
      }),
      symptom_logs: createChainableMock({
        data: [{ symptom_name: 'Fatigue', severity: 7, logged_at: '2026-07-10T00:00:00Z' }],
      }),
      clinical_hypotheses: hypothesesChain,
      evidence_items: evidenceChain,
      practitioner_reviews: reviewsChain,
      clinical_facts: createChainableMock({ data: [] }),
      reasoning_snapshots: snapshotChain,
      ai_operations: aiOpsChain,
      audit_events: createChainableMock({ data: [] }),
    });

    const sb = { from: mockFrom } as never;
    const result = await runReasoningPipeline(sb, { id: USER }, USER, 'manual');

    // Rule candidate persisted with provenance + review pending
    expect(hypothesesChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'rule:iron_insufficiency',
        source_type: 'rule_engine',
        review_status: 'pending_review',
        created_by: USER,
      })
    );
    // Supporting evidence + review-queue entry created
    expect(evidenceChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'supports', source_type: 'rule_engine' })
    );
    expect(reviewsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ subject_type: 'hypothesis', patient_id: USER })
    );
    // Immutable snapshot with twin systems state
    expect(snapshotChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        pipeline_version: REASONING_PIPELINE_VERSION,
        systems_state: expect.arrayContaining([
          expect.objectContaining({ key: 'metabolic' }),
        ]),
      })
    );
    const snapshotInsert = (snapshotChain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      systems_state: unknown[];
    };
    expect(snapshotInsert.systems_state).toHaveLength(12);
    // No AI configured → deterministic run, still logged to ai_operations
    expect(result.aiUsed).toBe(false);
    expect(aiOpsChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'reasoning.pipeline', model: 'deterministic' })
    );
    expect(result.snapshot.snapshotNumber).toBe(1);
  });

  test('existing hypothesis codes are not re-proposed', async () => {
    const hypothesesChain = createChainableMock({
      data: [makeHypothesisRow({ code: 'rule:iron_insufficiency' })],
    });
    setupMockFrom({
      daily_biometric_records: createChainableMock({ data: [] }),
      daily_baselines: createChainableMock({ data: [] }),
      lab_markers: createChainableMock({
        data: [
          {
            marker_name: 'Ferritin',
            marker_value: 12,
            unit: 'ng/mL',
            reference_range_low: 30,
            reference_range_high: 400,
            collected_at: '2026-06-01T00:00:00Z',
          },
        ],
      }),
      symptom_logs: createChainableMock({ data: [] }),
      clinical_hypotheses: hypothesesChain,
      evidence_items: createChainableMock({ data: [] }),
      practitioner_reviews: createChainableMock({ data: [] }),
      clinical_facts: createChainableMock({ data: [] }),
      reasoning_snapshots: createChainableMock({ data: [makeSnapshotRow()] }),
      ai_operations: createChainableMock({ data: [] }),
      audit_events: createChainableMock({ data: [] }),
    });

    const sb = { from: mockFrom } as never;
    const result = await runReasoningPipeline(sb, { id: USER }, USER, 'new_lab');

    expect(hypothesesChain.insert).not.toHaveBeenCalled();
    expect(result.hypothesesCreated).toHaveLength(0);
  });

  test('contradicting data records contradicting evidence for active coded hypotheses', async () => {
    const evidenceChain = createChainableMock({ data: [] });
    setupMockFrom({
      daily_biometric_records: createChainableMock({ data: [] }),
      daily_baselines: createChainableMock({ data: [] }),
      lab_markers: createChainableMock({
        data: [
          {
            marker_name: 'Ferritin',
            marker_value: 90,
            unit: 'ng/mL',
            reference_range_low: 30,
            reference_range_high: 400,
            collected_at: '2026-07-01T00:00:00Z',
          },
        ],
      }),
      symptom_logs: createChainableMock({ data: [] }),
      clinical_hypotheses: createChainableMock({
        data: [makeHypothesisRow({ code: 'rule:iron_insufficiency' })],
      }),
      evidence_items: evidenceChain,
      practitioner_reviews: createChainableMock({ data: [] }),
      clinical_facts: createChainableMock({ data: [] }),
      reasoning_snapshots: createChainableMock({ data: [makeSnapshotRow()] }),
      ai_operations: createChainableMock({ data: [] }),
      audit_events: createChainableMock({ data: [] }),
    });

    const sb = { from: mockFrom } as never;
    const result = await runReasoningPipeline(sb, { id: USER }, USER, 'new_lab');

    expect(result.contradictionsRecorded).toBe(1);
    expect(evidenceChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'contradicts',
        source_type: 'rule_engine',
        summary: expect.stringContaining('within range'),
      })
    );
  });
});
