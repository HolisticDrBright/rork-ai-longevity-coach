import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * clinical.schedule procedure tests — auth gating, zod input boundary, exact
 * RPC argument shapes (the 0017 functions are proven against the live project
 * by AI_DESKTOP_PRO/supabase/tests/scheduling.sql), snake→camel wire mapping,
 * and RPC error translation.
 */

const state = vi.hoisted(() => ({
  validToken: 'valid-clinical-token',
  user: { id: '10000000-0000-4000-8000-0000000000b1', email: 'practitioner@example.test' },
  membership: null as { role: string; status: string } | null,
  tables: {} as Record<string, unknown[]>,
  rpc: {} as Record<string, { data?: unknown; error?: { code: string } }>,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
}));

vi.mock('../backend/clinical-supabase', () => {
  function chain(table: string) {
    const rows = () => state.tables[table] ?? [];
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'is', 'gte', 'lt', 'order', 'limit']) c[m] = () => c;
    c.maybeSingle = async () => {
      if (table === 'organization_memberships') return { data: state.membership, error: null };
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

const ORG_ID = '10000000-0000-4000-8000-0000000000d1';
const PATIENT_ID = '10000000-0000-4000-8000-0000000000e1';
const APPT_ID = '10000000-0000-4000-8000-0000000000a7';
const PRACTITIONER_ID = '10000000-0000-4000-8000-0000000000b1';

function caller(sessionToken: string | null) {
  return clinicalRouter.createCaller({
    req: new Request('http://localhost'),
    sessionToken,
    user: null,
  } as never);
}

beforeEach(() => {
  state.membership = { role: 'practitioner', status: 'active' };
  state.tables = {};
  state.rpc = {};
  state.rpcCalls = [];
});

describe('clinical.schedule.getCalendar', () => {
  const RANGE = {
    organizationId: ORG_ID,
    fromIso: '2026-07-13T00:00:00+00:00',
    toIso: '2026-07-20T00:00:00+00:00',
  };

  test('requires a valid session', async () => {
    await expect(caller(null).schedule.getCalendar(RANGE)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  test('requires active org membership', async () => {
    state.membership = null;
    await expect(caller(state.validToken).schedule.getCalendar(RANGE)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  test('maps appointment rows + practitioner names to the wire shape', async () => {
    state.tables['appointments'] = [
      {
        id: APPT_ID,
        patient_id: PATIENT_ID,
        practitioner_user_id: PRACTITIONER_ID,
        title: null,
        appointment_type: 'follow-up',
        location: 'Room 1',
        telehealth_url: null,
        status: 'confirmed',
        starts_at: '2026-07-15T15:00:00+00:00',
        ends_at: '2026-07-15T15:45:00+00:00',
        patient_profiles: { first_name: 'Avery', last_name: 'Demo' },
      },
      {
        id: '10000000-0000-4000-8000-0000000000a8',
        patient_id: null,
        practitioner_user_id: PRACTITIONER_ID,
        title: 'Admin block',
        appointment_type: 'break',
        location: 'Admin',
        telehealth_url: null,
        status: 'scheduled',
        starts_at: '2026-07-15T12:00:00+00:00',
        ends_at: '2026-07-15T13:00:00+00:00',
        patient_profiles: null,
      },
    ];
    state.tables['practitioner_profiles'] = [
      { user_id: PRACTITIONER_ID, display_name: 'Dr. Demo', credentials: 'ND', specialty: 'Longevity' },
    ];

    const cal = await caller(state.validToken).schedule.getCalendar(RANGE);
    expect(cal.appointments).toHaveLength(2);
    expect(cal.appointments[0]).toEqual({
      id: APPT_ID,
      patientId: PATIENT_ID,
      patientName: 'Avery Demo',
      practitionerUserId: PRACTITIONER_ID,
      practitionerName: 'Dr. Demo',
      title: null,
      appointmentType: 'follow-up',
      location: 'Room 1',
      telehealthUrl: null,
      status: 'confirmed',
      startsAt: '2026-07-15T15:00:00+00:00',
      endsAt: '2026-07-15T15:45:00+00:00',
    });
    // Patient-NULL rows (breaks) carry no patient name — never invented.
    expect(cal.appointments[1].patientName).toBeNull();
    expect(cal.practitioners).toEqual([
      { userId: PRACTITIONER_ID, displayName: 'Dr. Demo', credentials: 'ND', specialty: 'Longevity' },
    ]);
  });

  test('rejects a malformed range at the zod boundary', async () => {
    await expect(
      caller(state.validToken).schedule.getCalendar({
        organizationId: ORG_ID,
        fromIso: 'not-a-date',
        toIso: '2026-07-20T00:00:00+00:00',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('clinical.schedule.book', () => {
  const BOOKING = {
    organizationId: ORG_ID,
    practitionerUserId: PRACTITIONER_ID,
    appointmentType: 'follow-up' as const,
    startsAtIso: '2026-07-15T15:00:00+00:00',
    endsAtIso: '2026-07-15T15:45:00+00:00',
    patientId: PATIENT_ID,
    location: 'Room 1',
  };

  test('invalid appointment type never reaches the database', async () => {
    await expect(
      caller(state.validToken).schedule.book({
        ...BOOKING,
        appointmentType: 'surgery' as never,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(state.rpcCalls).toHaveLength(0);
  });

  test('calls book_appointment with exact RPC args and maps the result', async () => {
    state.rpc['book_appointment'] = {
      data: {
        id: APPT_ID,
        status: 'scheduled',
        starts_at: '2026-07-15T15:00:00+00:00',
        ends_at: '2026-07-15T15:45:00+00:00',
      },
    };
    const r = await caller(state.validToken).schedule.book(BOOKING);
    expect(state.rpcCalls[0].name).toBe('book_appointment');
    expect(state.rpcCalls[0].args).toEqual({
      _organization_id: ORG_ID,
      _practitioner_user_id: PRACTITIONER_ID,
      _appointment_type: 'follow-up',
      _starts_at: '2026-07-15T15:00:00+00:00',
      _ends_at: '2026-07-15T15:45:00+00:00',
      _patient_id: PATIENT_ID,
      _location: 'Room 1',
      _telehealth_url: null,
      _title: null,
    });
    expect(r).toEqual({
      ok: true,
      id: APPT_ID,
      status: 'scheduled',
      startsAt: '2026-07-15T15:00:00+00:00',
      endsAt: '2026-07-15T15:45:00+00:00',
      message: 'Appointment booked.',
    });
  });

  test('double-booking (22023) surfaces as BAD_REQUEST', async () => {
    state.rpc['book_appointment'] = { error: { code: '22023' } };
    await expect(caller(state.validToken).schedule.book(BOOKING)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('clinical.schedule.updateStatus', () => {
  test('maps the transition result and translates authorization errors', async () => {
    state.rpc['update_appointment_status'] = {
      data: { id: APPT_ID, status: 'arrived', previous_status: 'confirmed', already_set: false },
    };
    const r = await caller(state.validToken).schedule.updateStatus({
      appointmentId: APPT_ID,
      status: 'arrived',
    });
    expect(r).toEqual({
      ok: true,
      id: APPT_ID,
      status: 'arrived',
      previousStatus: 'confirmed',
      alreadySet: false,
      message: 'Appointment arrived.',
    });

    state.rpc['update_appointment_status'] = { error: { code: '42501' } };
    await expect(
      caller(state.validToken).schedule.updateStatus({ appointmentId: APPT_ID, status: 'arrived' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('rejects a status outside the transition vocabulary at the boundary', async () => {
    await expect(
      caller(state.validToken).schedule.updateStatus({
        appointmentId: APPT_ID,
        status: 'scheduled' as never,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(state.rpcCalls).toHaveLength(0);
  });
});

describe('clinical.schedule.reschedule', () => {
  test('missing appointment (P0002) surfaces as NOT_FOUND; happy path maps', async () => {
    state.rpc['reschedule_appointment'] = { error: { code: 'P0002' } };
    await expect(
      caller(state.validToken).schedule.reschedule({
        appointmentId: APPT_ID,
        startsAtIso: '2026-07-15T16:00:00+00:00',
        endsAtIso: '2026-07-15T16:30:00+00:00',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    state.rpc['reschedule_appointment'] = {
      data: {
        id: APPT_ID,
        status: 'scheduled',
        starts_at: '2026-07-15T16:00:00+00:00',
        ends_at: '2026-07-15T16:30:00+00:00',
      },
    };
    const r = await caller(state.validToken).schedule.reschedule({
      appointmentId: APPT_ID,
      startsAtIso: '2026-07-15T16:00:00+00:00',
      endsAtIso: '2026-07-15T16:30:00+00:00',
    });
    expect(r).toEqual({
      ok: true,
      id: APPT_ID,
      status: 'scheduled',
      startsAt: '2026-07-15T16:00:00+00:00',
      endsAt: '2026-07-15T16:30:00+00:00',
      message: 'Appointment rescheduled.',
    });
  });
});
