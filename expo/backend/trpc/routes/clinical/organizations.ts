import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { createTRPCRouter } from '../../create-context';
import { adminProcedure, clinicalAuthenticatedProcedure } from '../../clinical-authorization';
import { createClinicalServiceClient } from '../../../clinical-supabase';
import { throwFromRpcError } from './rpc-errors';

/**
 * Organization + membership management (Phase 1).
 *
 * The authority is the database: every mutation goes through a SECURITY
 * DEFINER RPC (migration 0020) that re-checks is_org_admin / owner rules and
 * writes the audit row in the same transaction. The procedures here add
 * typed input validation, wire mapping, and honest error translation.
 *
 * SERVICE-ROLE BOUNDARY: `invite` may touch the auth admin API — creating an
 * auth user and sending the invitation email is impossible under RLS by
 * design. That client is constructed inside the branch that needs it, used
 * for exactly one auth.admin call, and NEVER queries clinical tables — the
 * membership row itself is still written through the caller's RLS-scoped
 * client via the admin-gated RPC.
 */

const ROLE = z.enum(['owner', 'admin', 'practitioner', 'staff', 'member']);

/** Server-owned guard messages (raised by the 0020 RPCs) worth showing verbatim. */
const GUARD_MESSAGES: Record<string, string> = {
  already_a_member: 'That person is already a member of this organization.',
  'cannot remove yourself': 'You cannot remove your own membership.',
  'cannot demote the last owner': 'An organization must keep at least one owner.',
  'cannot remove the last owner': 'An organization must keep at least one owner.',
};

function throwMembershipError(
  error: { code?: string | null; message?: string | null },
  label: string,
): never {
  const msg = error.message ?? '';
  for (const [needle, friendly] of Object.entries(GUARD_MESSAGES)) {
    if (msg.includes(needle)) {
      throw new TRPCError({
        code: needle === 'already_a_member' ? 'CONFLICT' : 'BAD_REQUEST',
        message: friendly,
      });
    }
  }
  throwFromRpcError(error, label);
}

export const clinicalOrganizationsRouter = createTRPCRouter({
  /** Organizations the caller belongs to (own memberships only, via RLS). */
  mine: clinicalAuthenticatedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.clinicalDb
      .from('organization_memberships')
      .select('role, status, organizations ( id, name, slug )')
      .eq('user_id', ctx.clinicalUser.id)
      .eq('status', 'active');
    if (error) throw new Error('Failed to load memberships');
    return (data ?? []).map((m) => {
      const org = m.organizations as unknown as { id: string; name: string; slug: string } | null;
      return {
        organizationId: org?.id ?? null,
        name: org?.name ?? null,
        slug: org?.slug ?? null,
        role: m.role as string,
      };
    });
  }),

  /**
   * Claim pending invitations: the caller's own 'invited' memberships become
   * 'active'. Called once after sign-in; idempotent (0 on re-run).
   */
  claim: clinicalAuthenticatedProcedure.mutation(async ({ ctx }) => {
    const { data, error } = await ctx.clinicalDb.rpc('activate_my_memberships', {});
    if (error) throwFromRpcError(error, 'claim invitations');
    return { activated: (data as number) ?? 0 };
  }),

  /** Roster for admins — the RPC re-checks is_org_admin inside the database. */
  members: adminProcedure.query(async ({ ctx, input }) => {
    const { organizationId } = input as { organizationId: string };
    const { data, error } = await ctx.clinicalDb.rpc('list_org_members', {
      _organization_id: organizationId,
    });
    if (error) throwFromRpcError(error, 'list members');
    const rows = (data ?? []) as {
      membership_id: string;
      user_id: string;
      email: string | null;
      display_name: string | null;
      role: string;
      status: string;
      joined_at: string;
    }[];
    return rows.map((r) => ({
      membershipId: r.membership_id,
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      status: r.status,
      joinedAt: r.joined_at,
    }));
  }),

  /**
   * Invite by email. Existing auth users are linked directly ('invited'
   * membership, activated on their next sign-in). A brand-new email first
   * gets an auth user + invitation email via the auth admin API — see the
   * service-role boundary note above — and requires
   * CLINICAL_SUPABASE_SERVICE_ROLE_KEY; without it the new-user path fails
   * honestly instead of pretending an email was sent.
   */
  invite: adminProcedure
    .input(z.object({ email: z.string().email().max(320), role: ROLE }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, email, role } = input as {
        organizationId: string;
        email: string;
        role: z.infer<typeof ROLE>;
      };
      const addMember = () =>
        ctx.clinicalDb.rpc('add_org_member', {
          _organization_id: organizationId,
          _email: email,
          _role: role,
        });

      let invitedNewUser = false;
      let { data, error } = await addMember();

      if (error && error.code === 'P0002') {
        // No auth account for this email yet.
        if (!process.env.CLINICAL_SUPABASE_SERVICE_ROLE_KEY) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              'No account exists for that email, and email invitations are not configured on this backend. Ask them to create an account first, then add them by email.',
          });
        }
        const service = createClinicalServiceClient();
        const desktopUrl = process.env.CLINICAL_DESKTOP_URL?.replace(/\/+$/, '');
        const invite = await service.auth.admin.inviteUserByEmail(
          email,
          desktopUrl ? { redirectTo: `${desktopUrl}/reset` } : undefined,
        );
        if (invite.error) {
          // A concurrent signup is fine — the account now exists either way.
          const alreadyExists = /already/i.test(invite.error.message ?? '');
          if (!alreadyExists) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Could not send the invitation email. Nothing was added.',
            });
          }
        } else {
          invitedNewUser = true;
        }
        ({ data, error } = await addMember());
      }

      if (error) throwMembershipError(error, 'invite member');
      return { membershipId: data as string, invitedNewUser };
    }),

  /** Change a member's role. Owner/lockout rules enforced inside the RPC. */
  setRole: clinicalAuthenticatedProcedure
    .input(z.object({ membershipId: z.string().uuid(), role: ROLE }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('set_org_member_role', {
        _membership_id: input.membershipId,
        _role: input.role,
      });
      if (error) throwMembershipError(error, 'change member role');
      return { ok: true as const };
    }),

  /** Remove a member. Self/owner/lockout rules enforced inside the RPC. */
  remove: clinicalAuthenticatedProcedure
    .input(z.object({ membershipId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.clinicalDb.rpc('remove_org_member', {
        _membership_id: input.membershipId,
      });
      if (error) throwMembershipError(error, 'remove member');
      return { ok: true as const };
    }),
});
