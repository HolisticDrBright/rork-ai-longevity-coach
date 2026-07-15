import { describe, test, expect } from 'vitest';
import { mockCtx } from './setup';

import { nutritionRouter } from '../backend/trpc/routes/nutrition';
import { createTRPCRouter } from '../backend/trpc/create-context';

// The nutrition router proxies a paid third-party API (Passio) with a server
// key. It was previously `publicProcedure` (an open, unauthenticated proxy);
// it is now `protectedProcedure`. These tests pin that: an unauthenticated
// context must be rejected before any handler work runs.

function caller(ctx: unknown) {
  const router = createTRPCRouter({ nutrition: nutritionRouter });
  return (router.createCaller(ctx as never) as unknown as {
    nutrition: Record<string, (input: Record<string, unknown>) => Promise<unknown>>;
  }).nutrition;
}

const unauthedCtx = { user: null, sessionToken: null, req: new Request('http://localhost') };

describe('nutritionRouter authorization', () => {
  test('searchFoods rejects unauthenticated callers', async () => {
    await expect(caller(unauthedCtx).searchFoods({ query: 'apple' })).rejects.toThrow(
      /unauthor|authentication required/i,
    );
  });

  test('lookupBarcode rejects unauthenticated callers', async () => {
    await expect(caller(unauthedCtx).lookupBarcode({ barcode: '012345678905' })).rejects.toThrow(
      /unauthor|authentication required/i,
    );
  });

  test('analyzePhoto rejects unauthenticated callers', async () => {
    await expect(
      caller(unauthedCtx).analyzePhoto({ photoBase64: 'x', mealType: 'lunch', userId: 'u1' }),
    ).rejects.toThrow(/unauthor|authentication required/i);
  });

  test('an authenticated context passes the auth gate', async () => {
    // With a user present, the protected middleware lets the call through to the
    // handler. We don't assert the Passio result (no network in tests) — only
    // that it does NOT throw an authorization error.
    try {
      await caller(mockCtx).searchFoods({ query: 'apple' });
    } catch (err) {
      expect((err as Error).message).not.toMatch(/unauthor|authentication required/i);
    }
  });
});
