import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Scribe security + worker units (Milestone 1 backend).
 *
 * The database contracts (consent gates, bound tokens, state machine, durable
 * deletion) are proven against the live project by
 * AI_DESKTOP_PRO/supabase/tests/scribe_recording.sql. These tests cover the
 * backend layer around them:
 *   - strict mode/provider resolution (fixture never serves live mode)
 *   - the disabled production adapter
 *   - signed callback verification: tamper, wrong secret, stale timestamp
 *   - replay dedupe and out-of-order deferral (provider redelivery)
 *   - audio container sniffing + staged-store size caps + digest recompute
 *   - deletion worker: local + provider targets, retry, dead-letter
 *   - no-PHI logging: transcript text never reaches log output
 */

import {
  scribeMode,
  resolveProvider,
  healthScribeConfig,
  callbackSecret,
  ScribeConfigError,
} from '../backend/scribe/config';
import {
  signCallbackBody,
  verifyCallbackSignature,
  parseEnvelope,
  processProviderCallback,
  type CallbackEnvelope,
} from '../backend/scribe/callback';
import { FixtureAudioStore, sniffAudioContainer } from '../backend/scribe/store';
import {
  FixtureScribeProvider,
  HealthScribeProvider,
  ProviderDisabledError,
  fixtureSegments,
} from '../backend/scribe/providers';
import { runDeletionWorkerOnce, runTranscriptionWorkerOnce } from '../backend/scribe/workers';

const SECRET = 'test-secret-0123456789abcdef';
const REC_ID = '20000000-0000-4000-8000-0000000000aa';
const JOB_ID = '20000000-0000-4000-8000-0000000000bb';

beforeEach(() => {
  process.env.SCRIBE_MODE = 'fixture';
  process.env.SCRIBE_CALLBACK_SECRET = SECRET;
  delete process.env.HEALTHSCRIBE_REGION;
  delete process.env.HEALTHSCRIBE_KMS_KEY_ARN;
  delete process.env.HEALTHSCRIBE_DATA_ACCESS_ROLE_ARN;
  delete process.env.HEALTHSCRIBE_READINESS_REF;
});

function configureHealthScribeEnv() {
  process.env.HEALTHSCRIBE_REGION = 'us-west-2';
  process.env.HEALTHSCRIBE_KMS_KEY_ARN = 'arn:aws:kms:us-west-2:123:key/abc';
  process.env.HEALTHSCRIBE_DATA_ACCESS_ROLE_ARN = 'arn:aws:iam::123:role/hs';
  process.env.HEALTHSCRIBE_READINESS_REF = 'ORR-2026-001';
}

// ---------------------------------------------------------------- config
describe('mode + provider resolution (req 8: env flag is not proof)', () => {
  test('defaults to fixture mode; fixture resolves', () => {
    expect(scribeMode()).toBe('fixture');
    expect(resolveProvider(undefined)).toBe('fixture');
  });

  test('fixture mode refuses the production provider', () => {
    expect(() => resolveProvider('aws_healthscribe')).toThrow(ScribeConfigError);
  });

  test('live mode with only the fixture configured refuses everything', () => {
    process.env.SCRIBE_MODE = 'live';
    expect(healthScribeConfig()).toBeNull();
    expect(() => resolveProvider(undefined)).toThrow(/cannot serve live mode/i);
  });

  test('live mode NEVER selects the fixture, even explicitly', () => {
    process.env.SCRIBE_MODE = 'live';
    configureHealthScribeEnv();
    expect(() => resolveProvider('fixture')).toThrow(/fixture provider cannot be selected in live mode/i);
    expect(resolveProvider(undefined)).toBe('aws_healthscribe');
  });

  test('partial HealthScribe config is not configured', () => {
    process.env.HEALTHSCRIBE_REGION = 'us-west-2'; // alone
    expect(healthScribeConfig()).toBeNull();
  });

  test('invalid SCRIBE_MODE and short callback secret are refused', () => {
    process.env.SCRIBE_MODE = 'production';
    expect(() => scribeMode()).toThrow(ScribeConfigError);
    process.env.SCRIBE_MODE = 'fixture';
    process.env.SCRIBE_CALLBACK_SECRET = 'short';
    expect(() => callbackSecret()).toThrow(/min 16/i);
  });
});

