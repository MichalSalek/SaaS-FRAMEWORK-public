#!/usr/bin/env node
// scripts/dev-db-host.mjs
//
// Run a db npm-script against the docker-compose dev Postgres FROM THE WSL2 HOST.
//
// Why: the backend inside the `web-1-dev` container reaches Postgres at the compose
// service hostname `db:5432`, but from the host that hostname does not resolve, and
// `docker exec` is broken on WSL2 (setns / "fork/exec /proc/self/fd/6"). So the usual
// `db:*` and `db:*:docker` scripts fail from the host.
//
// This wrapper loads .env.development, rewrites the DATABASE_URL host from the
// docker-internal `db:5432` to the host-mapped port (resolved dynamically via
// `docker port db`, fallback 3200 per docker-compose.dev.yml `ports: "3200:5432"`),
// then runs the passed npm script (e.g. db:status) with that patched env. Prisma reads
// DATABASE_URL from process.env (precedence over .env files), so the override wins.
//
// Usage: node scripts/dev-db-host.mjs <npm-script>   (e.g. db:status, db:studio)

import { readFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(webRoot, '.env.development');
const INTERNAL_HOST = '@db:5432';
const FALLBACK_PORT = '3200';

const script = process.argv[2];
if (!script) {
  console.error(
    'Usage: node scripts/dev-db-host.mjs <npm-script>  (e.g. db:status, db:studio, db:push:safe)'
  );
  process.exit(1);
}

// 1. Parse .env.development (KEY=VALUE, strip quotes, skip comments/blanks).
const envVars = {};
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (!m) continue;
  let val = m[2];
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  envVars[m[1]] = val;
}

// 2. Resolve the host-mapped port for the `db` container (dynamic; fallback to compose default).
let hostPort = FALLBACK_PORT;
try {
  const out = execSync('docker port db 5432/tcp', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const mp = out.split('\n')[0].match(/:(\d+)\s*$/);
  if (mp) hostPort = mp[1];
} catch {
  // docker not reachable — keep the compose-default port; the command will surface
  // a connection error if the dev DB is actually down.
}

// 3. Rewrite only the docker-internal DATABASE_URL host -> host-reachable localhost:<port>.
//    (Remote URLs such as DATABASE_APP_LOGS_URL = Neon are already host-reachable; untouched.)
if (envVars.DATABASE_URL && envVars.DATABASE_URL.includes(INTERNAL_HOST)) {
  envVars.DATABASE_URL = envVars.DATABASE_URL.replace(
    INTERNAL_HOST,
    `@localhost:${hostPort}`
  );
}

console.error(`[dev-db-host] dev DB -> localhost:${hostPort}  |  npm run ${script}`);

// 4. Run the target npm script with the patched env.
const res = spawnSync('npm', ['run', script], {
  cwd: webRoot,
  env: { ...process.env, ...envVars },
  stdio: 'inherit',
});
process.exit(res.status ?? 1);
