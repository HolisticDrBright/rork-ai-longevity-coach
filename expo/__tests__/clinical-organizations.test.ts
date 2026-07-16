import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * clinical.organizations.* procedure tests (Phase 1 membership management).
 *
 * The membership rules themselves (admin gating, owner/lockout guards, audit
 * rows) are proven against the live project by
 * AI_DESKTOP_PRO/supabase/tests/org_membership.sql. These tests cover the
 * procedure layer: auth + admin gating, wire mapping, the honest
 * no-service-key failure, the two-step invite for brand-new emails, and the
 * service-role boundary (the service client is reachable ONLY from the
 * invite new-user branch — everything else throws if it touches it).
 */

const state = vi.hoisted(() => ({
  validToken: 'valid-clinical-token',
  user: { id: '10000000-0000-4000-8000-0000000000a1', email: 'admin@example.test' },
  membership: null as { role: string; status: string } | null,
  rpc: {} as Record<string, { data?: unknown; error?: { code: string; message?: string } | null }>,
  rpcSeq: {} as Record<string, { data?: unknown; error?: { code: string; message?: string } | null }[]>,
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  serviceAdmin: null as
    | ((email: string, opts?: { redirectTo?: string }) => Promise<{ data: unknown; error: { message: string } | null }>)
    | null,
  inviteCalls: [] as { email: string; opts?: { redirectTo?: string } }[],
}));

vi.mock('../backend/clinical-supabase', () => {
  function chain(table: string) {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'is', 'order', 'limit']) c[m] = () => c;
    c.maybeSingle = async () => {
      if (table === 'organization_memberships') return { data: state.membership, error: null };
      return { data: null, error: null };
    };
    c.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
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
        const seq = state.rpcSeq[name];
        if (seq && seq.length > 0) {
          const next = seq.shift()!;
          return { data: next.data ?? null, error: next.error ?? null };
        }
        const r = state.rpc[name];
        if (!r) return { data: null, error: { code: 'XXXXX', message: 'no mock' } };
        return { data: r.data ?? null, error: r.error ?? null };
      },
    }),
    createClinicalServiceClient: () => {
      if (!state.serviceAdmin) {
        throw new Error('service client must not be used by clinical procedures');
      }
      return {
        auth: {
          admin: {
            inviteUserByEmail: async (email: string, opts?: { redirectTo?: string }) => {
              state.inviteCalls.push({ email, opts });
              return state.serviceAdmin!(email, opts);
            },
          },
        },
      };
    },
  };
});

import { clinicalRouter } from '../backend/trpc/routes/clinical';

const ORG_ID = '10000000-0000-4000-8000-0000000000d1';
const MEMBERSHIP_ID = '10000000-0000-4000-8000-0000000000c1';

function caller(sessionToken: string | null) {
  return clinicalRouter.createCaller({
    req: new Request('http://localhost'),
    sessionToken,
    user: null,
  } as never);
}

beforeEach(() => {
  state.membership = { role: 'admin', status: 'active' };
  state.rpc = {};
  state.rpcSeq = {};
  state.rpcCalls = [];
  state.serviceAdmin = null;
  state.inviteCalls = [];
  delete process.env.CLINICAL_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.CLINICAL_DESKTOP_URL;
});

afterEach(() => {
  delete process.env.CLINICAL_SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.CLINICAL_DESKTOP_URL;
});

