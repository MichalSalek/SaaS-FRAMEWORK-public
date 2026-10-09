import { ENV_VARS } from './environment.config';

const resolveManualEnv = () => {
  const fallback = process.env.NODE_ENV ?? 'development';
  return (ENV_VARS.NEXT_PUBLIC_NODE_ENV_MANUAL ?? fallback)
    .toString()
    .trim()
    .toUpperCase();
};

export const IS_DEVELOPMENT_ENV = (): boolean =>
  resolveManualEnv() === 'DEVELOPMENT';

const IS_PRODUCTION_ENV = (): boolean => resolveManualEnv() === 'PRODUCTION';

const IS_STAGING_ENV = (): boolean => resolveManualEnv() === 'STAGING';

/**
 * Dev-only routes under /dev/* are reachable on DEVELOPMENT and STAGING only.
 * PREVIEW behaves like production (gated out); PRODUCTION is obviously gated out.
 * Evaluated at build time via NEXT_PUBLIC_NODE_ENV_MANUAL (per-deployment build).
 */
export const ARE_DEV_ROUTES_ENABLED = (): boolean =>
  IS_DEVELOPMENT_ENV() || IS_STAGING_ENV();

/** Whether the Google/Apple social-login buttons are surfaced (NEXT_PUBLIC_OAUTH_ENABLED). */
export const IS_OAUTH_ENABLED = (): boolean =>
  ENV_VARS.NEXT_PUBLIC_OAUTH_ENABLED === true;

export const getEnvironmentMode = () =>
  ENV_VARS.NEXT_PUBLIC_NODE_ENV_MANUAL ??
  process.env.NODE_ENV ??
  'NODE_ENV_MANUAL-not-provided';

declare global {
  interface Window {
    ENV_VARS: typeof ENV_VARS;
  }
}

if (!IS_PRODUCTION_ENV()) {
  typeof window !== 'undefined' &&
    (() => {
      window.ENV_VARS = ENV_VARS;
    })();
}
