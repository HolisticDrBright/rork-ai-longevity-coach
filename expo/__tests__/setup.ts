import { vi } from 'vitest';

export const mockFrom = vi.fn();

vi.mock('../backend/supabase-server', () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
  createAnonSupabaseClient: () => ({}),
}));

export function createChainableMock(resolvedValue: {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}) {
  const chain: Record<string, unknown> = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
    'in', 'not', 'or', 'and',
    'order', 'limit', 'range',
    'is', 'ilike',
  ];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.single = vi.fn(() =>
    Promise.resolve({
      data: Array.isArray(resolvedValue.data)
        ? resolvedValue.data[0]
        : resolvedValue.data,
      error: resolvedValue.error ?? null,
    })
  );
  chain.then = (
    _resolve: (v: unknown) => void,
    _reject?: (e: unknown) => void
  ) => {
    return Promise.resolve({
      data: Array.isArray(resolvedValue.data)
        ? resolvedValue.data
        : resolvedValue.data
          ? [resolvedValue.data]
          : [],
      error: resolvedValue.error ?? null,
      count: resolvedValue.count ?? null,
    }).then(_resolve, _reject);
  };
  return chain;
}

export function setupMockFrom(
  tableMap: Record<string, ReturnType<typeof createChainableMock>>
) {
  mockFrom.mockImplementation((table: string) => {
    return tableMap[table] ?? createChainableMock({ data: [] });
  });
}

export const MOCK_USER = {
  id: 'clinician-001',
  email: 'doc@clinic.test',
  role: 'authenticated',
} as const;

export const mockCtx = {
  user: MOCK_USER,
  sessionToken: 'mock-jwt-token',
  req: new Request('http://localhost'),
};
