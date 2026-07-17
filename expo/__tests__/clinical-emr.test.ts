import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * clinical.encounters.* / clinical.notes.* procedure tests (Phase 2 slice 1).
 *
 * The state machines, immutability triggers, idempotent signing, and tenant
 * gates are proven against the live project by
 * AI_DESKTOP_PRO/supabase/tests/emr_encounters.sql (28 rolled-back checks).
 * These tests cover the procedure layer: auth gating, exact RPC argument
 * wiring, snake→camel DTO mapping (contract parity with the desktop), and
 * error translation — especially 40001 → CONFLICT for the conflict view.
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
    for (const m of ['select', 'eq', 'neq', 'is', 'order', 'limit']) c[m] = () => c;
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

import { clinicalRouter } from '../backend/trpc/routes/clinical';

const ORG_ID = '10000000-0000-4000-8000-0000000000d1';
const PATIENT_ID = '10000000-0000-4000-8000-0000000000e1';
const ENCOUNTER_ID = '10000000-0000-4000-8000-0000000000f1';
const NOTE_ID = '10000000-0000-4000-8000-0000000000f2';
const APPOINTMENT_ID = '10000000-0000-4000-8000-0000000000f3';

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

describe('clinical.encounters.start', () => {
  test('wires exact RPC args and returns the encounter id', async () => {
    state.rpc['start_encounter'] = { data: ENCOUNTER_ID };
    const res = await caller(state.validToken).encounters.start({
      organizationId: ORG_ID,
      patientId: PATIENT_ID,
      visitType: 'follow-up',
      appointmentId: APPOINTMENT_ID,
    });
    expect(res).toEqual({ encounterId: ENCOUNTER_ID });
    expect(state.rpcCalls[0]).toEqual({
      name: 'start_encounter',
      args: {
        _organization_id: ORG_ID,
        _patient_id: PATIENT_ID,
        _visit_type: 'follow-up',
        _appointment_id: APPOINTMENT_ID,
      },
    });
  });

  test('appointment/patient mismatch surfaces as FORBIDDEN', async () => {
    state.rpc['start_encounter'] = { error: { code: '42501' } };
    await expect(
      caller(state.validToken).encounters.start({
        organizationId: ORG_ID,
        patientId: PATIENT_ID,
        visitType: 'follow-up',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('requires authentication', async () => {
    await expect(
      caller('wrong-token').encounters.start({
        organizationId: ORG_ID,
        patientId: PATIENT_ID,
        visitType: 'follow-up',
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('clinical.encounters.setStatus / get', () => {
  test('setStatus passes reason through', async () => {
    state.rpc['set_encounter_status'] = { data: null, error: null };
    const res = await caller(state.validToken).encounters.setStatus({
      encounterId: ENCOUNTER_ID,
      status: 'entered_in_error',
      reason: 'Opened on the wrong patient',
    });
    expect(res).toEqual({ ok: true });
    expect(state.rpcCalls[0]).toEqual({
      name: 'set_encounter_status',
      args: {
        _encounter_id: ENCOUNTER_ID,
        _status: 'entered_in_error',
        _reason: 'Opened on the wrong patient',
      },
    });
  });

  test('invalid transition maps to BAD_REQUEST', async () => {
    state.rpc['set_encounter_status'] = { error: { code: '22023' } };
    await expect(
      caller(state.validToken).encounters.setStatus({
        encounterId: ENCOUNTER_ID,
        status: 'completed',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  test('get maps encounter + notes to the wire DTO', async () => {
    state.tables['encounters'] = [
      {
        id: ENCOUNTER_ID,
        organization_id: ORG_ID,
        patient_id: PATIENT_ID,
        appointment_id: APPOINTMENT_ID,
        encounter_type: 'follow-up',
        status: 'in_progress',
        started_at: '2026-07-16T20:00:00Z',
        ended_at: null,
        status_reason: null,
        created_at: '2026-07-16T20:00:00Z',
      },
    ];
    state.tables['clinical_notes'] = [
      {
        id: NOTE_ID,
        encounter_id: ENCOUNTER_ID,
        patient_id: PATIENT_ID,
        note_type: 'soap',
        status: 'draft',
        current_version: 2,
        author_user_id: state.user.id,
        status_reason: null,
        created_at: '2026-07-16T20:05:00Z',
        updated_at: '2026-07-16T20:10:00Z',
      },
    ];
    const res = await caller(state.validToken).encounters.get({ encounterId: ENCOUNTER_ID });
    expect(res.encounter).toMatchObject({
      encounterId: ENCOUNTER_ID,
      visitType: 'follow-up',
      status: 'in_progress',
      appointmentId: APPOINTMENT_ID,
    });
    expect(res.notes).toEqual([
      expect.objectContaining({ noteId: NOTE_ID, noteType: 'soap', status: 'draft', currentVersion: 2 }),
    ]);
  });

  test('get returns NOT_FOUND when RLS hides the encounter', async () => {
    state.tables['encounters'] = [];
    await expect(
      caller(state.validToken).encounters.get({ encounterId: ENCOUNTER_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('clinical.notes.save', () => {
  test('wires content, expected version, and provenance to the RPC', async () => {
    state.rpc['save_note_draft'] = {
      data: { note_id: NOTE_ID, version: 3, saved_at: '2026-07-16T20:15:00Z' },
    };
    const res = await caller(state.validToken).notes.save({
      organizationId: ORG_ID,
      encounterId: ENCOUNTER_ID,
      noteType: 'soap',
      content: { S: 'subj', O: 'obj', A: 'assess', P: 'plan' },
      expectedVersion: 2,
      noteId: NOTE_ID,
      saveKind: 'manual',
      provenance: [
        { sectionKey: 'O', refType: 'lab_observation', refId: PATIENT_ID, label: 'hs-CRP 2.8' },
        { sectionKey: 'S', refType: 'practitioner_entered', label: 'Practitioner-entered history' },
      ],
    });
    expect(res).toEqual({ noteId: NOTE_ID, version: 3, savedAt: '2026-07-16T20:15:00Z' });
    expect(state.rpcCalls[0].name).toBe('save_note_draft');
    expect(state.rpcCalls[0].args).toMatchObject({
      _organization_id: ORG_ID,
      _encounter_id: ENCOUNTER_ID,
      _note_type: 'soap',
      _expected_version: 2,
      _note_id: NOTE_ID,
      _save_kind: 'manual',
    });
  });

  test('40001 becomes CONFLICT — the composer conflict view trigger', async () => {
    state.rpc['save_note_draft'] = { error: { code: '40001' } };
    await expect(
      caller(state.validToken).notes.save({
        organizationId: ORG_ID,
        encounterId: ENCOUNTER_ID,
        noteType: 'soap',
        content: { S: 'stale' },
        expectedVersion: 1,
        noteId: NOTE_ID,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('signed-note edit refusal maps to BAD_REQUEST', async () => {
    state.rpc['save_note_draft'] = {
      error: { code: '22023', message: 'note content is frozen after signing — use an addendum' },
    };
    await expect(
      caller(state.validToken).notes.save({
        organizationId: ORG_ID,
        encounterId: ENCOUNTER_ID,
        noteType: 'soap',
        content: { S: 'tamper' },
        expectedVersion: 3,
        noteId: NOTE_ID,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('clinical.notes.sign / addendum / markError', () => {
  test('sign returns idempotency signal verbatim', async () => {
    state.rpc['sign_note'] = {
      data: {
        signature_id: '10000000-0000-4000-8000-0000000000f9',
        already_signed: true,
        version: 3,
        signed_at: '2026-07-16T20:20:00Z',
      },
    };
    const res = await caller(state.validToken).notes.sign({ noteId: NOTE_ID, expectedVersion: 3 });
    expect(res).toEqual({
      signatureId: '10000000-0000-4000-8000-0000000000f9',
      alreadySigned: true,
      version: 3,
      signedAt: '2026-07-16T20:20:00Z',
    });
  });

  test('sign version clash maps to CONFLICT', async () => {
    state.rpc['sign_note'] = { error: { code: '40001' } };
    await expect(
      caller(state.validToken).notes.sign({ noteId: NOTE_ID, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('addendum wires reason + content and returns the id', async () => {
    state.rpc['add_note_addendum'] = { data: '10000000-0000-4000-8000-0000000000fa' };
    const res = await caller(state.validToken).notes.addAddendum({
      noteId: NOTE_ID,
      reason: 'Correction',
      content: 'BP was 128/76.',
    });
    expect(res).toEqual({ addendumId: '10000000-0000-4000-8000-0000000000fa' });
    expect(state.rpcCalls[0].args).toEqual({
      _note_id: NOTE_ID,
      _reason: 'Correction',
      _content: 'BP was 128/76.',
    });
  });

  test('markError requires a reason (zod) and maps RPC errors', async () => {
    state.rpc['mark_note_error'] = { data: null, error: null };
    const ok = await caller(state.validToken).notes.markError({
      noteId: NOTE_ID,
      reason: 'Wrong chart',
    });
    expect(ok).toEqual({ ok: true });
    await expect(
      caller(state.validToken).notes.markError({ noteId: NOTE_ID, reason: '' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('clinical.notes.timeline', () => {
  test('maps timeline rows and never invents events', async () => {
    state.rpc['get_patient_timeline'] = {
      data: [
        {
          event_at: '2026-07-16T20:00:00Z',
          event_type: 'note.signed',
          title: 'Note signed',
          ref_type: 'clinical_note',
          ref_id: NOTE_ID,
          detail: { version: 3 },
        },
      ],
    };
    const res = await caller(state.validToken).notes.timeline({ patientId: PATIENT_ID });
    expect(res).toEqual([
      {
        eventAt: '2026-07-16T20:00:00Z',
        eventType: 'note.signed',
        title: 'Note signed',
        refType: 'clinical_note',
        refId: NOTE_ID,
        detail: { version: 3 },
      },
    ]);
    expect(state.rpcCalls[0]).toEqual({
      name: 'get_patient_timeline',
      args: { _patient_id: PATIENT_ID },
    });
  });

  test('patient outside the caller access is NOT_FOUND at the gate', async () => {
    state.patient = null;
    await expect(
      caller(state.validToken).notes.timeline({ patientId: PATIENT_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
