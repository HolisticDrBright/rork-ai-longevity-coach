import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * clinical.scribe.* procedure tests (Milestone 1).
 *
 * The consent gates, bound tokens, state machine, provider enablement and
 * deletion workflow are proven against the live project by
 * AI_DESKTOP_PRO/supabase/tests/scribe_recording.sql. These tests cover the
 * procedure layer: auth gating, SERVER-side provider resolution (the client
 * never chooses), exact RPC argument wiring, DTO mapping (layered transcript),
 * and error translation (55000 → PRECONDITION_FAILED, 40003 → CONFLICT).
 */

const state = vi.hoisted(() => ({
  validToken: 'valid-clinical-token',
  user: { id: '10000000-0000-4000-8000-0000000000a1', email: 'practitioner@example.test' },
  membership: null as { role: string; status: string } | null,
  patient: null as { id: string; organization_id: string } | null,
  tables: {} as Record<string, unknown[]>,
  rpc: {} as Record<string, { data?: unknown; error?: { code: string; message?: string } | null }>,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
}));

vi.mock('../backend/clinical-supabase', () => {
  function chain(table: string) {
    const rows = () => state.tables[table] ?? [];
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'is', 'not', 'or', 'order', 'limit']) c[m] = () => c;
    c.maybeSingle = async () => {
      if (table === 'organization_memberships') return { data: state.membership, error: null };
      if (table === 'patient_profiles') return { data: state.patient, error: null };
      return { data: rows()[0] ?? null, error: null };
    };
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

// Worker ticks are a runtime concern — procedures must not fail because of
// them, and the SERVICE client must never leak into the request path.
vi.mock('../backend/scribe/runtime', () => ({
  getScribeWorkerDeps: () => null,
  getFixtureProvider: () => null,
  startScribeWorkers: () => {},
  stopScribeWorkers: () => {},
  resetScribeRuntime: () => {},
}));

import { clinicalRouter } from '../backend/trpc/routes/clinical';

const ORG_ID = '10000000-0000-4000-8000-0000000000d1';
const ENCOUNTER_ID = '10000000-0000-4000-8000-0000000000f1';
const PARTICIPANT_ID = '10000000-0000-4000-8000-0000000000f2';
const CONSENT_DOC_ID = '10000000-0000-4000-8000-0000000000f3';
const RECORDING_ID = '10000000-0000-4000-8000-0000000000f4';
const SESSION_ID = '10000000-0000-4000-8000-0000000000f5';
const TRANSCRIPT_ID = '10000000-0000-4000-8000-0000000000f6';
const SEGMENT_ID = '10000000-0000-4000-8000-0000000000f7';

function caller(sessionToken: string | null) {
  return clinicalRouter.createCaller({
    req: new Request('http://localhost'),
    sessionToken,
    user: null,
  } as never);
}

beforeEach(() => {
  process.env.SCRIBE_MODE = 'fixture';
  process.env.SCRIBE_CALLBACK_SECRET = 'test-secret-0123456789abcdef';
  delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.HEALTHSCRIBE_REGION;
  delete process.env.HEALTHSCRIBE_KMS_KEY_ARN;
  delete process.env.HEALTHSCRIBE_DATA_ACCESS_ROLE_ARN;
  delete process.env.HEALTHSCRIBE_READINESS_REF;
  state.membership = { role: 'practitioner', status: 'active' };
  state.patient = { id: '10000000-0000-4000-8000-0000000000e1', organization_id: ORG_ID };
  state.tables = {};
  state.rpc = {};
  state.rpcCalls = [];
});

describe('auth gating', () => {
  test('every scribe procedure requires a valid session', async () => {
    const c = caller(null);
    await expect(c.scribe.providerStatus()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(c.scribe.beginRecording({ encounterId: ENCOUNTER_ID, contentType: 'audio/webm' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(c.scribe.heartbeat({ sessionId: SESSION_ID })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(c.scribe.generateDraft({ transcriptId: TRANSCRIPT_ID, noteType: 'soap' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('provider resolution is server-owned (req 8)', () => {
  test('fixture mode: beginRecording passes provider=fixture to the RPC', async () => {
    state.rpc.begin_recording = {
      data: {
        recording_id: RECORDING_ID, session_id: SESSION_ID, token: 'raw-token-once',
        expires_at: '2026-07-18T00:00:00Z', content_type: 'audio/webm', max_bytes: 1000,
      },
    };
    const out = await caller(state.validToken).scribe.beginRecording({
      encounterId: ENCOUNTER_ID, contentType: 'audio/webm', maxBytes: 1000, ttlSeconds: 120,
    });
    expect(out.provider).toBe('fixture');
    expect(out.captureToken).toBe('raw-token-once');
    const call = state.rpcCalls.find((c) => c.name === 'begin_recording')!;
    expect(call.args._provider).toBe('fixture');
    expect(call.args._encounter_id).toBe(ENCOUNTER_ID);
  });

  test('live mode with only the fixture configured → PRECONDITION_FAILED, no RPC call', async () => {
    process.env.SCRIBE_MODE = 'live';
    await expect(
      caller(state.validToken).scribe.beginRecording({ encounterId: ENCOUNTER_ID, contentType: 'audio/webm' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(state.rpcCalls.length).toBe(0);
    const status = await caller(state.validToken).scribe.providerStatus();
    expect(status).toMatchObject({ mode: 'live', available: false, provider: null });
    expect(status.reason).toMatch(/cannot serve live mode/i);
  });

  test('disabled mode: providerStatus says Not configured; beginRecording fails closed with no RPC call', async () => {
    process.env.SCRIBE_MODE = 'disabled';
    const status = await caller(state.validToken).scribe.providerStatus();
    expect(status).toMatchObject({ mode: 'disabled', available: false, provider: null });
    expect(status.reason).toMatch(/Not configured/);
    await expect(
      caller(state.validToken).scribe.beginRecording({ encounterId: ENCOUNTER_ID, contentType: 'audio/webm' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(state.rpcCalls.length).toBe(0);
  });

  test('deployed environment: fixture mode is refused — providerStatus honest, beginRecording fails closed', async () => {
    process.env.RAILWAY_PROJECT_ID = 'prj_test';
    const status = await caller(state.validToken).scribe.providerStatus();
    expect(status).toMatchObject({ mode: 'fixture', available: false, provider: null });
    expect(status.reason).toMatch(/not permitted in a deployed environment/);
    await expect(
      caller(state.validToken).scribe.beginRecording({ encounterId: ENCOUNTER_ID, contentType: 'audio/webm' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(state.rpcCalls.length).toBe(0);
  });

  test('live mode with full HealthScribe env resolves the production provider', async () => {
    process.env.SCRIBE_MODE = 'live';
    process.env.HEALTHSCRIBE_REGION = 'us-west-2';
    process.env.HEALTHSCRIBE_KMS_KEY_ARN = 'arn:aws:kms:us-west-2:123:key/abc';
    process.env.HEALTHSCRIBE_DATA_ACCESS_ROLE_ARN = 'arn:aws:iam::123:role/hs';
    process.env.HEALTHSCRIBE_READINESS_REF = 'ORR-2026-001';
    state.rpc.begin_recording = {
      data: { recording_id: RECORDING_ID, session_id: SESSION_ID, token: 't', expires_at: 'x', content_type: 'audio/webm', max_bytes: 1 },
    };
    const out = await caller(state.validToken).scribe.beginRecording({ encounterId: ENCOUNTER_ID, contentType: 'audio/webm' });
    expect(out.provider).toBe('aws_healthscribe');
    expect(state.rpcCalls.find((c) => c.name === 'begin_recording')!.args._provider).toBe('aws_healthscribe');
  });
});

describe('error translation', () => {
  test('55000 (consent/enablement precondition) → PRECONDITION_FAILED', async () => {
    state.rpc.begin_recording = { error: { code: '55000' } };
    await expect(
      caller(state.validToken).scribe.beginRecording({ encounterId: ENCOUNTER_ID, contentType: 'audio/webm' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  test('40003 (invalid state transition) → CONFLICT', async () => {
    state.rpc.queue_transcription = { error: { code: '40003' } };
    await expect(
      caller(state.validToken).scribe.queueTranscription({ recordingId: RECORDING_ID }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('42501 (cross-org) → FORBIDDEN; P0002 → NOT_FOUND', async () => {
    state.rpc.withdraw_consent = { error: { code: '42501' } };
    await expect(
      caller(state.validToken).scribe.withdrawConsent({ consentId: PARTICIPANT_ID }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    state.rpc.heartbeat_capture = { error: { code: 'P0002' } };
    await expect(
      caller(state.validToken).scribe.heartbeat({ sessionId: SESSION_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('consent wiring', () => {
  test('recordConsent forwards representative authority exactly', async () => {
    state.rpc.record_consent = { data: PARTICIPANT_ID };
    await caller(state.validToken).scribe.recordConsent({
      participantId: PARTICIPANT_ID,
      scope: 'recording',
      consentDocumentId: CONSENT_DOC_ID,
      method: 'verbal_attested',
      signerAcknowledgment: 'Guardian agreed on behalf of the child.',
      jurisdiction: 'US-CA',
      representative: { name: 'Pat Sr', relationship: 'parent', basis: 'minor_guardian', authority: 'custodial parent' },
    });
    const call = state.rpcCalls.find((c) => c.name === 'record_consent')!;
    expect(call.args).toMatchObject({
      _participant_id: PARTICIPANT_ID,
      _scope: 'recording',
      _consent_document_id: CONSENT_DOC_ID,
      _method: 'verbal_attested',
      _signer_acknowledgment: 'Guardian agreed on behalf of the child.',
      _representative_basis: 'minor_guardian',
      _representative_authority: 'custodial parent',
    });
  });

  test('heartbeat maps rotation token and paused state', async () => {
    state.rpc.heartbeat_capture = { data: { ok: true, status: 'active', token: 'rotated', expires_at: 'later' } };
    const active = await caller(state.validToken).scribe.heartbeat({ sessionId: SESSION_ID });
    expect(active).toEqual({ ok: true, status: 'active', captureToken: 'rotated', expiresAt: 'later' });
    state.rpc.heartbeat_capture = { data: { ok: false, status: 'paused' } };
    const paused = await caller(state.validToken).scribe.heartbeat({ sessionId: SESSION_ID });
    expect(paused).toEqual({ ok: false, status: 'paused', captureToken: null, expiresAt: null });
  });
});

describe('layered transcript DTO (req 5)', () => {
  test('raw, provider revision and correction layers stay distinct', async () => {
    state.tables.encounter_transcripts = [
      { id: TRANSCRIPT_ID, encounter_id: ENCOUNTER_ID, provider: 'fixture', revision: 3, status: 'corrected', created_at: 'c', finalized_at: null },
    ];
    state.tables.transcript_segments = [
      { id: SEGMENT_ID, seq: 1, speaker_label: 'clinician', start_ms: 0, end_ms: 4000, text: 'raw asr text', confidence: 0.9 },
    ];
    state.tables.transcript_segment_revisions = [
      { segment_id: SEGMENT_ID, revision: 1, text: 'provider revised text', confidence: 0.95 },
    ];
    state.tables.transcript_corrections = [
      { segment_id: SEGMENT_ID, version: 1, source_revision: 1, corrected_text: 'practitioner corrected text', reason: 'clarity', created_at: 'c' },
    ];
    const t = await caller(state.validToken).scribe.transcript({ recordingId: RECORDING_ID });
    expect(t).not.toBeNull();
    const seg = t!.segments[0];
    expect(seg.rawText).toBe('raw asr text');
    expect(seg.providerRevisions).toEqual([{ revision: 1, text: 'provider revised text', confidence: 0.95 }]);
    expect(seg.corrections[0]).toMatchObject({ version: 1, sourceRevision: 1, text: 'practitioner corrected text' });
    expect(seg.effectiveText).toBe('practitioner corrected text');
    expect(seg.effectiveSource).toBe('correction');
    expect(t!.status).toBe('corrected');
    expect(t!.revision).toBe(3);
  });

  test('no transcript yet → null (not an error)', async () => {
    const t = await caller(state.validToken).scribe.transcript({ recordingId: RECORDING_ID });
    expect(t).toBeNull();
  });
});

describe('scribe draft generation (req 6)', () => {
  test('model + template identifiers are server-owned; DTO maps idempotency', async () => {
    state.rpc.generate_scribe_draft = {
      data: { note_id: '10000000-0000-4000-8000-0000000000aa', generation_id: '10000000-0000-4000-8000-0000000000ab', idempotent: false },
    };
    const out = await caller(state.validToken).scribe.generateDraft({ transcriptId: TRANSCRIPT_ID, noteType: 'soap' });
    expect(out.idempotent).toBe(false);
    const call = state.rpcCalls.find((c) => c.name === 'generate_scribe_draft')!;
    expect(call.args).toMatchObject({
      _transcript_id: TRANSCRIPT_ID,
      _note_type: 'soap',
      _model: 'fixture-scribe-1',
      _provider: 'fixture',
      _prompt_template_version: 'm1-scribe-tmpl-v1',
    });
  });

  test('generateDraft without ai_drafting consent surfaces PRECONDITION_FAILED', async () => {
    state.rpc.generate_scribe_draft = { error: { code: '55000' } };
    await expect(
      caller(state.validToken).scribe.generateDraft({ transcriptId: TRANSCRIPT_ID, noteType: 'soap' }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});

describe('admin surfaces', () => {
  test('quarantined + deadLetterJobs require the admin role', async () => {
    state.membership = { role: 'practitioner', status: 'active' };
    await expect(caller(state.validToken).scribe.quarantined({ organizationId: ORG_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller(state.validToken).scribe.deadLetterJobs({ organizationId: ORG_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    state.membership = { role: 'admin', status: 'active' };
    state.tables.encounter_recordings = [];
    state.tables.recording_deletion_jobs = [];
    await expect(caller(state.validToken).scribe.quarantined({ organizationId: ORG_ID })).resolves.toEqual([]);
    await expect(caller(state.validToken).scribe.deadLetterJobs({ organizationId: ORG_ID })).resolves.toEqual([]);
  });

  test('retryDeadLetterJob wires the audited admin RPC', async () => {
    state.rpc.retry_dead_letter_deletion_job = { data: null };
    await caller(state.validToken).scribe.retryDeadLetterJob({ jobId: SESSION_ID });
    expect(state.rpcCalls.find((c) => c.name === 'retry_dead_letter_deletion_job')!.args._job_id).toBe(SESSION_ID);
  });
});

describe('security access log routing (req 10)', () => {
  test('logAccess uses log_transcript_access (security log), never audit RPCs', async () => {
    state.rpc.log_transcript_access = { data: null };
    await caller(state.validToken).scribe.logAccess({ transcriptId: TRANSCRIPT_ID, kind: 'accessed' });
    expect(state.rpcCalls.map((c) => c.name)).toEqual(['log_transcript_access']);
  });
});
