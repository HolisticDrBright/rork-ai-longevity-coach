import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * clinical.tasks / clinical.labs / clinical.actions procedure tests.
 *
 * The clinical Supabase clients are mocked: table reads resolve from
 * `state.tables`, RPC calls resolve from `state.rpc` (result or PostgREST-
 * style error with a SQLSTATE code). The SECURITY DEFINER RPCs themselves are
 * proven against the live project by AI_DESKTOP_PRO/supabase/tests/
 * (app_facing_functions.sql, resolve_review_queue_item.sql); these tests
 * cover the procedure layer — auth gating, input validation, snake→camel
 * wire mapping (parity with the desktop's live-types + contract fixture),
 * and RPC error translation.
 */

const state = vi.hoisted(() => ({
  validToken: 'valid-clinical-token',
  user: { id: '10000000-0000-4000-8000-0000000000b1', email: 'practitioner@example.test' },
  membership: null as { role: string; status: string } | null,
  patient: null as { id: string; organization_id: string } | null,
  tables: {} as Record<string, unknown[]>,
  rpc: {} as Record<string, { data?: unknown; error?: { code: string } }>,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
}));

vi.mock('../backend/clinical-supabase', () => {
  function chain(table: string) {
    const rows = () => state.tables[table] ?? [];
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'is', 'order', 'limit']) c[m] = () => c;
    c.maybeSingle = async () => {
      if (table === 'organization_memberships') return { data: state.membership, error: null };
      if (table === 'patient_profiles') return { data: state.patient, error: null };
      return { data: rows()[0] ?? null, error: null };
    };
    // Supabase query builders are thenable — list queries await the chain itself.
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
        if (!r) return { data: null, error: { code: 'XXXXX' } };
        return { data: r.data ?? null, error: r.error ?? null };
      },
    }),
    createClinicalServiceClient: () => {
      throw new Error('service client must not be used by clinical procedures');
    },
  };
});

import { clinicalRouter } from '../backend/trpc/routes/clinical';
import { mapQueueRow } from '../backend/trpc/routes/clinical/tasks';
import { buildMarkers, confidencePct } from '../backend/trpc/routes/clinical/labs';

const ORG_ID = '10000000-0000-4000-8000-0000000000d1';
const PATIENT_ID = '10000000-0000-4000-8000-0000000000e1';
const ITEM_ID = '10000000-0000-4000-8000-0000000000f1';

function caller(sessionToken: string | null) {
  return clinicalRouter.createCaller({
    req: new Request('http://localhost'),
    sessionToken,
    user: null,
  } as never);
}

beforeEach(() => {
  state.membership = { role: 'practitioner', status: 'active' };
  state.patient = { id: PATIENT_ID, organization_id: ORG_ID };
  state.tables = {};
  state.rpc = {};
  state.rpcCalls = [];
});

describe('clinical.tasks.getQueue', () => {
  test('maps rows to the desktop wire shape (LiveQueueItem parity)', async () => {
    state.tables['review_queue_items'] = [
      {
        id: ITEM_ID,
        item_type: 'abnormal_result',
        title: 'Recheck marker',
        priority: 'high',
        status: 'open',
        patient_id: PATIENT_ID,
        assignee_user_id: state.user.id,
        due_at: '2026-07-20T00:00:00Z',
        created_at: '2026-07-10T00:00:00Z',
        patient_profiles: { first_name: 'Fixture', last_name: 'Patient' },
      },
    ];
    const rows = await caller(state.validToken).tasks.getQueue({ organizationId: ORG_ID });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: ITEM_ID,
      itemType: 'abnormal_result',
      title: 'Recheck marker',
      priority: 'high',
      status: 'open',
      patientId: PATIENT_ID,
      patientName: 'Fixture Patient',
      assigneeName: 'You',
      dueAt: '2026-07-20T00:00:00Z',
      createdAt: '2026-07-10T00:00:00Z',
    });
    // Exact key parity with the desktop LiveQueueItem type.
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['assigneeName', 'createdAt', 'dueAt', 'id', 'itemType', 'patientId', 'patientName', 'priority', 'status', 'title'].sort(),
    );
  });

  test('denies non-members and missing tokens', async () => {
    state.membership = null;
    await expect(
      caller(state.validToken).tasks.getQueue({ organizationId: ORG_ID }),
    ).rejects.toThrow(/not a member/i);
    await expect(caller(null).tasks.getQueue({ organizationId: ORG_ID })).rejects.toThrow(
      /authentication required/i,
    );
  });

  test('org-level rows (patient null) map with null patient fields', () => {
    const mapped = mapQueueRow(
      {
        id: ITEM_ID,
        item_type: 'assessment',
        title: 'Org item',
        priority: 'medium',
        status: 'open',
        patient_id: null,
        assignee_user_id: null,
        due_at: null,
        created_at: '2026-07-10T00:00:00Z',
        patient_profiles: null,
      },
      state.user.id,
    );
    expect(mapped.patientId).toBeNull();
    expect(mapped.patientName).toBeNull();
    expect(mapped.assigneeName).toBeNull();
  });
});

