import { randomUUID } from 'node:crypto';
import { healthScribeConfig, ScribeConfigError, type ProviderName } from './config';
import { signCallbackBody, type CallbackEnvelope, type CallbackOutcome, type CallbackDeps, processProviderCallback } from './callback';
import { callbackSecret } from './config';

/**
 * Provider abstraction (Milestone 1). BOTH implementations speak the same
 * contract: async jobs that complete via SIGNED callbacks into the shared
 * processing path, and deletion that must be explicitly confirmed per target.
 * The fixture therefore exercises the callbacks, state transitions, retries
 * and deletion contracts the production adapter will use — not a shortcut.
 */

export interface TranscriptionJobRequest {
  recordingId: string;
  storageObjectKey: string;
  audioSha256: string;
  durationMs: number;
}

export interface ScribeProvider {
  readonly name: ProviderName;
  /** Start an async transcription job; completion arrives via callback. */
  startTranscription(job: TranscriptionJobRequest): Promise<{ providerJobId: string }>;
  /** Purge provider-side artifacts; resolves with a verifiable confirmation. */
  deleteArtifacts(ref: { recordingId: string; providerJobId: string | null }): Promise<{ confirmation: string }>;
}

export class ProviderDisabledError extends Error {
  readonly code = 'PROVIDER_DISABLED';
  constructor(message: string) {
    super(message);
    this.name = 'ProviderDisabledError';
  }
}

/**
 * AWS HealthScribe adapter — present but DISABLED. Every method throws until
 * live mode is fully configured; and even then this build refuses to run the
 * job because operational verification (BAA execution, readiness review) is
 * an external human responsibility that code cannot attest. The DB-side
 * provider_enablements row is enforced independently by begin_recording.
 */
export class HealthScribeProvider implements ScribeProvider {
  readonly name = 'aws_healthscribe' as const;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const cfg = healthScribeConfig(env);
    if (!cfg) {
      throw new ProviderDisabledError(
        'AWS HealthScribe is not configured: HEALTHSCRIBE_REGION, HEALTHSCRIBE_KMS_KEY_ARN, ' +
          'HEALTHSCRIBE_DATA_ACCESS_ROLE_ARN and HEALTHSCRIBE_READINESS_REF are all required.',
      );
    }
  }

  async startTranscription(): Promise<{ providerJobId: string }> {
    throw new ProviderDisabledError(
      'AWS HealthScribe is disabled in this build pending operational readiness verification. ' +
        'Contractual and legal verification (the BAA) is an external responsibility and is never inferred from configuration.',
    );
  }

  async deleteArtifacts(): Promise<{ confirmation: string }> {
    throw new ProviderDisabledError('AWS HealthScribe is disabled in this build.');
  }
}

/** Deterministic transcript used by the fixture — safe, synthetic content. */
export function fixtureSegments(audioSha256: string, durationMs: number) {
  const half = Math.max(1000, Math.floor(durationMs / 2));
  return [
    {
      speaker: 'clinician',
      startMs: 0,
      endMs: half,
      text: 'Blood pressure today is one eighteen over seventy six, seated.',
      confidence: 0.94,
    },
    {
      speaker: 'patient',
      startMs: half + 200,
      endMs: durationMs,
      text: `I have been sleeping poorly for about two weeks. (fixture ${audioSha256.slice(0, 8)})`,
      confidence: 0.91,
    },
  ];
}

export interface FixtureDelivery {
  envelope: CallbackEnvelope;
  rawBody: string;
  signature: string;
}

/**
 * Fixture provider. Instead of "returning" a transcript, it DELIVERS one the
 * way production will: it builds a signed callback envelope and pushes it
 * through the shared processing path. Deliveries that defer (out-of-order)
 * stay in `pending` for redelivery — mirroring webhook retry semantics.
 * Failure injection (`failDeletionTimes`) drives the retry/dead-letter tests.
 */
export class FixtureScribeProvider implements ScribeProvider {
  readonly name = 'fixture' as const;
  readonly pending: FixtureDelivery[] = [];
  failDeletionTimes = 0;
  private deliveredEventIds = new Set<string>();

  constructor(private readonly deps: CallbackDeps) {}

  private buildDelivery(envelope: CallbackEnvelope): FixtureDelivery {
    const rawBody = JSON.stringify(envelope);
    return { envelope, rawBody, signature: signCallbackBody(rawBody, callbackSecret()) };
  }

  async startTranscription(job: TranscriptionJobRequest): Promise<{ providerJobId: string }> {
    const providerJobId = `fixture-job-${job.recordingId.slice(0, 8)}`;
    const envelope: CallbackEnvelope = {
      provider: 'fixture',
      eventId: `fixture-evt-${job.recordingId.slice(0, 8)}-transcript`,
      kind: 'transcript-ready',
      recordingId: job.recordingId,
      providerJobId,
      issuedAt: new Date().toISOString(),
      payload: { segments: fixtureSegments(job.audioSha256, job.durationMs) },
    };
    this.pending.push(this.buildDelivery(envelope));
    return { providerJobId };
  }

  async deleteArtifacts(ref: { recordingId: string; providerJobId: string | null }): Promise<{ confirmation: string }> {
    if (this.failDeletionTimes > 0) {
      this.failDeletionTimes -= 1;
      throw new Error('fixture provider deletion outage (injected)');
    }
    return { confirmation: `fixture-purge:${ref.recordingId.slice(0, 8)}` };
  }

  /**
   * Deliver pending callbacks through the SAME verification/processing path
   * the HTTP route uses. Deferred deliveries are retained for the next tick;
   * processed/replayed/rejected deliveries are dropped.
   */
  async deliverPending(): Promise<CallbackOutcome[]> {
    const outcomes: CallbackOutcome[] = [];
    const keep: FixtureDelivery[] = [];
    for (const d of this.pending.splice(0)) {
      const freshBody = JSON.stringify({ ...d.envelope, issuedAt: new Date().toISOString() });
      const fresh: FixtureDelivery = {
        envelope: d.envelope,
        rawBody: freshBody,
        signature: signCallbackBody(freshBody, callbackSecret()),
      };
      const outcome = await processProviderCallback(fresh.rawBody, fresh.signature, this.deps);
      outcomes.push(outcome);
      if (outcome.status === 'deferred') keep.push(fresh);
      else this.deliveredEventIds.add(d.envelope.eventId);
    }
    this.pending.push(...keep);
    return outcomes;
  }
}

export function createProvider(name: ProviderName, deps: CallbackDeps, env: NodeJS.ProcessEnv = process.env): ScribeProvider {
  if (name === 'aws_healthscribe') return new HealthScribeProvider(env);
  if (name === 'fixture') return new FixtureScribeProvider(deps);
  throw new ScribeConfigError(`unknown provider '${name as string}'`);
}
