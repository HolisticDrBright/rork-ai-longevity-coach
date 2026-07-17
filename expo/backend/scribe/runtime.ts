import { createClinicalServiceClient } from '../clinical-supabase';
import { isDeployedEnvironment } from '../deployment';
import { scribeMode, healthScribeConfig } from './config';
import { createProvider, FixtureScribeProvider, type ScribeProvider } from './providers';
import { runDeletionWorkerOnce, runTranscriptionWorkerOnce, type WorkerDeps } from './workers';

/**
 * Process-wide scribe runtime: one provider instance + worker deps shared by
 * the tRPC procedures (opportunistic ticks), the interval loop, and the HTTP
 * callback route. The fixture provider must be a SINGLETON so its pending
 * callback deliveries survive between ticks (webhook redelivery semantics).
 */

let cached: WorkerDeps | null | undefined;

export function getScribeWorkerDeps(): WorkerDeps | null {
  if (cached !== undefined) return cached;
  const deps = {
    serviceClient: () => createClinicalServiceClient(),
  };
  try {
    const mode = scribeMode();
    let provider: ScribeProvider;
    if (mode === 'disabled') {
      // Disabled means disabled: no provider and no workers, even if
      // HealthScribe env vars happen to be present.
      cached = null;
      return cached;
    }
    if (mode === 'fixture') {
      if (isDeployedEnvironment()) {
        // Fixture providers never run deployed — no workers, and every
        // user-facing entry point refuses via resolveProvider.
        cached = null;
        return cached;
      }
      provider = createProvider('fixture', deps);
    } else if (healthScribeConfig()) {
      provider = createProvider('aws_healthscribe', deps);
    } else {
      // Live mode with no configured production provider: no workers. Every
      // user-facing entry point already refuses via resolveProvider.
      cached = null;
      return cached;
    }
    cached = { ...deps, provider };
  } catch {
    cached = null;
  }
  return cached;
}

/** Test hook: reset the cached runtime (e.g. after changing SCRIBE_MODE). */
export function resetScribeRuntime(): void {
  cached = undefined;
}

/** The fixture provider instance, when running in fixture mode. */
export function getFixtureProvider(): FixtureScribeProvider | null {
  const deps = getScribeWorkerDeps();
  return deps && deps.provider instanceof FixtureScribeProvider ? deps.provider : null;
}

let interval: ReturnType<typeof setInterval> | null = null;

/**
 * Interval loop for the durable workers (transcription completion +
 * deletion). Single-tick functions are idempotent and DB claiming uses SKIP
 * LOCKED, so overlapping ticks and multiple instances are safe.
 */
export function startScribeWorkers(periodMs = 30_000): void {
  if (interval) return;
  const deps = getScribeWorkerDeps();
  if (!deps) {
    console.log('[scribe] workers not started (no provider available in this mode)');
    return;
  }
  interval = setInterval(() => {
    void runTranscriptionWorkerOnce(deps).catch((e) =>
      console.log(`[scribe] transcription tick error code=${(e as { code?: string }).code ?? 'unknown'}`),
    );
    void runDeletionWorkerOnce(deps).catch((e) =>
      console.log(`[scribe] deletion tick error code=${(e as { code?: string }).code ?? 'unknown'}`),
    );
  }, periodMs);
  const timer = interval as unknown as { unref?: () => void };
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[scribe] workers started period=${periodMs}ms provider=${deps.provider.name}`);
}

export function stopScribeWorkers(): void {
  if (interval) clearInterval(interval);
  interval = null;
}
