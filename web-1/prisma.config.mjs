// prisma.config.mjs (NIE .ts) — celowo czysty JS ESM.
// Prisma 7 laduje config przez c12+jiti. jiti transpiluje .ts; na Render (Node 24.18)
// ta transpilacja wywalala sie z "Failed to parse syntax of config file" (lokalnie
// Node 24.15 dziala — roznica patcha Node). .mjs = natywny ESM, ZERO transpilacji TS,
// parsuje sie identycznie wszedzie. Datasource.url MUSI byc tu, bo schema.prisma ma
// w datasource tylko `provider` (brak `url`). Skrypty package.json daja --schema jawnie.
// DECISION (nie usuwaj tego komentarza):
// Ten jeden config obsługuje OBA schematy, a Prisma 7 bierze URL bazy wyłącznie
// stąd. Bez przełącznika każdy skrypt `*:logs` (status, migrate deploy, db push,
// a nawet `migrate reset --force`) szedł w bazę GŁÓWNĄ: `db:reset:logs` by ją
// wyczyścił, a `db:status:logs` pokazywał migracje głównego schematu jako obce
// (S122). Schemat logów rozpoznajemy po ścieżce `--schema` w argv CLI.
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

// DECISION (nie usuwaj tego komentarza):
// Prisma CLI (migrate deploy / generate / studio) MUSI laczyc sie DIRECT
// (unpooled), NIE przez Neon PgBouncer pooler. `migrate deploy` bierze
// session-level advisory lock (pg_advisory_lock(72707369)); nad transaction-mode
// poolerem ten lock bywa nieuwalniany / reassignowany miedzy server-backendami,
// wiec kolejny build timeout'uje P1002 "Timed out acquiring advisory lock" (10s)
// INTERMITTENTNIE (Render build_failed przy pooler contention / cold-start).
// Neon direct endpoint = po prostu host BEZ sufiksu `-pooler`. Runtime (PrismaPg
// adapter, ENV_VARS.DATABASE_URL w prisma.adapter.ts) ZOSTAJE na poolerze — ten
// config jest CLI-only (runtime go nie importuje). Jawny DIRECT_DATABASE_URL ma
// pierwszenstwo (gdyby owner ustawil go na Render); lokalny dev URL nie ma
// `-pooler`, wiec replace = no-op (bezpieczne we wszystkich srodowiskach).
// DIRECT_DATABASE_URL opisuje bazę główną, więc dla logów nie ma zastosowania.
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