describe('clinical.tasks.resolve', () => {
  test('maps the 0014 RPC result to camelCase (LiveResolveResult parity)', async () => {
    state.rpc['resolve_review_queue_item'] = {
      data: {
        id: ITEM_ID,
        status: 'resolved',
        previous_status: 'open',
        already_resolved: false,
        audit_event_id: 'aud-1',
      },
    };
    const res = await caller(state.validToken).tasks.resolve({ itemId: ITEM_ID });
    expect(res).toEqual({
      id: ITEM_ID,
      status: 'resolved',
      previousStatus: 'open',
      alreadyResolved: false,
      auditEventId: 'aud-1',
    });
    expect(state.rpcCalls[0]).toEqual({
      name: 'resolve_review_queue_item',
      args: { _item_id: ITEM_ID, _note: null },
    });
  });

  test('translates RPC SQLSTATEs into typed errors', async () => {
    state.rpc['resolve_review_queue_item'] = { error: { code: '42501' } };
    await expect(caller(state.validToken).tasks.resolve({ itemId: ITEM_ID })).rejects.toThrow(
      /not authorized/i,
    );
    state.rpc['resolve_review_queue_item'] = { error: { code: 'P0002' } };
    await expect(caller(state.validToken).tasks.resolve({ itemId: ITEM_ID })).rejects.toThrow(
      /not found/i,
    );
  });
});

describe('clinical.actions', () => {
  test('listAuditEvents maps snake_case rows to LiveAuditEvent parity', async () => {
    state.rpc['list_audit_events'] = {
      data: [
        {
          id: 'aud-1',
          action: 'review_task.resolve',
          resource_type: 'review_queue_item',
          resource_id: ITEM_ID,
          safe_message: 'Review task resolved',
          metadata: { previous_status: 'open' },
          patient_id: PATIENT_ID,
          actor_user_id: state.user.id,
          occurred_at: '2026-07-16T00:00:00Z',
        },
      ],
    };
    const rows = await caller(state.validToken).actions.listAuditEvents({
      organizationId: ORG_ID,
      limit: 50,
    });
    expect(rows[0]).toEqual({
      id: 'aud-1',
      action: 'review_task.resolve',
      resourceType: 'review_queue_item',
      resourceId: ITEM_ID,
      safeMessage: 'Review task resolved',
      metadata: { previous_status: 'open' },
      patientId: PATIENT_ID,
      actorUserId: state.user.id,
      occurredAt: '2026-07-16T00:00:00Z',
    });
  });

  test('recordAudit forwards PHI-safe fields to the 0013 RPC and returns the id', async () => {
    state.rpc['record_audit_event'] = { data: 'aud-9' };
    const res = await caller(state.validToken).actions.recordAudit({
      organizationId: ORG_ID,
      action: 'marker.view',
      patientId: PATIENT_ID,
    });
    expect(res).toEqual({ id: 'aud-9' });
    expect(state.rpcCalls[0].args._organization_id).toBe(ORG_ID);
    expect(state.rpcCalls[0].args._patient_id).toBe(PATIENT_ID);
  });

  test('createReviewTask maps the RPC jsonb to LiveTaskResult parity', async () => {
    state.rpc['create_review_task'] = { data: { id: ITEM_ID, status: 'open', audit_event_id: 'aud-2' } };
    const res = await caller(state.validToken).actions.createReviewTask({
      patientId: PATIENT_ID,
      title: 'Follow up marker',
    });
    expect(res).toEqual({ ok: true, id: ITEM_ID, status: 'open', message: 'Review task created.' });
    expect(state.rpcCalls[0].args._item_type).toBe('abnormal_result');
    expect(state.rpcCalls[0].args._priority).toBe('medium');
  });
});

