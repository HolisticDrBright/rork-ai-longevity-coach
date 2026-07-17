import type { SupabaseClient } from '@supabase/supabase-js';
import { FixtureScribeProvider, type ScribeProvider } from './providers';
import { fixtureAudioStore, type FixtureAudioStore } from './store';
import type { CallbackDeps, CallbackOutcome } from './callback';

/**
 * Durable workers (Milestone 1 backend). Both are single-tick functions —
 * idempotent, safe to run concurrently (job claiming uses SKIP LOCKED in the
 * database) and driven either by an interval or explicitly from tests and
 * procedures. Logs carry ids, counts and codes only — never audio bytes,
 * transcript text or signed URLs.
 */

export interface WorkerDeps extends CallbackDeps {
  provider: ScribeProvider;
  store?: FixtureAudioStore;
}

export interface TranscriptionTickResult {
  started: number;
  delivered: CallbackOutcome[];
}

/**
 * Transcription worker: find queued recordings for this provider, start the
 * provider job, then (fixture) deliver completed callbacks through the shared
 * signed-callback path. Redeliveries of previously deferred callbacks happen
 * on every tick, which is the out-of-order recovery loop.
 */
export async function runTranscriptionWorkerOnce(deps: WorkerDeps): Promise<TranscriptionTickResult> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const db: SupabaseClient = deps.serviceClient();

  const queued = await db
    .from('encounter_recordings')
    .select('id, storage_object_key, audio_sha256, duration_ms, provider, provider_job_id')
    .eq('status', 'transcription_queued')
    .eq('provider', deps.provider.name)
    .limit(10);

  let started = 0;
  if (!queued.error) {
    for (const row of (queued.data ?? []) as Array<{
      id: string; storage_object_key: string | null; audio_sha256: string | null;
      duration_ms: number | null; provider_job_id: string | null;
    }>) {
      // provider_job_id present ⇒ the job was already started; the callback
      // will (re)arrive via redelivery. Never start the same job twice.
      if (row.provider_job_id) continue;
      try {
        const job = await deps.provider.startTranscription({
          recordingId: row.id,
          storageObjectKey: row.storage_object_key ?? '',
          audioSha256: row.audio_sha256 ?? '',
          durationMs: row.duration_ms ?? 60000,
        });
        started += 1;
        log(`[scribe-worker] transcription started recording=${row.id} job=${job.providerJobId}`);
      } catch (e) {
        log(`[scribe-worker] transcription start failed recording=${row.id} code=${(e as { code?: string }).code ?? 'unknown'}`);
      }
    }
  } else {
    log(`[scribe-worker] queue scan error code=${queued.error.code ?? 'unknown'}`);
  }

  const delivered =
    deps.provider instanceof FixtureScribeProvider ? await deps.provider.deliverPending() : [];
  return { started, delivered };
}

export interface DeletionTickResult {
  claimed: number;
  confirmed: number;
  failed: number;
  deadLettered: number;
}

/**
 * Deletion worker: claim due jobs (skip-locked, legal-hold-aware, dead-letter
 * aware), purge the target, and confirm — or record the failure with backoff.
 * A recording is 'deleted' only when EVERY target job has confirmed.
 */
export async function runDeletionWorkerOnce(deps: WorkerDeps, limit = 10): Promise<DeletionTickResult> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const db: SupabaseClient = deps.serviceClient();
  const store = deps.store ?? fixtureAudioStore;

  const result: DeletionTickResult = { claimed: 0, confirmed: 0, failed: 0, deadLettered: 0 };
  const claimedRes = await db.rpc('worker_claim_due_deletion_jobs', { _limit: limit });
  if (claimedRes.error) {
    log(`[deletion-worker] claim error code=${claimedRes.error.code ?? 'unknown'}`);
    return result;
  }
  const jobs = (claimedRes.data ?? []) as Array<{
    jobId: string; recordingId: string; target: 'local' | 'provider';
    attempts: number; provider: string; storageObjectKey: string | null;
  }>;
  result.claimed = jobs.length;

  for (const job of jobs) {
    try {
      let confirmation: string;
      if (job.target === 'local') {
        confirmation = store.delete(job.storageObjectKey ?? '').confirmation;
      } else {
        confirmation = (
          await deps.provider.deleteArtifacts({ recordingId: job.recordingId, providerJobId: null })
        ).confirmation;
      }
      const confirm = await db.rpc('worker_confirm_deletion_job', {
        _job_id: job.jobId, _confirmation: confirmation,
      });
      if (confirm.error) throw new Error(`confirm refused (${confirm.error.code ?? 'unknown'})`);
      result.confirmed += 1;
      log(`[deletion-worker] confirmed job=${job.jobId} target=${job.target}`);
    } catch (e) {
      const fail = await db.rpc('worker_fail_deletion_job', {
        _job_id: job.jobId,
        _error: (e as Error).message?.slice(0, 200) ?? 'unknown failure',
      });
      result.failed += 1;
      const dead = Boolean((fail.data as { deadLettered?: boolean } | null)?.deadLettered);
      if (dead) result.deadLettered += 1;
      log(`[deletion-worker] failed job=${job.jobId} target=${job.target} deadLettered=${dead}`);
    }
  }
  return result;
}
