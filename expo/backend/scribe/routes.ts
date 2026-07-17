import { Hono } from 'hono';
import { createClinicalAnonClient, createClinicalUserClient, createClinicalServiceClient } from '../clinical-supabase';
import { processProviderCallback } from './callback';
import { scribeMode, ScribeConfigError } from './config';
import { fixtureAudioStore, sniffAudioContainer } from './store';

/**
 * Binary + callback HTTP surfaces for the scribe (can't ride superjson tRPC):
 *
 *   POST /api/clinical/scribe/recordings/:id/chunks
 *     — one audio chunk. EVERY chunk re-validates the capture authorization
 *       (bound token, ACTIVE session, all-participant consent) through the
 *       authorize_chunk RPC under the CALLER's JWT. Withdrawal revokes the
 *       session/token server-side, so a streaming upload dies mid-flight the
 *       moment consent is withdrawn — active revocation, not token expiry.
 *
 *   POST /api/clinical/scribe/recordings/:id/complete
 *     — upload completion. Server recomputes size + SHA-256 from the staged
 *       bytes, sniffs the audio container against the declared content type,
 *       and calls complete_upload (single-use completion token). Content that
 *       fails validation is QUARANTINED by the RPC, not processed.
 *
 *   POST /api/clinical/scribe/callback
 *     — signed provider callbacks (fixture and production alike): HMAC
 *       verification, replay dedupe, out-of-order deferral. No bearer auth —
 *       authentication is the signature; the route never trusts the body
 *       beyond what the signature proves.
 *
 * Logs: ids, sizes, codes. Never audio bytes, transcript text or tokens.
 */

const UUID_RE = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_CHUNK_BYTES = 5 * 1024 * 1024;
const err = (code: string, message: string) => ({ error: { code, message } });

async function bearerUser(c: { req: { header: (h: string) => string | undefined } }): Promise<string | null> {
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const { data, error } = await createClinicalAnonClient().auth.getUser(token);
    if (error || !data?.user) return null;
    return token;
  } catch {
    return null;
  }
}

export const scribeApp = new Hono();

scribeApp.post('/recordings/:id/chunks', async (c) => {
  const token = await bearerUser(c);
  if (!token) return c.json(err('unauthenticated', 'Authentication required'), 401);
  const recordingId = c.req.param('id');
  if (!UUID_RE.test(recordingId)) return c.json(err('invalid', 'A recording id is required'), 400);
  const captureToken = c.req.header('x-capture-token') ?? '';
  if (!captureToken) return c.json(err('invalid', 'A capture token is required'), 400);

  const bytes = Buffer.from(await c.req.arrayBuffer());
  if (bytes.length === 0) return c.json(err('invalid', 'Empty chunk'), 400);
  if (bytes.length > MAX_CHUNK_BYTES) return c.json(err('invalid', 'Chunk too large'), 413);

  const db = createClinicalUserClient(token);
  const auth = await db.rpc('authorize_chunk', {
    _recording_id: recordingId,
    _capture_token: captureToken,
    _chunk_bytes: bytes.length,
  });
  if (auth.error) {
    const code = auth.error.code ?? '';
    // 55000 covers: revoked token, revoked/paused session, withdrawn consent,
    // expiry, size violations. The client must STOP capturing on 409.
    if (code === '55000') return c.json(err('capture_refused', 'Capture is no longer authorized'), 409);
    if (code === '42501') return c.json(err('forbidden', 'Not authorized'), 403);
    if (code === 'P0002') return c.json(err('not_found', 'Recording not found'), 404);
    return c.json(err('unavailable', 'Chunk authorization failed'), 502);
  }
  const grant = auth.data as { storage_object_key: string; content_type: string; max_bytes: number };
  try {
    const staged = fixtureAudioStore.appendChunk(grant.storage_object_key, bytes, grant.content_type, grant.max_bytes);
    console.log(`[scribe-upload] chunk recording=${recordingId} bytes=${bytes.length} total=${staged.totalBytes}`);
    return c.json({ data: { receivedBytes: bytes.length, totalBytes: staged.totalBytes } });
  } catch {
    return c.json(err('too_large', 'The staged recording exceeds its authorized size'), 413);
  }
});

