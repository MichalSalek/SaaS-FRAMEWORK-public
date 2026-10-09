/**
 * CLI wrapper: thin executor dla seedDemoContent_IO.
 *
 * Seed demo-contentu auto-uruchamia sie na kazdy boot przez instrumentation.ts
 * (krok 6.5, DEVELOPMENT-only). Ten skrypt pozostaje do manual triggering bez
 * restartu backendu (pierwsze zasilenie, odswiezenie wystawy po recznym
 * balaganie na kontach demo) i jest JEDYNA droga na STAGING. Produkcja odmawia
 * (dwie blokady: env + lokalny host bazy, demo-content-seeding.guard.ts).
 *
 * Usage (zero-config — self-loads web-1/.env.development i przepisuje
 * docker-internal host `@db:5432` na host-mapped port, jak dev-db-host.mjs):
 *   cd web-1 && npm run db:seed:demo
 *
 * Override DB (CLI env wygrywa nad .env file):
 *   DATABASE_URL=postgresql://<user>:<pass>@<host>:<port>/db?schema=public \
 *     npx tsx scripts/seed-demo-content.ts
 *
 * Staging (baza bez portu na hoscie, procedura: docs/DEPLOYMENT.md §Staging):
 *   NODE_ENV_MANUAL=STAGING DATABASE_URL=postgresql://<user>:<pass>@localhost:<tunel>/db \
 *     npm run db:seed:demo
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── Env bootstrap (MUST run before importing DB_CLIENT) ─────────────────────
// DB_CLIENT initializes the Prisma adapter from ENV_VARS.DATABASE_URL at module
// load, so we hydrate process.env from .env.development FIRST, then
// dynamic-import the seed below. Same pattern as seed-ux-crawl-data.ts.
function bootstrapEnv(): void {
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const envFile = join(webRoot, '.env.development');

  let raw = '';
  try {
    raw = readFileSync(envFile, 'utf8');
  } catch {
    return; // No .env.development — rely on process.env as-is.
  }

  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) {
      continue;
    }
    const key = m[1] as string;
    let val = m[2] as string;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }

  const INTERNAL_HOST = '@db:5432';
  const FALLBACK_PORT = '3200'; // docker-compose.dev.yml maps 3200:5432
  if (process.env.DATABASE_URL?.includes(INTERNAL_HOST)) {
    let hostPort = FALLBACK_PORT;
    try {
      const out = execSync('docker port db 5432/tcp', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const mp = out.split('\n')[0]?.match(/:(\d+)\s*$/);
      if (mp?.[1]) {
        hostPort = mp[1];
      }
    } catch {
      // docker unreachable — keep compose-default port; connect may fail loudly.
    }
    process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
      INTERNAL_HOST,
      `@localhost:${hostPort}`
    );
  }
}

async function main(): Promise<void> {
  bootstrapEnv();

  if (!process.env.DATABASE_URL) {
    throw new Error('Missing DATABASE_URL (env or web-1/.env.development)');
  }

  console.log(
    `--- Seed: demo content (NODE_ENV_MANUAL=${process.env.NODE_ENV_MANUAL ?? '<unset>'}) ---`
  );

  const { seedDemoContent_IO } =
    await import('../src/domain/admin/operations/demo-content-seeding.operations.js');
  const { DB_CLIENT } = await import('../src/application/db/db.client.js');
  const { ENV_VARS } =
    await import('../src/application/environment/environment.config.js');
  const { assertDemoSeedAllowed } =
    await import('../src/domain/admin/operations/demo-content-seeding.guard.js');

  // Fail fast PRZED połączeniem z bazą; ta sama bramka stoi w seedDemoContent_IO.
  const gate = assertDemoSeedAllowed({
    nodeEnvManual: ENV_VARS.NODE_ENV_MANUAL,
    databaseUrl: ENV_VARS.DATABASE_URL,
  });
  console.log(`Guard OK: env=${gate.env}, db host=${gate.dbHost}`);

  try {
    await DB_CLIENT.use.$connect();
    console.log('DB connected.');

    const result = await seedDemoContent_IO({ trigger: 'CLI' });
    console.log(`Result: ${result.success ? 'OK' : 'FAIL'}`);
    console.log(`Message: ${result.message}`);
    if (!result.success) {
      process.exitCode = 1;
    }
  } finally {
    await DB_CLIENT.use.$disconnect();
  }
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