describe('clinical.organizations.members', () => {
  test('maps the RPC roster to the wire shape', async () => {
    state.rpc['list_org_members'] = {
      data: [
        {
          membership_id: MEMBERSHIP_ID,
          user_id: '10000000-0000-4000-8000-0000000000a2',
          email: 'colleague@example.test',
          display_name: 'Dr. Colleague',
          role: 'practitioner',
          status: 'invited',
          joined_at: '2026-07-16T00:00:00Z',
        },
      ],
    };
    const rows = await caller(state.validToken).organizations.members({ organizationId: ORG_ID });
    expect(rows).toEqual([
      {
        membershipId: MEMBERSHIP_ID,
        userId: '10000000-0000-4000-8000-0000000000a2',
        email: 'colleague@example.test',
        displayName: 'Dr. Colleague',
        role: 'practitioner',
        status: 'invited',
        joinedAt: '2026-07-16T00:00:00Z',
      },
    ]);
    expect(state.rpcCalls[0]).toEqual({
      name: 'list_org_members',
      args: { _organization_id: ORG_ID },
    });
  });

  test('non-admin membership is refused by the procedure gate', async () => {
    state.membership = { role: 'practitioner', status: 'active' };
    await expect(
      caller(state.validToken).organizations.members({ organizationId: ORG_ID }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('requires authentication', async () => {
    await expect(
      caller('wrong-token').organizations.members({ organizationId: ORG_ID }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('clinical.organizations.invite', () => {
  test('existing auth user: single RPC call, no service client, invitedNewUser=false', async () => {
    state.rpc['add_org_member'] = { data: MEMBERSHIP_ID };
    const res = await caller(state.validToken).organizations.invite({
      organizationId: ORG_ID,
      email: 'colleague@example.test',
      role: 'practitioner',
    });
    expect(res).toEqual({ membershipId: MEMBERSHIP_ID, invitedNewUser: false });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.inviteCalls).toHaveLength(0);
  });

  test('brand-new email without a service key fails honestly (no fake email)', async () => {
    state.rpc['add_org_member'] = { error: { code: 'P0002', message: 'no_such_user' } };
    await expect(
      caller(state.validToken).organizations.invite({
        organizationId: ORG_ID,
        email: 'newperson@example.test',
        role: 'staff',
      }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('not configured'),
    });
    expect(state.inviteCalls).toHaveLength(0);
  });

  test('brand-new email with a service key: auth invite then membership RPC', async () => {
    process.env.CLINICAL_SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    process.env.CLINICAL_DESKTOP_URL = 'https://desktop.example.test/';
    state.rpcSeq['add_org_member'] = [
      { error: { code: 'P0002', message: 'no_such_user' } },
      { data: MEMBERSHIP_ID },
    ];
    state.serviceAdmin = async () => ({ data: { user: { id: 'new-user' } }, error: null });

    const res = await caller(state.validToken).organizations.invite({
      organizationId: ORG_ID,
      email: 'newperson@example.test',
      role: 'staff',
    });
    expect(res).toEqual({ membershipId: MEMBERSHIP_ID, invitedNewUser: true });
    expect(state.inviteCalls).toEqual([
      {
        email: 'newperson@example.test',
        opts: { redirectTo: 'https://desktop.example.test/reset' },
      },
    ]);
    expect(state.rpcCalls.filter((c) => c.name === 'add_org_member')).toHaveLength(2);
  });

  test('duplicate membership maps to CONFLICT with honest copy', async () => {
    state.rpc['add_org_member'] = { error: { code: '22023', message: 'already_a_member' } };
    await expect(
      caller(state.validToken).organizations.invite({
        organizationId: ORG_ID,
        email: 'colleague@example.test',
        role: 'member',
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('already a member'),
    });
  });

  test('non-admin cannot invite', async () => {
    state.membership = { role: 'staff', status: 'active' };
    await expect(
      caller(state.validToken).organizations.invite({
        organizationId: ORG_ID,
        email: 'colleague@example.test',
        role: 'member',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(state.rpcCalls).toHaveLength(0);
  });
});

describe('clinical.organizations.setRole / remove', () => {
  test('setRole passes through and returns ok', async () => {
    state.rpc['set_org_member_role'] = { data: null, error: null };
    const res = await caller(state.validToken).organizations.setRole({
      membershipId: MEMBERSHIP_ID,
      role: 'staff',
    });
    expect(res).toEqual({ ok: true });
    expect(state.rpcCalls[0]).toEqual({
      name: 'set_org_member_role',
      args: { _membership_id: MEMBERSHIP_ID, _role: 'staff' },
    });
  });

  test('last-owner guard surfaces as BAD_REQUEST with the lockout explanation', async () => {
    state.rpc['set_org_member_role'] = {
      error: { code: '22023', message: 'cannot demote the last owner' },
    };
    await expect(
      caller(state.validToken).organizations.setRole({
        membershipId: MEMBERSHIP_ID,
        role: 'member',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('at least one owner'),
    });
  });

  test('self-removal guard surfaces honestly', async () => {
    state.rpc['remove_org_member'] = {
      error: { code: '22023', message: 'cannot remove yourself' },
    };
    await expect(
      caller(state.validToken).organizations.remove({ membershipId: MEMBERSHIP_ID }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('your own membership'),
    });
  });

  test('remove returns ok on success', async () => {
    state.rpc['remove_org_member'] = { data: null, error: null };
    const res = await caller(state.validToken).organizations.remove({
      membershipId: MEMBERSHIP_ID,
    });
    expect(res).toEqual({ ok: true });
  });

  test('admin gate lives in the database for setRole (forbidden maps through)', async () => {
    state.rpc['set_org_member_role'] = {
      error: { code: '42501', message: 'organization admin required' },
    };
    await expect(
      caller(state.validToken).organizations.setRole({
        membershipId: MEMBERSHIP_ID,
        role: 'staff',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('clinical.organizations.claim', () => {
  test('returns the activation count', async () => {
    state.rpc['activate_my_memberships'] = { data: 2 };
    const res = await caller(state.validToken).organizations.claim();
    expect(res).toEqual({ activated: 2 });
  });

  test('idempotent zero is honest', async () => {
    state.rpc['activate_my_memberships'] = { data: 0 };
    const res = await caller(state.validToken).organizations.claim();
    expect(res).toEqual({ activated: 0 });
  });
});
