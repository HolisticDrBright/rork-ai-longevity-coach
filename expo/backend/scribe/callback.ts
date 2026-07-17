import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callbackSecret } from './config';

/**
 * Signed provider callbacks (Milestone 1, backend req: signed verification,
 * replay handling, out-of-order handling).
 *
 * Every delivery — production adapter AND fixture — travels the same path:
 *   raw body + HMAC-SHA256 signature header
 *     → verifyCallbackSignature (timing-safe, timestamp window)
 *     → worker_record_callback_event (event-id dedupe ledger; replays of a
 *       PROCESSED event are acknowledged idempotently, never reprocessed)
 *     → dispatch by kind through service-role worker RPCs
 *     → out-of-order deliveries (recording not ready yet) are DEFERRED: the
 *       ledger row is marked 'deferred' and the response tells the provider
 *       to redeliver (payloads are never persisted server-side — transcript
 *       text does not belong in infrastructure tables).
 *
 * Logs carry event kind, status and SQLSTATEs only — never segment text.
 */

export type CallbackKind = 'transcript-ready' | 'transcript-failed' | 'deletion-confirmed';

export interface TranscriptSegmentPayload {
  speaker?: string;
  startMs?: number;
  endMs?: number;
  text: string;
  confidence?: number;
}

export interface CallbackEnvelope {
  provider: 'fixture' | 'aws_healthscribe';
  eventId: string;
  kind: CallbackKind;
  recordingId: string;
  providerJobId: string;
  issuedAt: string; // ISO timestamp — deliveries outside the window are refused
  payload: {
    segments?: TranscriptSegmentPayload[];
    failureReason?: string;
    confirmation?: string;
    jobId?: string; // deletion job id, for deletion-confirmed
  };
}

export const CALLBACK_MAX_SKEW_MS = 5 * 60 * 1000;

export function signCallbackBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function verifyCallbackSignature(rawBody: string, signatureHex: string, secret: string): boolean {
  if (!signatureHex || !/^[0-9a-f]{64}$/i.test(signatureHex)) return false;
  const expected = Buffer.from(signCallbackBody(rawBody, secret), 'hex');
  const provided = Buffer.from(signatureHex, 'hex');
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

const UUID_RE = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function parseEnvelope(rawBody: string): CallbackEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const e = parsed as Partial<CallbackEnvelope>;
  if (
    !e ||
    (e.provider !== 'fixture' && e.provider !== 'aws_healthscribe') ||
    typeof e.eventId !== 'string' || e.eventId.length === 0 || e.eventId.length > 200 ||
    (e.kind !== 'transcript-ready' && e.kind !== 'transcript-failed' && e.kind !== 'deletion-confirmed') ||
    typeof e.recordingId !== 'string' || !UUID_RE.test(e.recordingId) ||
    typeof e.providerJobId !== 'string' ||
    typeof e.issuedAt !== 'string' ||
    typeof e.payload !== 'object' || e.payload === null
  ) {
    return null;
  }
  return e as CallbackEnvelope;
}

export type CallbackOutcome =
  | { status: 'processed'; transcriptId?: string }
  | { status: 'replay' }
  | { status: 'deferred'; reason: string } // provider should redeliver later
  | { status: 'rejected'; reason: string };

export interface CallbackDeps {
  /** service-role client factory — worker RPCs are granted to service_role only */
  serviceClient: () => SupabaseClient;
  now?: () => number;
  log?: (message: string) => void;
}

/**
 * Verify + record + process one callback delivery. This is THE processing
 * path: the HTTP route and the fixture provider both call it, so the fixture
 * exercises exactly what the production adapter will.
 */