describe('disabled production adapter', () => {
  test('unconfigured HealthScribe cannot even be constructed', () => {
    expect(() => new HealthScribeProvider()).toThrow(ProviderDisabledError);
  });

  test('configured HealthScribe still refuses to run jobs (BAA is external)', async () => {
    configureHealthScribeEnv();
    const p = new HealthScribeProvider();
    await expect(p.startTranscription()).rejects.toBeInstanceOf(ProviderDisabledError);
    await expect(p.deleteArtifacts()).rejects.toBeInstanceOf(ProviderDisabledError);
  });
});

// ------------------------------------------------------------ signatures
function envelope(overrides: Partial<CallbackEnvelope> = {}): CallbackEnvelope {
  return {
    provider: 'fixture',
    eventId: 'evt-100',
    kind: 'transcript-ready',
    recordingId: REC_ID,
    providerJobId: 'fixture-job-1',
    issuedAt: new Date().toISOString(),
    payload: { segments: fixtureSegments('a'.repeat(64), 61000) },
    ...overrides,
  };
}

describe('signed callback verification', () => {
  test('valid signature verifies; tampered body does not', () => {
    const body = JSON.stringify(envelope());
    const sig = signCallbackBody(body, SECRET);
    expect(verifyCallbackSignature(body, sig, SECRET)).toBe(true);
    expect(verifyCallbackSignature(body + ' ', sig, SECRET)).toBe(false);
    expect(verifyCallbackSignature(body, sig, 'another-secret-0123456789')).toBe(false);
    expect(verifyCallbackSignature(body, 'zz'.repeat(32), SECRET)).toBe(false);
    expect(verifyCallbackSignature(body, 'deadbeef', SECRET)).toBe(false);
  });

  test('malformed envelopes are rejected before any processing', () => {
    expect(parseEnvelope('not json')).toBeNull();
    expect(parseEnvelope(JSON.stringify({ provider: 'evil' }))).toBeNull();
    expect(parseEnvelope(JSON.stringify(envelope({ recordingId: 'not-a-uuid' as never })))).toBeNull();
    expect(parseEnvelope(JSON.stringify(envelope({ kind: 'drop-tables' as never })))).toBeNull();
  });
});

// ------------------------------------------------ callback processing path
type RpcResult = { data?: unknown; error?: { code: string } | null };

