/**
 * Bramka seeda demo (wystawa „zamieszkanej" apki). Czysta funkcja, bez IO:
 * decyduje WYŁĄCZNIE z przekazanych wartości, więc jest testowalna bez env.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Seed demo tworzy dziesiątki kont z adresami @example.com, aktywne publiczne
 * profile, pary, wiadomości i zgłoszenia moderacyjne. Na produkcji byłby to
 * fałszywy social proof i śmieci w prawdziwej bazie, dlatego seed ma DWIE
 * NIEZALEŻNE blokady i każda z osobna go zatrzymuje (rzuca, nie „skipuje"):
 *   1. NODE_ENV_MANUAL musi być na allowliście DEVELOPMENT/STAGING. PRODUCTION,
 *      PREVIEW, pusty albo nieznany = odmowa. Allowlista, nie blocklista: nowe
 *      środowisko jest domyślnie zablokowane.
 *   2. Host z DATABASE_URL musi być lokalny (kontener `db` z compose dev i
 *      stagingu, localhost przy uruchomieniu z hosta albo przez tunel). Chroni
 *      przed dryfem, w którym env mówi „DEVELOPMENT", a URL wskazuje Neona
 *      produkcji (znana pułapka: `.env.production.local` to STAGING, CLAUDE.md
 *      „Deployment Gotchas"). Świadomie BEZ furtki env typu ALLOW_*: furtka
 *      ustawiona raz „na chwilę" przeżywa w panelu hostingu, a host bazy
 *      produkcji nigdy nie jest lokalny, więc druga blokada nie potrzebuje
 *      wyjątków.
 * Nie luzować żadnej z nich, żeby „odpalić demo na preview". Preview dzieli
 * infrastrukturę z produkcją.
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

/** Rzuca DemoSeedForbiddenError, gdy którakolwiek z dwóch blokad nie przepuszcza. */
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
 * Decyzja dla seedDemoContent_IO. BOOT (instrumentation) rusza wyłącznie na
 * DEVELOPMENT i każdą odmowę zamienia w pominięcie, bo wyjątek w starcie
 * położyłby backend. CLI (ręczne `db:seed:demo`, jedyna droga na staging)
 * przepuszcza wyjątek, żeby odmowa była głośna.
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
