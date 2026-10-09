// Re-injects the CREATE EXTENSION block into the regenerated baseline migration.
//
// `prisma migrate diff` does NOT emit PostgreSQL extensions (they live outside
// schema.prisma), so every `db:create:baseline` regen would otherwise DROP them.
// The baseline declares GIN trigram indexes (gin_trgm_ops) that REQUIRE pg_trgm, so
// a fresh non-Neon Postgres deploy via `prisma migrate deploy` (staging / self-hosted)
// would fail without these. Neon ships pg_trgm anyway, which is why prod has masked
// this — but the prod/Neon path documented in docker/postgres/initdb.d/01-extensions.sql
// explicitly expects this block at the TOP of migration.sql. This script makes the
// regen self-sufficient so the block is never silently lost again.
//
// SSOT for the extension list: docker/postgres/initdb.d/01-extensions.sql.
import { readFileSync, writeFileSync } from 'node:fs';

const PATH = 'src/prisma/migrations/0_current_baseline/migration.sql';
const MARKER = 'CREATE SCHEMA IF NOT EXISTS "public";';
const BLOCK = `
-- CreateExtensions (re-injected by scripts/prepend-baseline-extensions.mjs after every regen).
-- prisma migrate diff omits extensions (they live outside schema.prisma); the GIN trigram
-- indexes below REQUIRE pg_trgm. SSOT for this list: docker/postgres/initdb.d/01-extensions.sql.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
`;

const sql = readFileSync(PATH, 'utf8');

if (sql.includes('CREATE EXTENSION IF NOT EXISTS "pg_trgm"')) {
  console.log('[baseline-extensions] already present — skip');
  process.exit(0);
}
if (!sql.includes(MARKER)) {
  console.error(
    `[baseline-extensions] CREATE SCHEMA marker not found — aborting, baseline left unchanged`
  );
  process.exit(1);
}

writeFileSync(PATH, sql.replace(MARKER, MARKER + '\n' + BLOCK));
console.log(
  '[baseline-extensions] injected pg_trgm + pg_stat_statements after CREATE SCHEMA'
);
