import { describe, test, expect } from 'vitest';

/**
 * Deployed-environment fixture refusal (deployment gate hardening).
 *
 * Fixture providers are for local development and CI only. On any deployment
 * platform they must FAIL CLOSED — never silently serve fixture output — and
 * no environment flag opts back in.
 */

import { isDeployedEnvironment } from '../backend/deployment';
import { resolveProvider, scribeMode, ScribeConfigError } from '../backend/scribe/config';
import { resolveLensAi, LensAiConfigError } from '../backend/lens/ai';

const DEPLOYED = { RAILWAY_PROJECT_ID: 'prj_x' } as NodeJS.ProcessEnv;

describe('isDeployedEnvironment', () => {
  test('local by default; any platform marker or explicit override counts as deployed', () => {
    expect(isDeployedEnvironment({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isDeployedEnvironment({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false); // NODE_ENV alone is not a deployment signal here
    for (const key of ['RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_SERVICE_ID', 'RAILWAY_ENVIRONMENT_ID', 'FLY_APP_NAME', 'DEPLOYED_ENVIRONMENT']) {
      expect(isDeployedEnvironment({ [key]: 'x' } as NodeJS.ProcessEnv), key).toBe(true);
    }
  });
});

describe('scribe: fixture refused when deployed', () => {
  test('deployed + fixture mode (default or explicit) → refused, fail closed', () => {
    expect(() => resolveProvider(undefined, DEPLOYED)).toThrow(/not permitted in a deployed environment/);
    expect(() => resolveProvider(undefined, { ...DEPLOYED, SCRIBE_MODE: 'fixture' })).toThrow(ScribeConfigError);
    expect(() => resolveProvider('fixture', { ...DEPLOYED, SCRIBE_MODE: 'fixture' })).toThrow(/not permitted in a deployed environment/);
  });

  test('deployed + SCRIBE_MODE=live with no production provider → still refuses (never falls back to fixture)', () => {
    expect(() => resolveProvider(undefined, { ...DEPLOYED, SCRIBE_MODE: 'live' })).toThrow(/fixture cannot serve live mode/);
  });

  test('local development keeps the fixture provider', () => {
    expect(scribeMode({} as NodeJS.ProcessEnv)).toBe('fixture');
    expect(resolveProvider(undefined, {} as NodeJS.ProcessEnv)).toBe('fixture');
  });

  test('disabled mode: honest "Not configured", fail closed everywhere — local and deployed', () => {
    expect(scribeMode({ SCRIBE_MODE: 'disabled' } as NodeJS.ProcessEnv)).toBe('disabled');
    expect(() => resolveProvider(undefined, { SCRIBE_MODE: 'disabled' })).toThrow(/Not configured/);
    expect(() => resolveProvider(undefined, { ...DEPLOYED, SCRIBE_MODE: 'disabled' })).toThrow(/Not configured/);
    // disabled beats stray provider env: even with full HealthScribe config,
    // nothing resolves.
    expect(() =>
      resolveProvider(undefined, {
        SCRIBE_MODE: 'disabled',
        HEALTHSCRIBE_REGION: 'us-west-2',
        HEALTHSCRIBE_KMS_KEY_ARN: 'arn:x',
        HEALTHSCRIBE_DATA_ACCESS_ROLE_ARN: 'arn:y',
        HEALTHSCRIBE_READINESS_REF: 'r',
      }),
    ).toThrow(/Not configured/);
  });
});

describe('lens AI: fixture refused when deployed', () => {
  test('deployed + fixture mode (default or explicit) → refused', () => {
    expect(() => resolveLensAi(DEPLOYED)).toThrow(/not permitted in a deployed environment/);
    expect(() => resolveLensAi({ ...DEPLOYED, LENS_AI_MODE: 'fixture' })).toThrow(LensAiConfigError);
  });

  test('deployed + live mode → refuses pending approval (never fixture)', () => {
    expect(() => resolveLensAi({ ...DEPLOYED, LENS_AI_MODE: 'live' })).toThrow(/fixture cannot serve live mode/);
    expect(() =>
      resolveLensAi({
        ...DEPLOYED,
        LENS_AI_MODE: 'live',
        LENS_AI_PROVIDER: 'x',
        LENS_AI_MODEL: 'y',
        LENS_AI_APPROVAL_REF: 'z',
      }),
    ).toThrow(/disabled.*pending external approval/i);
  });

  test('local development keeps the fixture identity', () => {
    expect(resolveLensAi({} as NodeJS.ProcessEnv)).toMatchObject({ provider: 'fixture' });
  });

  test('disabled mode: AI assistance is simply off (null, not an error) — local and deployed', () => {
    expect(resolveLensAi({ LENS_AI_MODE: 'disabled' } as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveLensAi({ ...DEPLOYED, LENS_AI_MODE: 'disabled' })).toBeNull();
  });
});
