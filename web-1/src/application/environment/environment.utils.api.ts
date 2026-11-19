import { ENV_VARS } from './environment.config';

export const buildFrontendBaseUrl = (): string => {
  // DECISION: FRONTEND_PUBLIC_DOMAIN may be a comma-separated list in dev (e.g.
  // "localhost, 192.168.0.10:3000" for LAN access). Take the FIRST entry, trimmed (parity with
  // buildTestOrigin in smoke-tests-runner.ts); the multi-value string produced a malformed
  // redirect Location (e.g. on the email-unsubscribe GET). Prod has a single domain, so no-op.
  const domain = (
    (ENV_VARS.FRONTEND_PUBLIC_DOMAIN || 'nailfolio.app').split(',')[0] ??
    'nailfolio.app'
  ).trim();
  const port = ENV_VARS.FRONTEND_PUBLIC_PORT;
  return port ? `https://${domain}:${port}` : `https://${domain}`;
};

export const IS_DEVELOPMENT_ENV = (): boolean =>
  ENV_VARS.NODE_ENV_MANUAL?.toUpperCase() === 'DEVELOPMENT';

export const IS_PRODUCTION_ENV = (): boolean =>
  ENV_VARS.NODE_ENV_MANUAL?.toUpperCase() === 'PRODUCTION';

/**
 * Canonical environment modes. SSOT of the allowed values is the env-schema
 * enum (`env-schema.ts` → NODE_ENV_MANUAL enum: DEVELOPMENT/STAGING/PRODUCTION);
 * this union mirrors it for the typed accessor below. `UNKNOWN` is the explicit
 * sentinel for the (boot-validated-away, but type-reachable) case where the var
 * is absent.
 */
export type EnvironmentMode =
  'DEVELOPMENT' | 'STAGING' | 'PRODUCTION' | 'UNKNOWN';

const ENVIRONMENT_MODES: readonly EnvironmentMode[] = [
  'DEVELOPMENT',
  'STAGING',
  'PRODUCTION',
];

/**
 * Return the active environment as a stable enum value — NEVER a diagnostic
 * string.
 *
 * DECISION: returns a stable enum value, never a diagnostic string. A diagnostic string leaked
 * into every EventLog `environment` column (via reportIssueBackend) and the admin /health
 * payload, where it could not be filtered or grouped. ENV_VARS upper-cases NODE_ENV_MANUAL and
 * env-schema validates it against {DEVELOPMENT,STAGING,PREVIEW,PRODUCTION} at boot, so `UNKNOWN`
 * is an explicit sentinel for the type-reachable gap.
 */
export const getEnvironmentMode = (): EnvironmentMode => {
  const mode = ENV_VARS.NODE_ENV_MANUAL;
  return ENVIRONMENT_MODES.includes(mode as EnvironmentMode)
    ? (mode as EnvironmentMode)
    : 'UNKNOWN';
};
