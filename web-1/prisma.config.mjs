// prisma.config.mjs (not .ts) on purpose: plain ESM JavaScript.
// Prisma 7 loads the config through c12+jiti. jiti transpiles .ts, and on Render (Node 24.18) that
// transpilation failed with "Failed to parse syntax of config file" (fine on local Node 24.15).
// .mjs is native ESM with zero TS transpilation. The datasource URL MUST live here because
// schema.prisma has only `provider` in its datasource; package.json scripts pass --schema explicitly.
// DECISION: this one config serves BOTH schemas and Prisma 7 takes the database URL only from here.
// Without the switch every `*:logs` script (status, migrate deploy, db push, even
// `migrate reset --force`) hit the MAIN database. The logs schema is recognised by the `--schema`
// path in the CLI argv.
const targetsLogsSchema = process.argv.some(arg =>
  arg.includes('prisma-app-logs')
);
const urlVariable = targetsLogsSchema
  ? 'DATABASE_APP_LOGS_URL'
  : 'DATABASE_URL';
const databaseUrl = process.env[urlVariable];
if (!databaseUrl) {
  throw new Error(`${urlVariable} environment variable is required`);
}

// DECISION: the Prisma CLI (migrate deploy / generate / studio) MUST connect DIRECT (unpooled), never
// through the Neon PgBouncer pooler. `migrate deploy` takes a session-level advisory lock
// (pg_advisory_lock(72707369)); over a transaction-mode pooler it can be left unreleased or moved
// between server backends, so a later build intermittently times out with P1002 (Render build_failed).
// The direct endpoint is the same host without the `-pooler` suffix. Runtime (PrismaPg adapter in
// prisma.adapter.ts) stays on the pooler; this config is CLI-only. An explicit DIRECT_DATABASE_URL
// wins but describes the main database only, so it is ignored for logs. A local URL has no
// `-pooler`, so the replace is a no-op there.
const directDatabaseUrl =
  (targetsLogsSchema ? undefined : process.env.DIRECT_DATABASE_URL) ??
  databaseUrl.replace('-pooler', '');

const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL;

export default {
  schema: 'src/prisma/schema.prisma',
  datasource: {
    url: directDatabaseUrl,
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
};
