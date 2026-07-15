import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  generateStructured,
  getServerAiConfig,
} from '../../backend/services/ai/aiClient';

function makeSbMock() {
  const inserted: Record<string, unknown>[] = [];
  const sb = {
    from: vi.fn(() => ({
      insert: vi.fn((row: Record<string, unknown>) => {
        inserted.push(row);
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { id: 'op-1' }, error: null })),
          })),
        };
      }),
    })),
  };
  return { sb: sb as never, inserted };
}

const testSchema = z.object({ answer: z.string(), confidence: z.number() });

const config = {
  apiKey: 'test-key',
  baseUrl: 'https://ai.example.com/v1',
  model: 'test-model',
  timeoutMs: 5000,
};

function fetchResponding(bodies: string[]): typeof fetch {
  let call = 0;
  return vi.fn(async () => {
    const content = bodies[Math.min(call, bodies.length - 1)];
    call += 1;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    } as Response;
  }) as unknown as typeof fetch;
}

describe('getServerAiConfig', () => {
  const oldEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...oldEnv };
  });

  test('returns null without an API key (AI features stay off)', () => {
    delete process.env.AI_PROVIDER_API_KEY;
    expect(getServerAiConfig()).toBeNull();
  });

  test('reads config with defaults', () => {
    process.env.AI_PROVIDER_API_KEY = 'k';
    delete process.env.AI_PROVIDER_BASE_URL;
    delete process.env.AI_MODEL;
    const cfg = getServerAiConfig();
    expect(cfg).toMatchObject({
      apiKey: 'k',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1',
    });
  });

  test('strips trailing slash from base URL', () => {
    process.env.AI_PROVIDER_API_KEY = 'k';
    process.env.AI_PROVIDER_BASE_URL = 'https://gw.example.com/v1/';
    expect(getServerAiConfig()?.baseUrl).toBe('https://gw.example.com/v1');
  });
});

describe('generateStructured', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const log = (sb: never) => ({
    sb,
    userId: 'user-1',
    initiatedBy: 'user-1',
    operation: 'test.op',
    promptTemplate: 'test-template',
    promptVersion: '1.0.0',
    clinical: true,
  });

  test('valid JSON on the first attempt passes and is logged', async () => {
    const { sb, inserted } = makeSbMock();
    vi.stubGlobal('fetch', fetchResponding(['{"answer":"ok","confidence":0.8}']));

    const result = await generateStructured({
      config,
      log: log(sb),
      schema: testSchema,
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.answer).toBe('ok');
      expect(result.retries).toBe(0);
    }
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      operation: 'test.op',
      validation_status: 'passed',
      review_status: 'pending_review',
      model: 'test-model',
    });
  });

  test('invalid first response triggers one corrective retry', async () => {
    const { sb, inserted } = makeSbMock();
    const fetchMock = fetchResponding([
      '{"answer": 42}',
      '{"answer":"fixed","confidence":0.5}',
    ]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateStructured({
      config,
      log: log(sb),
      schema: testSchema,
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.retries).toBe(1);
    expect((fetchMock as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(2);
    // Retry message includes validation feedback
    const secondBody = JSON.parse(
      ((fetchMock as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[1][1]).body
    );
    expect(JSON.stringify(secondBody.messages)).toContain('invalid JSON');
    expect(inserted[0].validation_status).toBe('passed');
  });

  test('two invalid responses fail closed with a failure log', async () => {
    const { sb, inserted } = makeSbMock();
    vi.stubGlobal('fetch', fetchResponding(['not json at all']));

    const result = await generateStructured({
      config,
      log: log(sb),
      schema: testSchema,
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.ok).toBe(false);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ validation_status: 'failed', retry_count: 1 });
    expect(inserted[0].error).toBeTruthy();
  });

  test('provider HTTP errors are captured, not thrown', async () => {
    const { sb, inserted } = makeSbMock();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }) as unknown as Response)
    );

    const result = await generateStructured({
      config,
      log: log(sb),
      schema: testSchema,
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('500');
    expect(inserted[0].validation_status).toBe('failed');
  });
});
