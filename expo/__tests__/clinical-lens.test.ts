import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * clinical.lens.* procedure tests (Milestone 2).
 *
 * The persistence contracts — snapshotting, supersede, dedupe, lifecycle,
 * versioned answers, safety blocks, tenancy — are proven against the live
 * project by AI_DESKTOP_PRO/supabase/tests/lens_engine.sql. The engine's
 * adversarial behavior is proven by lens-safety.test.ts. These tests cover
 * the procedure layer: auth gating, evaluation orchestration through the
 * caller's RLS-scoped client (never the service client), exact RPC argument
 * wiring, snapshot/no-PHI discipline, DTO mapping, and error translation.
 */

const state = vi.hoisted(() => ({
  validToken: 'valid-clinical-token',
  user: { id: '10000000-0000-4000-8000-0000000000a1', email: 'practitioner@example.test' },
  tables: {} as Record<string, unknown[]>,
  rpc: {} as Record<string, { data?: unknown; error?: { code: string; message?: string } | null }>,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
}));

vi.mock('../backend/clinical-supabase', () => {
  function chain(table: string) {
    const rows = () => state.tables[table] ?? [];
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'is', 'not', 'or', 'in', 'order', 'limit']) c[m] = () => c;
    c.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
    c.then = (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null });
    return c;
  }
  return {
    createClinicalAnonClient: () => ({
      auth: {
        getUser: async (token: string) =>
          token === state.validToken
            ? { data: { user: state.user }, error: null }
            : { data: { user: null }, error: { message: 'invalid token' } },
      },
    }),
    createClinicalUserClient: () => ({
      from: (table: string) => chain(table),
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.rpcCalls.push({ name, args });
        const r = state.rpc[name];
        if (!r) return { data: null, error: { code: 'XXXXX', message: 'no mock' } };
        return { data: r.data ?? null, error: r.error ?? null };
      },
    }),
    createClinicalServiceClient: () => {
      throw new Error('service client must not be used by clinical procedures');
    },
  };
});

// Importing the clinical router pulls in the scribe router; its worker
// runtime is irrelevant here and must never start.
vi.mock('../backend/scribe/runtime', () => ({
  getScribeWorkerDeps: () => null,
  getFixtureProvider: () => null,
  startScribeWorkers: () => {},
  stopScribeWorkers: () => {},
  resetScribeRuntime: () => {},
}));

import { clinicalRouter } from '../backend/trpc/routes/clinical';
import { KNOWLEDGE_CODES } from '../backend/lens/core';

const ORG_ID = '10000000-0000-4000-8000-0000000000d1';
const PATIENT_ID = '10000000-0000-4000-8000-0000000000e1';
const ENCOUNTER_ID = '10000000-0000-4000-8000-0000000000f1';
const EVAL_ID = '10000000-0000-4000-8000-0000000000f2';
const QUESTION_ID = '10000000-0000-4000-8000-0000000000f3';
const NOTE_ID = '10000000-0000-4000-8000-0000000000f4';
const BLOCK_ID = '10000000-0000-4000-8000-0000000000f5';
const TRANSCRIPT_ID = '10000000-0000-4000-8000-0000000000f6';
const SEGMENT_ID = '10000000-0000-4000-8000-0000000000f7';

function caller(sessionToken: string | null) {
  return clinicalRouter.createCaller({
    req: new Request('http://localhost'),
    sessionToken,
    user: null,
  } as never);
}

