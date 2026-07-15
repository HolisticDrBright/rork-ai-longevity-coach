import { describe, test, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for the clinical-pool procedure helpers (server-layer slice,
 * Item 3): each guard must allow the authorized case and deny the
 * unauthorized one with the right error. The clinical Supabase clients are
 * mocked; RLS behavior is represented by what the mocked user-scoped client
 * returns (row vs null), mirroring how the real gate manifests. The RLS gates
 * themselves are proven separately against the live project by
 * AI_DESKTOP_PRO/supabase/tests/practitioner_assignment_access.sql.
 */

const state = vi.hoisted(() => ({
  validToken: 'valid-clinical-token',
  user: { id: '10000000-0000-4000-8000-0000000000b1', email: 'practitioner@example.test' },
  membership: null as { role: string; status: string } | null,
  patient: null as { id: string; organization_id: string } | null,
}));

vi.mock('../backend/clinical-supabase', () => {
  function chain(result: () => unknown) {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'order', 'limit']) {
      c[m] = () => c;
    }
    c.maybeSingle = async () => ({ data: result(), error: null });
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
      from: (table: string) => {
        if (table === 'organization_memberships') return chain(() => state.membership);
        if (table === 'patient_profiles') return chain(() => state.patient);
        return chain(() => null);
      },
    }),
    createClinicalServiceClient: () => {
      throw new Error('service client must not be used by procedure guards');
    },
  };
});

import { createTRPCRouter } from '../backend/trpc/create-context';
import {
  clinicalAuthenticatedProcedure,
  organizationProcedure,
  practitionerProcedure,
  adminProcedure,
  patientAccessProcedure,
} from '../backend/trpc/clinical-authorization';

const ORG_ID = '10000000-0000-4000-8000-0000000000d1';
const PATIENT_ID = '10000000-0000-4000-8000-0000000000e1';

const testRouter = createTRPCRouter({
  me: clinicalAuthenticatedProcedure.query(({ ctx }) => ctx.clinicalUser.id),
  org: organizationProcedure.query(({ ctx }) => ctx.membership.role),
  practitionerOnly: practitionerProcedure.query(() => 'ok'),
  adminOnly: adminProcedure.query(() => 'ok'),
  patient: patientAccessProcedure.query(({ ctx }) => ctx.patient.organizationId),
});

function caller(sessionToken: string | null) {
  return testRouter.createCaller({
    req: new Request('http://localhost'),
    sessionToken,
    user: null,
  } as never);
}

beforeEach(() => {
  state.membership = null;
  state.patient = null;
});

describe('clinicalAuthenticatedProcedure', () => {
  test('denies a missing token', async () => {
    await expect(caller(null).me()).rejects.toThrow(/authentication required/i);
  });

  test('denies an invalid token', async () => {
    await expect(caller('forged-token').me()).rejects.toThrow(/authentication required/i);
  });

  test('allows a valid clinical-pool token and derives identity server-side', async () => {
    await expect(caller(state.validToken).me()).resolves.toBe(state.user.id);
  });
});

describe('organizationProcedure', () => {
  test('denies a valid user who is not an active member of the target org', async () => {
    state.membership = null;
    await expect(caller(state.validToken).org({ organizationId: ORG_ID })).rejects.toThrow(
      /not a member/i,
    );
  });

  test('allows an active member and exposes the server-derived role', async () => {
    state.membership = { role: 'staff', status: 'active' };
    await expect(caller(state.validToken).org({ organizationId: ORG_ID })).resolves.toBe('staff');
  });

  test('rejects a malformed organizationId before any query runs', async () => {
    await expect(
      caller(state.validToken).org({ organizationId: 'not-a-uuid' }),
    ).rejects.toThrow();
  });
});

describe('practitionerProcedure', () => {
  test('denies staff', async () => {
    state.membership = { role: 'staff', status: 'active' };
    await expect(
      caller(state.validToken).practitionerOnly({ organizationId: ORG_ID }),
    ).rejects.toThrow(/practitioner role required/i);
  });

  test('allows practitioner', async () => {
    state.membership = { role: 'practitioner', status: 'active' };
    await expect(
      caller(state.validToken).practitionerOnly({ organizationId: ORG_ID }),
    ).resolves.toBe('ok');
  });

  test('allows owner', async () => {
    state.membership = { role: 'owner', status: 'active' };
    await expect(
      caller(state.validToken).practitionerOnly({ organizationId: ORG_ID }),
    ).resolves.toBe('ok');
  });
});

describe('adminProcedure', () => {
  test('denies practitioner', async () => {
    state.membership = { role: 'practitioner', status: 'active' };
    await expect(caller(state.validToken).adminOnly({ organizationId: ORG_ID })).rejects.toThrow(
      /administrator role required/i,
    );
  });

  test('allows admin', async () => {
    state.membership = { role: 'admin', status: 'active' };
    await expect(caller(state.validToken).adminOnly({ organizationId: ORG_ID })).resolves.toBe(
      'ok',
    );
  });
});

describe('patientAccessProcedure', () => {
  test('denies (as NOT_FOUND) when the RLS gate returns no row', async () => {
    state.patient = null;
    await expect(caller(state.validToken).patient({ patientId: PATIENT_ID })).rejects.toThrow(
      /patient not found or access denied/i,
    );
  });

  test('allows when the RLS gate returns the patient row', async () => {
    state.patient = { id: PATIENT_ID, organization_id: ORG_ID };
    await expect(caller(state.validToken).patient({ patientId: PATIENT_ID })).resolves.toBe(
      ORG_ID,
    );
  });

  test('still requires authentication first', async () => {
    state.patient = { id: PATIENT_ID, organization_id: ORG_ID };
    await expect(caller(null).patient({ patientId: PATIENT_ID })).rejects.toThrow(
      /authentication required/i,
    );
  });
});