scribeApp.post('/recordings/:id/complete', async (c) => {
  const token = await bearerUser(c);
  if (!token) return c.json(err('unauthenticated', 'Authentication required'), 401);
  const recordingId = c.req.param('id');
  if (!UUID_RE.test(recordingId)) return c.json(err('invalid', 'A recording id is required'), 400);

  let body: { completionToken?: string; durationMs?: number };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json(err('invalid', 'A JSON body is required'), 400);
  }
  const completionToken = body.completionToken ?? '';
  const durationMs = Number(body.durationMs ?? 0);
  if (!completionToken) return c.json(err('invalid', 'A completion token is required'), 400);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return c.json(err('invalid', 'A positive durationMs is required'), 400);
  }

  const db = createClinicalUserClient(token);
  // The recording row is read under the caller's RLS view; the object key is
  // SERVER state — the client never supplies it.
  const rec = await db
    .from('encounter_recordings')
    .select('id, storage_object_key, content_type')
    .eq('id', recordingId)
    .maybeSingle();
  if (rec.error) return c.json(err('unavailable', 'Could not load the recording'), 502);
  if (!rec.data) return c.json(err('not_found', 'Recording not found or not accessible'), 404);
  const row = rec.data as { id: string; storage_object_key: string | null; content_type: string | null };
  const objectKey = row.storage_object_key ?? '';

  // Server-side content validation: recomputed size + digest, container sniff.
  const totalBytes = fixtureAudioStore.size(objectKey);
  const sha256 = fixtureAudioStore.sha256(objectKey);
  const head = fixtureAudioStore.head(objectKey);
  const sniffed = head ? sniffAudioContainer(head) : null;
  const declared = row.content_type ?? '';
  const containerOk = sniffed !== null && sniffed === declared;

  const complete = await db.rpc('complete_upload', {
    _recording_id: recordingId,
    _capture_token: completionToken,
    _storage_object_key: objectKey,
    // A container mismatch is reported as an invalid digest/type so the RPC
    // quarantines the object instead of processing it.
    _audio_sha256: containerOk ? sha256 : null,
    _audio_bytes: totalBytes,
    _content_type: containerOk ? declared : (sniffed ?? 'application/octet-stream'),
    _duration_ms: Math.floor(durationMs),
  });
  if (complete.error) {
    const code = complete.error.code ?? '';
    if (code === '55000') return c.json(err('completion_refused', 'Upload completion is not authorized'), 409);
    if (code === '42501') return c.json(err('forbidden', 'Not authorized'), 403);
    if (code === 'P0002') return c.json(err('not_found', 'Recording not found'), 404);
    if (code === '40003') return c.json(err('invalid_state', 'The recording cannot accept an upload in its current state'), 409);
    return c.json(err('unavailable', 'Completion failed'), 502);
  }
  const outcome = complete.data as { status: string; idempotent: boolean };
  console.log(`[scribe-upload] complete recording=${recordingId} status=${outcome.status} bytes=${totalBytes} containerOk=${containerOk}`);
  return c.json({ data: { status: outcome.status, idempotent: outcome.idempotent, totalBytes } });
});

scribeApp.post('/callback', async (c) => {
  // Disabled mode has no providers, so no legitimate callbacks exist and no
  // callback secret is required. Answer "not configured" without touching
  // the ledger — SCRIBE_CALLBACK_SECRET may be omitted entirely.
  if (scribeMode() === 'disabled') {
    return c.json(err('not_configured', 'Scribe is not configured in this environment.'), 404);
  }
  const signature = c.req.header('x-scribe-signature') ?? '';
  const rawBody = await c.req.text();
  if (rawBody.length > 1024 * 1024) return c.json(err('too_large', 'Callback body too large'), 413);
  let outcome;
  try {
    outcome = await processProviderCallback(rawBody, signature, {
      serviceClient: () => createClinicalServiceClient(),
    });
  } catch (e) {
    // Missing/short SCRIBE_CALLBACK_SECRET in fixture/live modes is a server
    // configuration problem — answer honestly, never a stack trace.
    if (e instanceof ScribeConfigError) {
      console.log('[scribe-callback] refused: callback secret not configured');
      return c.json(err('not_configured', 'Callback verification is not configured.'), 503);
    }
    throw e;
  }
  switch (outcome.status) {
    case 'processed':
      return c.json({ data: { status: 'processed' } }, 200);
    case 'replay':
      return c.json({ data: { status: 'replay' } }, 200); // idempotent ack
    case 'deferred':
      return c.json(err('not_ready', 'Redeliver later'), 409); // provider retries
    case 'rejected':
    default:
      return c.json(err('rejected', 'Delivery rejected'), 401);
  }
});
