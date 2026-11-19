/**
 * Demo seed gate. Pure function with no IO: decides only from the passed values, so it is testable
 * without env.
 *
 * DECISION: the demo seed creates dozens of @example.com accounts, public profiles, pairs, messages and
 * reports; on production that is fake social proof and junk. Two independent locks, each one throws:
 *   1. NODE_ENV_MANUAL must be on the DEVELOPMENT/STAGING allowlist (a new environment is blocked by
 *      default).
 *   2. The DATABASE_URL host must be local (compose `db`, localhost, tunnel). Guards against env saying
 *      DEVELOPMENT while the URL points at production Neon (`.env.production.local` is STAGING).
 *      Deliberately no ALLOW_* env escape: one set "for a moment" survives in the hosting panel.
 * Do not loosen either to run the demo on preview: preview shares infrastructure with production.
 */

export const DEMO_SEED_ALLOWED_ENVS: readonly string[] = Object.freeze([
  'DEVELOPMENT',
  'STAGING',
]);

export const DEMO_SEED_ALLOWED_DB_HOSTS: readonly string[] = Object.freeze([
  'db',
  'localhost',
  '127.0.0.1',
  '::1',
  'host.docker.internal',
]);

export class DemoSeedForbiddenError extends Error {
  constructor(reason: string) {
    super(`Demo seed refused: ${reason}`);
    this.name = 'DemoSeedForbiddenError';
  }
}

const parseDbHost = (databaseUrl: string): string | null => {
  try {
    // URL() strips the brackets of an IPv6 literal only in `hostname`.
    return new URL(databaseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return null;
  }
};

/** Throws DemoSeedForbiddenError when either of the two locks refuses. */
export const assertDemoSeedAllowed = ({
  nodeEnvManual,
  databaseUrl,
}: {
  nodeEnvManual: string | undefined;
  databaseUrl: string | undefined;
}): { env: string; dbHost: string } => {
  const env = (nodeEnvManual ?? '').trim().toUpperCase();
  if (!DEMO_SEED_ALLOWED_ENVS.includes(env)) {
    throw new DemoSeedForbiddenError(
      `NODE_ENV_MANUAL="${env || '<empty>'}" is not one of ${DEMO_SEED_ALLOWED_ENVS.join('/')}`
    );
  }

  const dbHost = databaseUrl ? parseDbHost(databaseUrl) : null;
  if (!dbHost) {
    throw new DemoSeedForbiddenError('DATABASE_URL is missing or unparseable');
  }
  if (!DEMO_SEED_ALLOWED_DB_HOSTS.includes(dbHost)) {
    throw new DemoSeedForbiddenError(
      `database host "${dbHost}" is not a local host (${DEMO_SEED_ALLOWED_DB_HOSTS.join(', ')})`
    );
  }

  return { env, dbHost };
};

/**
 * Gate decision for seedDemoContent_IO. BOOT (instrumentation) runs only on
 * DEVELOPMENT and turns every refusal into a skip, because a throw during
 * startup would take the backend down. The CLI (manual `db:seed:demo`, the
 * only path on staging) lets the exception through so the refusal is loud.
 */
export const resolveDemoSeedGate = ({
  trigger,
  nodeEnvManual,
  databaseUrl,
}: {
  trigger: 'BOOT' | 'CLI';
  nodeEnvManual: string | undefined;
  databaseUrl: string | undefined;
}): { run: true } | { run: false; reason: string } => {
  if (
    trigger === 'BOOT' &&
    (nodeEnvManual ?? '').trim().toUpperCase() !== 'DEVELOPMENT'
  ) {
    return {
      run: false,
      reason: 'demo content auto-seeds on DEVELOPMENT only',
    };
  }
  try {
    assertDemoSeedAllowed({ nodeEnvManual, databaseUrl });
    return { run: true };
  } catch (error) {
    if (trigger === 'CLI' || !(error instanceof DemoSeedForbiddenError)) {
      throw error;
    }
    return { run: false, reason: error.message };
  }
};
