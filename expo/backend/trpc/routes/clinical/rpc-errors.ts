import { TRPCError } from '@trpc/server';

/**
 * Translate errors raised by the clinical project's SECURITY DEFINER RPCs
 * (AI_DESKTOP_PRO migrations 0013/0014) into typed tRPC errors. The RPCs
 * signal authorization decisions with SQLSTATEs:
 *   28000 authentication required   → UNAUTHORIZED
 *   42501 not authorized            → FORBIDDEN
 *   P0002 record not found          → NOT_FOUND
 *   22023 invalid argument          → BAD_REQUEST
 *   40001 optimistic version clash  → CONFLICT (the composer's conflict view)
 *   55000 precondition not met      → PRECONDITION_FAILED (consent/enablement/tokens/legal hold)
 *   40003 invalid state transition  → CONFLICT (recording state machine, 0022)
 * Messages stay generic — RPC error text never carries PHI, but we don't
 * forward it verbatim either.
 */
export function throwFromRpcError(error: { code?: string | null } | null, label: string): never {
  const code = error?.code ?? '';
  switch (code) {
    case '28000':
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    case '42501':
      throw new TRPCError({ code: 'FORBIDDEN', message: `Not authorized: ${label}` });
    case 'P0002':
      throw new TRPCError({ code: 'NOT_FOUND', message: `Not found: ${label}` });
    case '22023':
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid input: ${label}` });
    case '40001':
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This record changed in another tab or session. Review the latest version before saving again.',
      });
    case '55000':
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Precondition not met: ${label}` });
    case '40003':
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'That action is not valid for the recording\'s current state.',
      });
    default:
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed: ${label}` });
  }
}
