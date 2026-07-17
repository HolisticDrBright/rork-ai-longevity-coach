/**
 * Deployed-environment detection (deployment gate hardening).
 *
 * FIXTURE providers exist for local development and CI only. In a deployed
 * environment they must FAIL CLOSED rather than silently serving production
 * traffic — no environment flag can opt back in. Detection is deliberately
 * broad: any platform-injected variable (Railway, Fly) or the operator's own
 * DEPLOYED_ENVIRONMENT marker counts as deployed.
 *
 * NODE_ENV is NOT used here: this backend defaults NODE_ENV to "production"
 * even for local runs, so it cannot distinguish a laptop from Railway.
 */
export function isDeployedEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.RAILWAY_PROJECT_ID ||
      env.RAILWAY_ENVIRONMENT_NAME ||
      env.RAILWAY_SERVICE_ID ||
      env.RAILWAY_ENVIRONMENT_ID ||
      env.FLY_APP_NAME ||
      env.DEPLOYED_ENVIRONMENT,
  );
}