export async function processProviderCallback(
  rawBody: string,
  signatureHex: string,
  deps: CallbackDeps,
): Promise<CallbackOutcome> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const now = deps.now ?? Date.now;

  const envelope = parseEnvelope(rawBody);
  const signatureValid =
    envelope !== null && verifyCallbackSignature(rawBody, signatureHex, callbackSecret());

  if (!envelope) {
    log('[scribe-callback] rejected malformed envelope');
    return { status: 'rejected', reason: 'malformed envelope' };
  }

  const db = deps.serviceClient();

  // Record the delivery in the ledger FIRST — even invalid signatures leave a
  // rejected row (forensics), and processed event ids short-circuit as replays.
  const recorded = await db.rpc('worker_record_callback_event', {
    _provider: envelope.provider,
    _event_id: envelope.eventId,
    _kind: envelope.kind,
    _recording_id: envelope.recordingId,
    _payload_sha256: sha256Hex(rawBody),
    _signature_valid: signatureValid,
  });
  if (recorded.error) {
    log(`[scribe-callback] ledger error code=${recorded.error.code ?? 'unknown'}`);
    return { status: 'deferred', reason: 'ledger unavailable' };
  }
  const ledger = recorded.data as { id: string; replay: boolean; status: string };

  if (!signatureValid) {
    log(`[scribe-callback] rejected kind=${envelope.kind} reason=bad-signature`);
    return { status: 'rejected', reason: 'invalid signature' };
  }
  if (ledger.replay) {
    log(`[scribe-callback] replay kind=${envelope.kind} (already processed)`);
    return { status: 'replay' };
  }

  const skew = Math.abs(now() - Date.parse(envelope.issuedAt));
  if (!Number.isFinite(skew) || skew > CALLBACK_MAX_SKEW_MS) {
    await db.rpc('worker_mark_callback_event', {
      _event_uuid: ledger.id, _status: 'rejected', _error: 'timestamp outside window',
    });
    log(`[scribe-callback] rejected kind=${envelope.kind} reason=stale-timestamp`);
    return { status: 'rejected', reason: 'timestamp outside acceptance window' };
  }

  const mark = async (status: 'processed' | 'deferred' | 'rejected', error?: string) => {
    const r = await db.rpc('worker_mark_callback_event', {
      _event_uuid: ledger.id, _status: status, _error: error ?? null,
    });
    if (r.error) log(`[scribe-callback] mark error code=${r.error.code ?? 'unknown'}`);
  };

  if (envelope.kind === 'transcript-ready') {
    const segments = envelope.payload.segments ?? [];
    if (!Array.isArray(segments) || segments.length === 0) {
      await mark('rejected', 'empty segments');
      return { status: 'rejected', reason: 'transcript-ready requires segments' };
    }
    const ingest = await db.rpc('worker_ingest_transcript_batch', {
      _recording_id: envelope.recordingId,
      _provider_job_id: envelope.providerJobId,
      _segments: segments,
    });
    if (ingest.error) {
      const code = ingest.error.code ?? '';
      // Out-of-order: the recording isn't queued yet (upload still completing,
      // or queue_transcription not called). Defer — the provider redelivers.
      if (code === '55000' || code === '40003') {
        await mark('deferred', `not ready (${code})`);
        log(`[scribe-callback] deferred kind=transcript-ready code=${code}`);
        return { status: 'deferred', reason: 'recording is not ready for this event' };
      }
      await mark('rejected', `ingest failed (${code})`);
      log(`[scribe-callback] rejected kind=transcript-ready code=${code}`);
      return { status: 'rejected', reason: 'ingestion refused' };
    }
    await mark('processed');
    log('[scribe-callback] processed kind=transcript-ready');
    return { status: 'processed', transcriptId: ingest.data as string };
  }

  if (envelope.kind === 'transcript-failed') {
    const failed = await db.rpc('worker_mark_recording_failed', {
      _recording_id: envelope.recordingId,
      _reason: (envelope.payload.failureReason ?? 'provider transcription failed').slice(0, 200),
    });
    if (failed.error) {
      const code = failed.error.code ?? '';
      if (code === '40003') {
        // already terminal — treat as processed (idempotent outcome)
        await mark('processed');
        return { status: 'processed' };
      }
      await mark('deferred', `mark-failed error (${code})`);
      return { status: 'deferred', reason: 'could not record failure yet' };
    }
    await mark('processed');
    log('[scribe-callback] processed kind=transcript-failed');
    return { status: 'processed' };
  }

  // deletion-confirmed — the provider confirms ITS side is purged.
  const jobId = envelope.payload.jobId;
  const confirmation = envelope.payload.confirmation;
  if (!jobId || !UUID_RE.test(jobId) || !confirmation) {
    await mark('rejected', 'missing job id or confirmation');
    return { status: 'rejected', reason: 'deletion-confirmed requires jobId and confirmation' };
  }
  const confirm = await db.rpc('worker_confirm_deletion_job', {
    _job_id: jobId, _confirmation: confirmation.slice(0, 200),
  });
  if (confirm.error) {
    const code = confirm.error.code ?? '';
    if (code === '55000') {
      await mark('deferred', `legal hold or precondition (${code})`);
      return { status: 'deferred', reason: 'deletion cannot be confirmed yet' };
    }
    await mark('rejected', `confirm failed (${code})`);
    return { status: 'rejected', reason: 'confirmation refused' };
  }
  await mark('processed');
  log('[scribe-callback] processed kind=deletion-confirmed');
  return { status: 'processed' };
}