function makeServiceClient(rpcMap: Record<string, RpcResult | RpcResult[]>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const counters: Record<string, number> = {};
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const entry = rpcMap[name];
      if (entry === undefined) return { data: null, error: { code: 'XXXXX' } };
      if (Array.isArray(entry)) {
        const i = Math.min(counters[name] ?? 0, entry.length - 1);
        counters[name] = (counters[name] ?? 0) + 1;
        return { data: entry[i].data ?? null, error: entry[i].error ?? null };
      }
      return { data: entry.data ?? null, error: entry.error ?? null };
    },
    from: () => {
      throw new Error('unexpected table access in callback path');
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const ledgerOk = { data: { id: '30000000-0000-4000-8000-0000000000cc', replay: false, status: 'received' } };

describe('callback processing: replay, out-of-order, PHI-free logs', () => {
  test('happy path: verified, recorded, ingested, marked processed', async () => {
    const { client, calls } = makeServiceClient({
      worker_record_callback_event: ledgerOk,
      worker_ingest_transcript_batch: { data: '40000000-0000-4000-8000-0000000000dd' },
      worker_mark_callback_event: { data: null },
    });
    const body = JSON.stringify(envelope());
    const out = await processProviderCallback(body, signCallbackBody(body, SECRET), {
      serviceClient: () => client,
      log: () => {},
    });
    expect(out).toEqual({ status: 'processed', transcriptId: '40000000-0000-4000-8000-0000000000dd' });
    expect(calls.map((c) => c.name)).toEqual([
      'worker_record_callback_event',
      'worker_ingest_transcript_batch',
      'worker_mark_callback_event',
    ]);
    const mark = calls[2].args as { _status: string };
    expect(mark._status).toBe('processed');
  });

  test('invalid signature: recorded as rejected, NEVER ingested', async () => {
    const { client, calls } = makeServiceClient({
      worker_record_callback_event: ledgerOk,
    });
    const body = JSON.stringify(envelope());
    const out = await processProviderCallback(body, 'ab'.repeat(32), {
      serviceClient: () => client,
      log: () => {},
    });
    expect(out.status).toBe('rejected');
    expect(calls.some((c) => c.name === 'worker_ingest_transcript_batch')).toBe(false);
    expect((calls[0].args as { _signature_valid: boolean })._signature_valid).toBe(false);
  });

  test('replayed event id acknowledges without reprocessing', async () => {
    const { client, calls } = makeServiceClient({
      worker_record_callback_event: { data: { id: 'x', replay: true, status: 'processed' } },
    });
    const body = JSON.stringify(envelope());
    const out = await processProviderCallback(body, signCallbackBody(body, SECRET), {
      serviceClient: () => client,
      log: () => {},
    });
    expect(out.status).toBe('replay');
    expect(calls.some((c) => c.name === 'worker_ingest_transcript_batch')).toBe(false);
  });

  test('stale timestamp is rejected even with a valid signature', async () => {
    const { client } = makeServiceClient({
      worker_record_callback_event: ledgerOk,
      worker_mark_callback_event: { data: null },
    });
    const body = JSON.stringify(envelope({ issuedAt: new Date(Date.now() - 10 * 60_000).toISOString() }));
    const out = await processProviderCallback(body, signCallbackBody(body, SECRET), {
      serviceClient: () => client,
      log: () => {},
    });
    expect(out.status).toBe('rejected');
  });

  test('out-of-order delivery defers (55000) and the provider redelivers', async () => {
    const { client, calls } = makeServiceClient({
      worker_record_callback_event: ledgerOk,
      worker_ingest_transcript_batch: { error: { code: '55000' } },
      worker_mark_callback_event: { data: null },
    });
    const body = JSON.stringify(envelope());
    const out = await processProviderCallback(body, signCallbackBody(body, SECRET), {
      serviceClient: () => client,
      log: () => {},
    });
    expect(out.status).toBe('deferred');
    const mark = calls.find((c) => c.name === 'worker_mark_callback_event')!.args as { _status: string };
    expect(mark._status).toBe('deferred');
  });

  test('transcript text NEVER appears in callback logs', async () => {
    const lines: string[] = [];
    const { client } = makeServiceClient({
      worker_record_callback_event: ledgerOk,
      worker_ingest_transcript_batch: { data: '40000000-0000-4000-8000-0000000000dd' },
      worker_mark_callback_event: { data: null },
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(' '));
    });
    try {
      const body = JSON.stringify(envelope());
      await processProviderCallback(body, signCallbackBody(body, SECRET), {
        serviceClient: () => client,
        log: (m) => lines.push(m),
      });
    } finally {
      consoleSpy.mockRestore();
    }
    const joined = lines.join('\n').toLowerCase();
    expect(joined).not.toContain('one eighteen');
    expect(joined).not.toContain('sleeping poorly');
    expect(joined).not.toContain('segments"');
  });

  test('deletion-confirmed defers under legal hold (55000)', async () => {
    const { client } = makeServiceClient({
      worker_record_callback_event: ledgerOk,
      worker_confirm_deletion_job: { error: { code: '55000' } },
      worker_mark_callback_event: { data: null },
    });
    const body = JSON.stringify(
      envelope({ kind: 'deletion-confirmed', payload: { jobId: JOB_ID, confirmation: 'provider-purge:1' } }),
    );
    const out = await processProviderCallback(body, signCallbackBody(body, SECRET), {
      serviceClient: () => client,
      log: () => {},
    });
    expect(out.status).toBe('deferred');
  });
});