describe('clinical.labs', () => {
  test('reviewMarker maps the 0013 RPC result (LiveReviewResult parity)', async () => {
    state.rpc['review_biomarker'] = {
      data: { review_status: 'accepted', reviewed_at: '2026-07-16T00:00:00Z', previous_status: 'unreviewed' },
    };
    const res = await caller(state.validToken).labs.reviewMarker({
      observationId: ITEM_ID,
      decision: 'accepted',
    });
    expect(res).toEqual({
      ok: true,
      reviewStatus: 'accepted',
      reviewedAt: '2026-07-16T00:00:00Z',
      previousStatus: 'unreviewed',
      message: 'Marker review saved (accepted).',
    });
  });

  test('reviewMarker rejects an invalid decision at the input boundary', async () => {
    await expect(
      caller(state.validToken).labs.reviewMarker({
        observationId: ITEM_ID,
        // @ts-expect-error — invalid decision must be rejected by zod
        decision: 'bogus',
      }),
    ).rejects.toThrow();
    expect(state.rpcCalls).toHaveLength(0); // never reached the database
  });

  test('buildMarkers: latest→current, prior, oldest→newest series, verbatim lab range', () => {
    const base = {
      biomarker_definition_id: 'def-1',
      value_text: null,
      unit: 'mg/L',
      status: 'high',
      original_reference_interval: '<3.0',
      confidence: 0.98,
      provenance: 'lab_pdf_ocr',
      reviewed_at: null,
      ingested_at: '2026-07-01T00:00:00Z',
      lab_document_id: null,
      source: 'lab',
      biomarker_definitions: { canonical_name: 'hs-CRP', biological_system: 'Inflammation' },
      lab_documents: { file_name: 'panel.pdf', lab_company: 'Quest' },
    };
    const markers = buildMarkers([
      { ...base, id: 'o-new', value_numeric: 2.8, review_status: 'unreviewed', observed_at: '2026-07-10T00:00:00Z' },
      { ...base, id: 'o-old', value_numeric: 3.4, review_status: 'accepted', observed_at: '2026-06-01T00:00:00Z' },
      // text-only rows never fabricate a numeric marker
      { ...base, id: 'o-text', value_numeric: null, value_text: 'positive', review_status: 'unreviewed', observed_at: '2026-07-11T00:00:00Z' },
    ] as never);
    expect(markers).toHaveLength(1);
    const m = markers[0];
    expect(m.id).toBe('o-new');
    expect(m.current).toBe(2.8);
    expect(m.prior).toBe(3.4);
    expect(m.labRangeText).toBe('<3.0'); // original interval, verbatim
    expect(m.optimalRange).toEqual({ unit: 'mg/L', source: 'Not configured' });
    expect(m.series.map((p) => p.value)).toEqual([3.4, 2.8]); // oldest → newest
    expect(m.confidence).toBe(98);
    expect(m.confidenceBand).toBe('high');
    expect(m.reviewState).toBe('awaiting-review');
    expect(m.status).toBe('high'); // source flagged abnormal
  });

  test('confidencePct normalizes 0–1 and 0–100 storage', () => {
    expect(confidencePct(0.92)).toBe(92);
    expect(confidencePct(92)).toBe(92);
    expect(confidencePct(null)).toBe(50);
  });
});
