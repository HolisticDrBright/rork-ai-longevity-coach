import { beforeEach, describe, expect, test, vi } from 'vitest';

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
    for (const method of ['select', 'eq', 'neq', 'is', 'in', 'order', 'limit']) c[method] = () => c;
    c.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
    c.then = (resolve: (value: unknown) => void) => resolve({ data: rows(), error: null });
    return c;
  }
  return {
    createClinicalAnonClient: () => ({
      auth: {
        getUser: async (token: string) => token === state.validToken
          ? { data: { user: state.user }, error: null }
          : { data: { user: null }, error: { message: 'invalid token' } },
      },
    }),
    createClinicalUserClient: () => ({
      from: (table: string) => chain(table),
      rpc: async (name: string, args: Record<string, unknown>) => {
        state.rpcCalls.push({ name, args });
        const result = state.rpc[name];
        return result
          ? { data: result.data ?? null, error: result.error ?? null }
          : { data: null, error: { code: 'XXXXX', message: 'no mock' } };
      },
    }),
    createClinicalServiceClient: () => {
      throw new Error('service client must not be used by knowledge procedures');
    },
  };
});

vi.mock('../backend/scribe/runtime', () => ({
  getScribeWorkerDeps: () => null,
  getFixtureProvider: () => null,
  startScribeWorkers: () => {},
  stopScribeWorkers: () => {},
  resetScribeRuntime: () => {},
}));

import { clinicalRouter } from '../backend/trpc/routes/clinical';

const ORG_ID = '10000000-0000-4000-8000-0000000000d1';
const PATIENT_ID = '10000000-0000-4000-8000-0000000000e1';
const PATHWAY_ID = '10000000-0000-4000-8000-0000000000f1';
const VERSION_ID = '10000000-0000-4000-8000-0000000000f2';
const RUN_ID = '10000000-0000-4000-8000-0000000000f3';

function caller(token: string | null) {
  return clinicalRouter.createCaller({
    req: new Request('http://localhost'),
    sessionToken: token,
    user: null,
  } as never);
}

beforeEach(() => {
  state.tables = {
    organization_memberships: [{ role: 'admin', status: 'active' }],
    patient_profiles: [{ id: PATIENT_ID, organization_id: ORG_ID }],
  };
  state.rpc = {};
  state.rpcCalls = [];
});

describe('clinical.knowledge', () => {
  test('all procedures require a verified clinical session', async () => {
    await expect(caller(null).knowledge.pathways({ organizationId: ORG_ID }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(caller(null).knowledge.patientRuns({ patientId: PATIENT_ID }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  test('maps pathway versions without losing source or approval state', async () => {
    state.tables.clinical_pathways = [{
      id: PATHWAY_ID,
      organization_id: ORG_ID,
      code: 'thyroid',
      name: 'Thyroid classification',
      domain_code: 'endocrine',
      description: 'Governed pathway',
      retired_at: null,
      clinical_pathway_versions: [{
        id: VERSION_ID,
        version: 2,
        status: 'approved',
        content: { questions: ['q1'] },
        source_refs: [{ code: 'practice-thyroid-v2' }],
        content_sha256: 'a'.repeat(64),
        change_summary: 'Reviewed',
        created_at: '2026-07-27T00:00:00Z',
        approved_at: '2026-07-27T01:00:00Z',
      }],
    }];

    const result = await caller(state.validToken).knowledge.pathways({ organizationId: ORG_ID });
    expect(result[0]).toMatchObject({
      id: PATHWAY_ID,
      code: 'thyroid',
      versions: [{ id: VERSION_ID, version: 2, status: 'approved' }],
    });
    expect(result[0]?.versions[0]?.sourceRefs).toEqual([{ code: 'practice-thyroid-v2' }]);
  });

  test('creates drafts and approvals through exact RPC contracts', async () => {
    state.rpc.create_clinical_pathway_draft = { data: { versionId: VERSION_ID, version: 2 } };
    state.rpc.approve_clinical_pathway_version = { data: null };
    const c = caller(state.validToken);

    await c.knowledge.createDraft({
      organizationId: ORG_ID,
      pathwayId: PATHWAY_ID,
      content: { differentiatingQuestions: ['Question?'] },
      sourceRefs: [{ code: 'source-v1' }],
      changeSummary: 'Add question',
    });
    await c.knowledge.approve({ organizationId: ORG_ID, versionId: VERSION_ID });

    expect(state.rpcCalls[0]).toEqual({
      name: 'create_clinical_pathway_draft',
      args: {
        _pathway_id: PATHWAY_ID,
        _content: { differentiatingQuestions: ['Question?'] },
        _source_refs: [{ code: 'source-v1' }],
        _change_summary: 'Add question',
      },
    });
    expect(state.rpcCalls[1]).toEqual({
      name: 'approve_clinical_pathway_version',
      args: { _version_id: VERSION_ID },
    });
  });

  test('records patient output against an approved pathway version through the patient gate', async () => {
    state.rpc.record_clinical_copilot_run = { data: RUN_ID };
    const result = await caller(state.validToken).knowledge.recordRun({
      patientId: PATIENT_ID,
      pathwayVersionId: VERSION_ID,
      inputSnapshot: { counts: { labs: 3 } },
      outputSnapshot: { labCandidates: ['Full thyroid panel'] },
      safetyStatus: 'incomplete',
      outputSchemaVersion: 'clinical-copilot-v1',
    });

    expect(result).toEqual({ runId: RUN_ID });
    expect(state.rpcCalls[0]).toMatchObject({
      name: 'record_clinical_copilot_run',
      args: {
        _patient_id: PATIENT_ID,
        _pathway_version_id: VERSION_ID,
        _safety_status: 'incomplete',
      },
    });
  });

  test('database state errors stay typed at the API boundary', async () => {
    state.rpc.approve_clinical_pathway_version = { error: { code: '55000', message: 'only a draft can be approved' } };
    await expect(caller(state.validToken).knowledge.approve({
      organizationId: ORG_ID,
      versionId: VERSION_ID,
    })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });
});