// -------------------------------------------------------- store + content
describe('staged store + content validation (req 3)', () => {
  test('sniffs real audio containers and rejects impostors', () => {
    expect(sniffAudioContainer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]))).toBe('audio/webm');
    expect(sniffAudioContainer(Buffer.from('OggS\0\0', 'latin1'))).toBe('audio/ogg');
    expect(sniffAudioContainer(Buffer.from('RIFF\x10\0\0\0WAVEfmt ', 'latin1'))).toBe('audio/wav');
    expect(sniffAudioContainer(Buffer.from('\0\0\0\x18ftypisom', 'latin1'))).toBe('audio/mp4');
    expect(sniffAudioContainer(Buffer.from('ID3\x04', 'latin1'))).toBe('audio/mpeg');
    expect(sniffAudioContainer(Buffer.from('%PDF-1.7', 'latin1'))).toBeNull();
    expect(sniffAudioContainer(Buffer.from('<html>', 'latin1'))).toBeNull();
  });

  test('append caps at the authorized size and digests server-side', () => {
    const store = new FixtureAudioStore();
    store.appendChunk('rec/x/1', Buffer.alloc(600), 'audio/webm', 1000);
    expect(() => store.appendChunk('rec/x/1', Buffer.alloc(600), 'audio/webm', 1000)).toThrow(/maximum size/);
    expect(store.size('rec/x/1')).toBe(600);
    expect(store.sha256('rec/x/1')).toMatch(/^[0-9a-f]{64}$/);
    expect(store.sha256('rec/other')).toBeNull();
  });

  test('local deletion is idempotent and returns a confirmation', () => {
    const store = new FixtureAudioStore();
    store.appendChunk('rec/x/1', Buffer.alloc(10), 'audio/webm', 1000);
    const first = store.delete('rec/x/1');
    const second = store.delete('rec/x/1');
    expect(first.confirmation).toMatch(/^local-purge:/);
    expect(second.confirmation).toBe(first.confirmation);
    expect(store.has('rec/x/1')).toBe(false);
  });
});