/** Happy-path chart: one elevated BP, one sleep complaint — no urgent flags. */
function seedHappyChart() {
  state.tables.encounters = [{ id: ENCOUNTER_ID, organization_id: ORG_ID, patient_id: PATIENT_ID }];
  state.tables.patient_profiles = [{ id: PATIENT_ID, date_of_birth: '1980-02-02', sex: 'female' }];
  state.tables.biomarker_observations = [
    { id: 'b0000000-0000-4000-8000-000000000001', original_name: 'Blood pressure systolic', value_numeric: 142, value_text: null, unit: 'mmHg', observed_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' },
  ];
  state.tables.medications = [];
  state.tables.allergies = [];
  state.tables.encounter_transcripts = [{ id: TRANSCRIPT_ID, revision: 2 }];
  state.tables.transcript_segments = [{ id: SEGMENT_ID, seq: 1, text: 'I have been sleeping poorly lately.' }];
  state.tables.transcript_corrections = [];
  state.tables.supplement_protocol_items = [];
}

beforeEach(() => {
  delete process.env.LENS_AI_MODE;
  delete process.env.LENS_AI_PROVIDER;
  delete process.env.LENS_AI_MODEL;
  delete process.env.LENS_AI_APPROVAL_REF;
  delete process.env.RAILWAY_PROJECT_ID;
  state.tables = {};
  state.rpc = {};
  state.rpcCalls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auth gating', () => {
  test('every lens procedure requires a valid session', async () => {
    const c = caller(null);
    await expect(c.lens.aiStatus()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(c.lens.paradigms()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(c.lens.evaluate({ encounterId: ENCOUNTER_ID, paradigm: 'functional' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(c.lens.questionAction({ questionId: QUESTION_ID, action: 'accepted' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(c.lens.answer({ questionId: QUESTION_ID, value: { text: 'x' } })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(c.lens.reviewSafetyBlock({ blockId: BLOCK_ID, resolution: 'reviewed' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('aiStatus posture', () => {
  test('fixture default: available, not live-configured', async () => {
    const out = await caller(state.validToken).lens.aiStatus();
    expect(out).toMatchObject({ mode: 'fixture', available: true, liveConfigured: false, reason: null });
  });

  test('live mode with only the fixture configured: unavailable with an explicit refusal reason', async () => {
    process.env.LENS_AI_MODE = 'live';
    const out = await caller(state.validToken).lens.aiStatus();
    expect(out).toMatchObject({ mode: 'live', available: false, liveConfigured: false });
    expect(out.reason).toMatch(/fixture cannot serve live mode/i);
  });

  test('live mode fully configured: STILL unavailable pending external approval', async () => {
    process.env.LENS_AI_MODE = 'live';
    process.env.LENS_AI_PROVIDER = 'anthropic';
    process.env.LENS_AI_MODEL = 'some-model';
    process.env.LENS_AI_APPROVAL_REF = 'CDS-REV-2026-004';
    const out = await caller(state.validToken).lens.aiStatus();
    expect(out).toMatchObject({ mode: 'live', available: false, liveConfigured: true });
    expect(out.reason).toMatch(/disabled.*pending external approval/i);
  });

  test('deployed environment: the fixture AI is refused even in fixture mode (fail closed)', async () => {
    process.env.RAILWAY_PROJECT_ID = 'prj_test';
    const out = await caller(state.validToken).lens.aiStatus();
    expect(out).toMatchObject({ mode: 'fixture', available: false });
    expect(out.reason).toMatch(/not permitted in a deployed environment/);
  });

  test('disabled mode: honest Not-configured posture', async () => {
    process.env.LENS_AI_MODE = 'disabled';
    const out = await caller(state.validToken).lens.aiStatus();
    expect(out).toMatchObject({ mode: 'disabled', available: false });
    expect(out.reason).toMatch(/Not configured/);
  });
});

describe('evaluate orchestration + RPC wiring', () => {
  test('runs the deterministic engine and persists through run_lens_evaluation with a complete snapshot', async () => {
    seedHappyChart();
    state.rpc.run_lens_evaluation = {
      data: { evaluationId: EVAL_ID, status: 'complete', questionsInserted: 4, questionsDeduped: 0 },
    };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const out = await caller(state.validToken).lens.evaluate({ encounterId: ENCOUNTER_ID, paradigm: 'western_conventional' });
    expect(out).toEqual({ evaluationId: EVAL_ID, status: 'complete', questionsInserted: 4, questionsDeduped: 0, blockedRules: undefined });

    const call = state.rpcCalls.find((c) => c.name === 'run_lens_evaluation')!;
    expect(call.args._encounter_id).toBe(ENCOUNTER_ID);
    expect(call.args._paradigm).toBe('western_conventional');
    expect(call.args._rule_set_version).toBe('lens-rules-v1');
    expect(call.args._output_schema_version).toBe('lens-output-v1');
    expect(call.args._output_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(call.args._input_cutoff).toBeTruthy();

    // snapshot carries counts + presence flags ONLY — no chart facts
    expect(call.args._input_snapshot).toEqual({
      counts: { biomarkers: 1, medications: 0, allergies: 0, supplements: 0, transcriptSegments: 1 },
      demographicsPresent: { dateOfBirth: true, sex: true },
    });

    // invariant core carries all eleven sections
    const core = call.args._invariant_core as Record<string, unknown>;
    for (const key of [
      'objectiveFacts', 'provenance', 'missingInformation', 'conflicts', 'allergies',
      'interactions', 'criticalLabs', 'redFlags', 'emergencyConsiderations', 'evidenceQuality', 'limitations',
    ]) expect(core[key]).toBeDefined();

    // fixture AI identity is recorded in the snapshot columns
    expect(call.args._provider).toBe('fixture');
    expect(call.args._model).toBe('fixture-lens-1');
    expect(call.args._prompt_template_version).toBe('m2-lens-tmpl-v1');

    // questions: deterministic BP + sleep + fixture AI, all registry-cited
    const questions = call.args._questions as Array<Record<string, unknown>>;
    const keys = questions.map((q) => q.dedupeKey);
    expect(keys).toContain('bp-measurement-technique');
    expect(keys).toContain('sleep-structured-history');
    expect(keys).toContain('ai-uncaptured-context');
    for (const q of questions) {
      expect((q.knowledgeSourceCodes as string[]).every((code) => (KNOWLEDGE_CODES as readonly string[]).includes(code))).toBe(true);
    }
    expect(call.args._safety_failures).toEqual([]);
    expect(call.args._validation_result).toMatchObject({ schemaValid: true });

    // no-PHI logging: nothing logged may contain chart facts or transcript text
    const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toMatch(/sleeping poorly/i);
    expect(logged).not.toMatch(/systolic/i);
    expect(logged).not.toMatch(/142/);
  });

  test('disabled mode: the deterministic evaluation runs with NO AI leg and null provider identity', async () => {
    process.env.LENS_AI_MODE = 'disabled';
    seedHappyChart();
    state.rpc.run_lens_evaluation = { data: { evaluationId: EVAL_ID, status: 'complete', questionsInserted: 3 } };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = await caller(state.validToken).lens.evaluate({ encounterId: ENCOUNTER_ID, paradigm: 'western_conventional' });
    expect(out.status).toBe('complete');
    const call = state.rpcCalls.find((c) => c.name === 'run_lens_evaluation')!;
    expect(call.args._provider).toBeNull();
    const keys = (call.args._questions as Array<Record<string, unknown>>).map((q) => q.dedupeKey);
    expect(keys).not.toContain('ai-uncaptured-context');
    expect(keys).toContain('sleep-structured-history');
  });

  test('deployed environment: the deterministic evaluation runs with NO AI leg and no fixture identity', async () => {
    process.env.RAILWAY_PROJECT_ID = 'prj_test';
    seedHappyChart();
    state.rpc.run_lens_evaluation = { data: { evaluationId: EVAL_ID, status: 'complete', questionsInserted: 3 } };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = await caller(state.validToken).lens.evaluate({ encounterId: ENCOUNTER_ID, paradigm: 'western_conventional' });
    expect(out.status).toBe('complete');
    const call = state.rpcCalls.find((c) => c.name === 'run_lens_evaluation')!;
    expect(call.args._provider).toBeNull();
    expect(call.args._model).toBeNull();
    const keys = (call.args._questions as Array<Record<string, unknown>>).map((q) => q.dedupeKey);
    expect(keys).not.toContain('ai-uncaptured-context');
    expect(keys).toContain('sleep-structured-history');
  });

  test('live AI mode refuses the AI leg but the deterministic evaluation still runs', async () => {
    process.env.LENS_AI_MODE = 'live';
    seedHappyChart();
    state.rpc.run_lens_evaluation = { data: { evaluationId: EVAL_ID, status: 'complete', questionsInserted: 3 } };
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const out = await caller(state.validToken).lens.evaluate({ encounterId: ENCOUNTER_ID, paradigm: 'functional' });
    expect(out.status).toBe('complete');
    const call = state.rpcCalls.find((c) => c.name === 'run_lens_evaluation')!;
    expect(call.args._provider).toBeNull();
    expect(call.args._model).toBeNull();
    const keys = (call.args._questions as Array<Record<string, unknown>>).map((q) => q.dedupeKey);
    expect(keys).not.toContain('ai-uncaptured-context'); // fixture never serves live mode
    expect(keys).toContain('sleep-structured-history'); // deterministic run unaffected
  });

  test('blocked evaluations map through unchanged (reviewable failure, zero questions)', async () => {
    seedHappyChart();
    state.rpc.run_lens_evaluation = { data: { evaluationId: EVAL_ID, status: 'blocked', blockedRules: 2 } };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = await caller(state.validToken).lens.evaluate({ encounterId: ENCOUNTER_ID, paradigm: 'tcm' });
    expect(out).toMatchObject({ evaluationId: EVAL_ID, status: 'blocked', blockedRules: 2 });
  });

  test('unknown encounter → NOT_FOUND before any RPC call', async () => {
    state.tables.encounters = [];
    await expect(
      caller(state.validToken).lens.evaluate({ encounterId: ENCOUNTER_ID, paradigm: 'functional' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(state.rpcCalls.length).toBe(0);
  });

  test('an invented paradigm is rejected by input validation', async () => {
    await expect(
      caller(state.validToken).lens.evaluate({ encounterId: ENCOUNTER_ID, paradigm: 'ayurvedic' as never }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  test('RPC errors translate: 22023 → BAD_REQUEST (invented reference), 42501 → FORBIDDEN (cross-org)', async () => {
    seedHappyChart();
    state.rpc.run_lens_evaluation = { error: { code: '22023' } };
    await expect(
      caller(state.validToken).lens.evaluate({ encounterId: ENCOUNTER_ID, paradigm: 'functional' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    state.rpc.run_lens_evaluation = { error: { code: '42501' } };
    await expect(
      caller(state.validToken).lens.evaluate({ encounterId: ENCOUNTER_ID, paradigm: 'functional' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('evaluation read model', () => {
  test('maps the snapshot, questions, and safety blocks; returns null when none exists', async () => {
    state.tables.lens_evaluations = [{
      id: EVAL_ID, paradigm_code: 'functional', status: 'complete',
      invariant_core: { redFlags: [] }, lens_framing: { paradigm: 'functional' },
      input_snapshot: { counts: {} }, input_cutoff_at: '2026-07-17T12:00:00Z',
      rule_set_version: 'lens-rules-v1', knowledge_versions: [{ code: 'aasm_sleep_questions', revision: 1 }],
      model: 'fixture-lens-1', provider: 'fixture', prompt_template_version: 'm2-lens-tmpl-v1',
      output_schema_version: 'lens-output-v1', output_sha256: 'a'.repeat(64),
      validation_result: { schemaValid: true }, stale: true, stale_reason: 'biomarker_changed',
      created_at: '2026-07-17T12:00:01Z',
    }];
    state.tables.differential_questions = [{
      id: QUESTION_ID, domain_code: 'sleep', question_text: 'Structured sleep history?',
      rationale: 'Sleep complaint in encounter.', distinguishes: ['a', 'b'], safety_relation: null,
      priority: 'medium', answer_type: 'free_text', patient_sources: [{ ref: `transcript_segment:${SEGMENT_ID}` }],
      knowledge_source_ids: ['k-1'], missing_data_assumptions: [], generation_method: 'deterministic_rules',
      generation_version: 'lens-rules-v1', status: 'suggested', status_reason: null, created_at: '2026-07-17T12:00:02Z',
    }];
    state.tables.lens_safety_blocks = [{
      id: BLOCK_ID, rule_code: 'unknown_citation', detail: { codes: ['bogus'] },
      created_at: '2026-07-17T12:00:03Z', reviewed_by: null, reviewed_at: null, resolution: null,
    }];

    const out = await caller(state.validToken).lens.evaluation({ encounterId: ENCOUNTER_ID, paradigm: 'functional' });
    expect(out).toMatchObject({
      evaluationId: EVAL_ID,
      status: 'complete',
      stale: true,
      staleReason: 'biomarker_changed',
      outputSha256: 'a'.repeat(64),
      ruleSetVersion: 'lens-rules-v1',
    });
    expect(out!.questions[0]).toMatchObject({
      id: QUESTION_ID, domainCode: 'sleep', priority: 'medium', status: 'suggested',
      generationMethod: 'deterministic_rules', safetyRelation: null,
    });
    expect(out!.safetyBlocks[0]).toMatchObject({ id: BLOCK_ID, ruleCode: 'unknown_citation', resolution: null });

    state.tables.lens_evaluations = [];
    const none = await caller(state.validToken).lens.evaluation({ encounterId: ENCOUNTER_ID, paradigm: 'functional' });
    expect(none).toBeNull();
  });
});

describe('registry + reference reads', () => {
  test('knowledgeSources: null attributes stay null (UI must render "unknown", never invent)', async () => {
    state.tables.clinical_knowledge_sources = [{
      id: '10000000-0000-4000-8000-0000000000c1', code: 'ifm_matrix_framework', revision: 1,
      citation: 'IFM Matrix', publisher: null, release_date: null, revision_date: null,
      intended_purpose: 'organizing framework', intended_population: null, required_inputs: null,
      data_quality_expectations: null, logic_summary: null, known_limitations: 'conceptual framework',
      out_of_scope_uses: null, validation_status: 'unvalidated', funding_conflicts: null,
    }];
    const out = await caller(state.validToken).lens.knowledgeSources();
    expect(out[0]).toMatchObject({
      code: 'ifm_matrix_framework',
      publisher: null,
      releaseDate: null,
      intendedPopulation: null,
      validationStatus: 'unvalidated',
      fundingConflicts: null,
    });
  });

  test('paradigms: synergistic is declared composite with its member lenses', async () => {
    state.tables.clinical_paradigms = [{
      code: 'synergistic', name: 'Best synergistic mix', description: 'Transparent composition',
      is_composite: true, composed_of: ['western_conventional', 'functional', 'naturopathic', 'tcm', 'biohacking'],
    }];
    const out = await caller(state.validToken).lens.paradigms();
    expect(out[0]).toMatchObject({ code: 'synergistic', isComposite: true });
    expect(out[0].composedOf.length).toBe(5);
  });
});

describe('question lifecycle wiring', () => {
  test('questionAction wires set_question_status; the enum permits accepted/asked/deferred/skipped only', async () => {
    state.rpc.set_question_status = { data: null, error: null };
    const out = await caller(state.validToken).lens.questionAction({ questionId: QUESTION_ID, action: 'accepted' });
    expect(out).toEqual({ ok: true });
    expect(state.rpcCalls[0]).toEqual({
      name: 'set_question_status',
      args: { _question_id: QUESTION_ID, _to: 'accepted', _reason: null },
    });
    await expect(
      caller(state.validToken).lens.questionAction({ questionId: QUESTION_ID, action: 'dismissed' as never }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  test('dismiss requires structured feedback and wires dismiss_question', async () => {
    state.rpc.dismiss_question = { data: null, error: null };
    await caller(state.validToken).lens.dismiss({ questionId: QUESTION_ID, feedbackKind: 'not_relevant', comment: 'covered earlier' });
    expect(state.rpcCalls[0]).toEqual({
      name: 'dismiss_question',
      args: { _question_id: QUESTION_ID, _feedback_kind: 'not_relevant', _comment: 'covered earlier' },
    });
  });

  test('answer/correctAnswer return the version; invalid lifecycle states translate to CONFLICT', async () => {
    state.rpc.answer_question = { data: 1 };
    const a = await caller(state.validToken).lens.answer({ questionId: QUESTION_ID, value: { text: '7 hours' } });
    expect(a).toEqual({ version: 1 });
    expect(state.rpcCalls[0].args._answer).toEqual({ text: '7 hours' });

    state.rpc.correct_question_answer = { data: 2 };
    const c = await caller(state.validToken).lens.correctAnswer({ questionId: QUESTION_ID, value: { text: '6 hours' }, reason: 'patient corrected' });
    expect(c).toEqual({ version: 2 });

    state.rpc.answer_question = { error: { code: '40003' } };
    await expect(
      caller(state.validToken).lens.answer({ questionId: QUESTION_ID, value: { text: 'x' } }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('answers returns every version with correction lineage', async () => {
    state.tables.question_answers = [
      { version: 1, answer_value: { text: '7 hours' }, corrects_version: null, correction_reason: null, answered_at: 't1', answered_by: 'u1' },
      { version: 2, answer_value: { text: '6 hours' }, corrects_version: 1, correction_reason: 'patient corrected', answered_at: 't2', answered_by: 'u1' },
    ];
    const out = await caller(state.validToken).lens.answers({ questionId: QUESTION_ID });
    expect(out.length).toBe(2);
    expect(out[0]).toMatchObject({ version: 1, correctsVersion: null });
    expect(out[1]).toMatchObject({ version: 2, correctsVersion: 1, correctionReason: 'patient corrected' });
  });

  test('recordNoteUse wires the explicit add-to-note audit; preconditions map to PRECONDITION_FAILED', async () => {
    state.rpc.record_question_note_use = { data: null, error: null };
    await caller(state.validToken).lens.recordNoteUse({ questionId: QUESTION_ID, noteId: NOTE_ID });
    expect(state.rpcCalls[0]).toEqual({
      name: 'record_question_note_use',
      args: { _question_id: QUESTION_ID, _note_id: NOTE_ID },
    });
    state.rpc.record_question_note_use = { error: { code: '55000' } };
    await expect(
      caller(state.validToken).lens.recordNoteUse({ questionId: QUESTION_ID, noteId: NOTE_ID }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  test('feedback and safety-block review wire their RPCs; review requires a resolution', async () => {
    state.rpc.submit_question_feedback = { data: null, error: null };
    await caller(state.validToken).lens.feedback({ questionId: QUESTION_ID, kind: 'helpful' });
    expect(state.rpcCalls[0].name).toBe('submit_question_feedback');

    state.rpc.review_safety_block = { data: null, error: null };
    await caller(state.validToken).lens.reviewSafetyBlock({ blockId: BLOCK_ID, resolution: 'Confirmed: citation list bug, engine fix scheduled.' });
    expect(state.rpcCalls[1]).toEqual({
      name: 'review_safety_block',
      args: { _block_id: BLOCK_ID, _resolution: 'Confirmed: citation list bug, engine fix scheduled.' },
    });
    await expect(
      caller(state.validToken).lens.reviewSafetyBlock({ blockId: BLOCK_ID, resolution: '' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
