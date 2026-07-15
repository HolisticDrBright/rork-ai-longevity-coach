import { describe, test, expect } from 'vitest';
import { scrubObject } from '../backend/log-scrub';

describe('log scrubber (PHI-safe logging)', () => {
  test('redacts identity keys at the top level', () => {
    const out = scrubObject({ first_name: 'Alexandra', email: 'a@x.test', status: 'active' });
    expect(out.first_name).toBe('[REDACTED]');
    expect(out.email).toBe('[REDACTED]');
    expect(out.status).toBe('active');
  });

  test('redacts credentials and tokens', () => {
    const out = scrubObject({ authorization: 'Bearer abc', token: 'x', token_hash: 'y' });
    expect(out.authorization).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.token_hash).toBe('[REDACTED]');
  });

  test('redacts clinical values and AI free-text surfaces', () => {
    const out = scrubObject({
      marker_value: 2.8,
      prompt: 'Summarize the patient…',
      draft: 'Subjective: …',
      notes: 'evening wakefulness',
      durationMs: 12,
    });
    expect(out.marker_value).toBe('[REDACTED]');
    expect(out.prompt).toBe('[REDACTED]');
    expect(out.draft).toBe('[REDACTED]');
    expect(out.notes).toBe('[REDACTED]');
    expect(out.durationMs).toBe(12);
  });

  test('recurses into nested objects and arrays', () => {
    const out = scrubObject({
      request: { body: { name: 'X' }, path: '/api/trpc' },
      rows: [{ mrn: 'P-1', id: 'row-1' }],
    }) as { request: Record<string, unknown>; rows: Record<string, unknown>[] };
    expect(out.request.body).toBe('[REDACTED]');
    expect(out.request.path).toBe('/api/trpc');
    expect(out.rows[0].mrn).toBe('[REDACTED]');
    expect(out.rows[0].id).toBe('row-1');
  });

  test('leaves operational metadata intact', () => {
    const out = scrubObject({ operationId: 'op-1', httpMethod: 'POST', httpStatus: '500' });
    expect(out).toEqual({ operationId: 'op-1', httpMethod: 'POST', httpStatus: '500' });
  });
});
