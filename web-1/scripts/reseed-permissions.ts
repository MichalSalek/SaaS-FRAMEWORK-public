/**
 * CLI wrapper: re-seed systemu permissions (role + permissions + mappingi)
 * BEZ restartu backendu.
 *
 * Kiedy uzywac: po zmianie .shared-kernel/application/role-permissions.ts
 * (+ npm run system:kernel) — initializePermissionsSystem normalnie biegnie
 * tylko w instrumentation.ts na boot, a checki RBAC czytaja DB na kazdy
 * request (zero in-memory cache), wiec swiezy seed dziala natychmiast.
 * seedDefaultRolePermissions robi pelna rekoncyliacje (delete + recreate).
 *
 * Usage (zero-config, jak seed-demo-content.ts):
 *   cd web-1 && npm run db:seed:permissions
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── Env bootstrap (MUST run before importing DB_CLIENT) — see seed-demo-content.ts
function bootstrapEnv(): void {
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const envFile = join(webRoot, '.env.development');

  let raw = '';
  try {
    raw = readFileSync(envFile, 'utf8');
  } catch {
    return;
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
  const FALLBACK_PORT = '3200';
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
      // docker unreachable — keep compose-default port.
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
    '--- Re-seed: permissions system (roles + permissions + mappings) ---'
  );

  const { initializePermissionsSystem } =
    await import('../src/application/permissions/permissions.init.js');
  const { DB_CLIENT } = await import('../src/application/db/db.client.js');

  try {
    await DB_CLIENT.use.$connect();
    console.log('DB connected.');
    await initializePermissionsSystem();
    console.log('Permissions re-seeded (full reconciliation).');
  } finally {
    await DB_CLIENT.use.$disconnect();
  }
}

main().catch(err => {
  console.error('Re-seed failed:', err);
  process.exitCode = 1;
});