// ----------------------------------------------------------------- workers
describe('durable workers', () => {
  test('fixture transcription: queued recording → signed callback → ingested', async () => {
    const rpcMap: Record<string, RpcResult | RpcResult[]> = {
      worker_record_callback_event: ledgerOk,
      worker_ingest_transcript_batch: { data: '40000000-0000-4000-8000-0000000000dd' },
      worker_mark_callback_event: { data: null },
    };
    const { client, calls } = makeServiceClient(rpcMap);
    const rows = [
      { id: REC_ID, storage_object_key: 'rec/x/1', audio_sha256: 'a'.repeat(64), duration_ms: 61000, provider: 'fixture', provider_job_id: null },
    ];
    (client as unknown as { from: unknown }).from = (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit']) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => void) =>
        resolve({ data: table === 'encounter_recordings' ? rows : [], error: null });
      return chain;
    };
    const deps = { serviceClient: () => client, log: () => {} };
    const provider = new FixtureScribeProvider(deps);
    const result = await runTranscriptionWorkerOnce({ ...deps, provider });
    expect(result.started).toBe(1);
    expect(result.delivered.map((d) => d.status)).toEqual(['processed']);
    const ingest = calls.find((c) => c.name === 'worker_ingest_transcript_batch')!.args as {
      _recording_id: string; _segments: unknown[];
    };
    expect(ingest._recording_id).toBe(REC_ID);
    expect(ingest._segments.length).toBeGreaterThan(0);
  });

  test('deferred fixture delivery is retained and succeeds on redelivery', async () => {
    const rpcMap: Record<string, RpcResult | RpcResult[]> = {
      worker_record_callback_event: [ledgerOk, { data: { id: 'x', replay: false, retry: true, status: 'deferred' } }],
      worker_ingest_transcript_batch: [{ error: { code: '55000' } }, { data: '40000000-0000-4000-8000-0000000000dd' }],
      worker_mark_callback_event: { data: null },
    };
    const { client } = makeServiceClient(rpcMap);
    const deps = { serviceClient: () => client, log: () => {} };
    const provider = new FixtureScribeProvider(deps);
    await provider.startTranscription({ recordingId: REC_ID, storageObjectKey: 'rec/x/1', audioSha256: 'a'.repeat(64), durationMs: 61000 });
    const first = await provider.deliverPending();
    expect(first.map((d) => d.status)).toEqual(['deferred']);
    expect(provider.pending.length).toBe(1); // retained for redelivery
    const second = await provider.deliverPending();
    expect(second.map((d) => d.status)).toEqual(['processed']);
    expect(provider.pending.length).toBe(0);
  });

  test('deletion worker: local target purges the staged object and confirms', async () => {
    const { client, calls } = makeServiceClient({
      worker_claim_due_deletion_jobs: {
        data: [{ jobId: JOB_ID, recordingId: REC_ID, target: 'local', attempts: 0, provider: 'fixture', storageObjectKey: 'rec/x/1' }],
      },
      worker_confirm_deletion_job: { data: { recordingStatus: 'deleted', remaining: 0 } },
    });
    const store = new FixtureAudioStore();
    store.appendChunk('rec/x/1', Buffer.alloc(10), 'audio/webm', 1000);
    const deps = { serviceClient: () => client, log: () => {} };
    const provider = new FixtureScribeProvider(deps);
    const result = await runDeletionWorkerOnce({ ...deps, provider, store });
    expect(result).toEqual({ claimed: 1, confirmed: 1, failed: 0, deadLettered: 0 });
    expect(store.has('rec/x/1')).toBe(false);
    const confirm = calls.find((c) => c.name === 'worker_confirm_deletion_job')!.args as { _confirmation: string };
    expect(confirm._confirmation).toMatch(/^local-purge:/);
  });

  test('deletion worker: provider outage records failure; 5th failure dead-letters', async () => {
    const { client, calls } = makeServiceClient({
      worker_claim_due_deletion_jobs: {
        data: [{ jobId: JOB_ID, recordingId: REC_ID, target: 'provider', attempts: 4, provider: 'fixture', storageObjectKey: 'rec/x/1' }],
      },
      worker_fail_deletion_job: { data: { attempts: 5, deadLettered: true } },
    });
    const deps = { serviceClient: () => client, log: () => {} };
    const provider = new FixtureScribeProvider(deps);
    provider.failDeletionTimes = 1;
    const result = await runDeletionWorkerOnce({ ...deps, provider, store: new FixtureAudioStore() });
    expect(result).toEqual({ claimed: 1, confirmed: 0, failed: 1, deadLettered: 1 });
    const fail = calls.find((c) => c.name === 'worker_fail_deletion_job')!.args as { _error: string };
    expect(fail._error).toMatch(/outage/);
  });

  test('worker logs never contain transcript text or audio bytes', async () => {
    const lines: string[] = [];
    const rpcMap: Record<string, RpcResult | RpcResult[]> = {
      worker_record_callback_event: ledgerOk,
      worker_ingest_transcript_batch: { data: '40000000-0000-4000-8000-0000000000dd' },
      worker_mark_callback_event: { data: null },
    };
    const { client } = makeServiceClient(rpcMap);
    (client as unknown as { from: unknown }).from = () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'limit']) chain[m] = () => chain;
      chain.then = (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ id: REC_ID, storage_object_key: 'rec/x/1', audio_sha256: 'a'.repeat(64), duration_ms: 61000, provider: 'fixture', provider_job_id: null }],
          error: null,
        });
      return chain;
    };
    const deps = { serviceClient: () => client, log: (m: string) => lines.push(m) };
    const provider = new FixtureScribeProvider(deps);
    await runTranscriptionWorkerOnce({ ...deps, provider });
    const joined = lines.join('\n').toLowerCase();
    expect(lines.length).toBeGreaterThan(0);
    expect(joined).not.toContain('one eighteen');
    expect(joined).not.toContain('sleeping poorly');
  });
});

// -------------------------------------------- callback route configuration
// Route-level posture: SCRIBE_CALLBACK_SECRET is only meaningful when a
// provider mode exists. Disabled mode needs no secret at all; a missing
// secret in fixture/live modes refuses cleanly instead of crashing.
describe('callback route configuration posture', () => {
  test('disabled mode: 404 not_configured with NO secret set and no ledger touch', async () => {
    process.env.SCRIBE_MODE = 'disabled';
    delete process.env.SCRIBE_CALLBACK_SECRET;
    const { scribeApp } = await import('../backend/scribe/routes');
    const res = await scribeApp.request('/callback', { method: 'POST', body: '{}' });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('not_configured');
  });

  test('fixture mode with a missing secret: clean 503 config refusal, not a crash', async () => {
    process.env.SCRIBE_MODE = 'fixture';
    delete process.env.SCRIBE_CALLBACK_SECRET;
    const { scribeApp } = await import('../backend/scribe/routes');
    const body = JSON.stringify(envelope());
    const res = await scribeApp.request('/callback', {
      method: 'POST',
      body,
      headers: { 'x-scribe-signature': 'aa'.repeat(32) },
    });
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('not_configured');
  });
});
