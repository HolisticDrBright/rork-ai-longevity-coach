/**
 * Scribe provider configuration — the STRICT mode gate (Milestone 1, req 8).
 *
 * Two modes, chosen by SCRIBE_MODE:
 *   'fixture' (default) — deterministic local provider for development and
 *     acceptance testing. It exercises the SAME contracts as production:
 *     signed callbacks, state transitions, retries, deletion confirmation.
 *   'live' — a real transcription provider is REQUIRED. The fixture can never
 *     be selected in live mode (silently or explicitly), and live mode with
 *     nothing but the fixture configured refuses every scribe entry point.
 *
 * An environment flag is NOT proof of compliance: HEALTHSCRIBE_BAA_CONFIRMED
 * is deliberately not read here. Enabling the production adapter requires
 *   (a) full env config below (region, KMS key, data-access role, readiness
 *       record reference), AND
 *   (b) a platform-administrator enablement ROW in provider_enablements
 *       (enabled + region + encryption_config + retention_config +
 *       readiness_ref), enforced inside the begin_recording RPC.
 * Contractual/legal verification (the BAA itself) remains an external,
 * human responsibility; nothing in this codebase asserts it exists.
 */

import { isDeployedEnvironment } from '../deployment';

export type ScribeMode = 'fixture' | 'live';
export type ProviderName = 'fixture' | 'aws_healthscribe';

export interface HealthScribeConfig {
  region: string;
  kmsKeyArn: string;
  dataAccessRoleArn: string;
  readinessRef: string;
}

export class ScribeConfigError extends Error {
  readonly code = 'SCRIBE_CONFIG';
  constructor(message: string) {
    super(message);
    this.name = 'ScribeConfigError';
  }
}

export function scribeMode(env: NodeJS.ProcessEnv = process.env): ScribeMode {
  const raw = (env.SCRIBE_MODE ?? 'fixture').trim().toLowerCase();
  if (raw === 'live') return 'live';
  if (raw === 'fixture' || raw === '') return 'fixture';
  throw new ScribeConfigError(`SCRIBE_MODE must be 'fixture' or 'live' (got '${raw}')`);
}

/** Full production-adapter env config, or null if anything is missing. */
export function healthScribeConfig(env: NodeJS.ProcessEnv = process.env): HealthScribeConfig | null {
  const region = env.HEALTHSCRIBE_REGION?.trim();
  const kmsKeyArn = env.HEALTHSCRIBE_KMS_KEY_ARN?.trim();
  const dataAccessRoleArn = env.HEALTHSCRIBE_DATA_ACCESS_ROLE_ARN?.trim();
  const readinessRef = env.HEALTHSCRIBE_READINESS_REF?.trim();
  if (!region || !kmsKeyArn || !dataAccessRoleArn || !readinessRef) return null;
  return { region, kmsKeyArn, dataAccessRoleArn, readinessRef };
}

/**
 * Resolve which provider a recording may use. Throws ScribeConfigError when
 * the request is not permitted in the current mode:
 *   - live mode + requested fixture           → refused (never silently)
 *   - live mode + healthscribe not configured → refused (env flag ≠ proof)
 *   - fixture mode + requested healthscribe   → refused (live provider needs live mode)
 * The DB enablement row is enforced separately inside begin_recording.
 */
export function resolveProvider(
  requested: ProviderName | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ProviderName {
  const mode = scribeMode(env);
  if (mode === 'live') {
    if (requested === 'fixture') {
      throw new ScribeConfigError('The fixture provider cannot be selected in live mode.');
    }
    if (!healthScribeConfig(env)) {
      throw new ScribeConfigError(
        'Live mode requires a fully configured production provider (region, KMS key, data-access role, readiness record). ' +
          'Only the fixture provider is configured, and the fixture cannot serve live mode.',
      );
    }
    return 'aws_healthscribe';
  }
  if (requested === 'aws_healthscribe') {
    throw new ScribeConfigError('The production provider is only available in live mode.');
  }
  if (isDeployedEnvironment(env)) {
    throw new ScribeConfigError(
      'The fixture scribe provider is not permitted in a deployed environment. ' +
        'Set SCRIBE_MODE=live — scribe endpoints fail closed until a production provider is fully configured and enabled.',
    );
  }
  return 'fixture';
}

/** Shared secret for signing/verifying provider callbacks. Required. */
export function callbackSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.SCRIBE_CALLBACK_SECRET?.trim();
  if (!s || s.length < 16) {
    throw new ScribeConfigError('SCRIBE_CALLBACK_SECRET must be set (min 16 chars) to accept provider callbacks.');
  }
  return s;
}
