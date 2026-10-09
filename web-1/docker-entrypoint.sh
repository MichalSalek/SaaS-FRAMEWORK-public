#!/bin/sh
set -e

# ============================================================================
# web-1 container entrypoint — pure bootstrap ORCHESTRATION (dev + prod).
#
# Design contract: this script ONLY orchestrates generic startup steps. It holds
# no domain knowledge of its own — specifics live where they belong:
#   • Which PostgreSQL extensions the schema needs → the DATABASE layer:
#       dev  = docker/postgres/initdb.d/01-extensions.sql
#       prod = src/prisma/migrations/0_current_baseline/migration.sql (+ Neon built-ins)
#   • Which schema / which database to apply       → prisma.config.mjs + db:* npm scripts
#
# Each step below is a small, named, self-documenting function. Keep it that way:
# new specifics belong in the schema, migrations, or app code — not in this file.
# ============================================================================

echo "🚀 Starting web-1 container..."

# Block until the primary database accepts TCP connections.
# Parses host/port from DATABASE_URL (Neon may omit the explicit :5432).
wait_for_database() {
  echo "⏳ Waiting for database..."
  DB_HOST=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
  DB_PORT=$(echo "$DATABASE_URL" | sed -n 's|.*@[^:/]*:\([0-9]*\)/.*|\1|p')
  DB_PORT="${DB_PORT:-5432}"
  echo "   DB_HOST=$DB_HOST DB_PORT=$DB_PORT"

  # 60 x 2s = 120s budget: on reboot, `restart:always` brings containers back WITHOUT
  # compose depends_on ordering, so web-1 can race ahead of a cold staging-db on a
  # loaded VM. A generous wait avoids a crash/restart flap before Postgres accepts.
  retries=0
  while ! nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
    retries=$((retries + 1))
    if [ "$retries" -ge 60 ]; then
      echo "❌ Database not accessible after 60 attempts"
      exit 1
    fi
    echo "   Database not ready, retrying in 2s... ($retries/60)"
    sleep 2
  done
  echo "✅ Database is ready"
}

# Apply the Prisma schema. Idempotent on every start. DEVELOPMENT uses `db push`
# (fast local iteration; schema.prisma is the SSOT). STAGING/PREVIEW/PRODUCTION use
# `migrate deploy` — the baseline (0_current_baseline) was REGENERATED to match
# schema.prisma (2026-06-24), so migrate deploy applies the full current schema on a
# fresh DB (with a baseline-resolve fallback for a DB that already has the schema).
# The local-host guard below still blocks `db push --accept-data-loss` from ever
# firing against a cloud DB (only the DEVELOPMENT/empty branch reaches it).
apply_schema() {
  if [ "$NODE_ENV_MANUAL" = "DEVELOPMENT" ] || [ -z "$NODE_ENV_MANUAL" ]; then
    # SAFETY GUARD: `db push --accept-data-loss` silently drops columns/tables to
    # match schema.prisma — catastrophic against a managed cloud DB. It is ONLY for
    # disposable local dev/staging databases. Refuse unless DATABASE_URL is a local
    # host: the prod compose env_file can still carry a real Neon URL, so one missing
    # `-f docker-compose.staging.yml` would otherwise aim this push at the cloud DB.
    _dbhost=$(echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p')
    case "$_dbhost" in
      db|localhost|127.0.0.1|postgres|*.local|10.*|192.168.*|172.1[6-9].*|172.2[0-9].*|172.3[0-1].*) : ;;
      *)
        echo "❌ REFUSING destructive 'db push --accept-data-loss' against non-local DB host '$_dbhost'."
        echo "   DATABASE_URL=$DATABASE_URL"
        echo "   The DEVELOPMENT/STAGING branch is for disposable LOCAL databases only."
        exit 1
        ;;
    esac
    echo "🔨 Applying schema via db push (${NODE_ENV_MANUAL:-DEVELOPMENT})..."
    npx prisma db push --accept-data-loss --schema=./src/prisma/schema.prisma --url="$DATABASE_URL"
  else
    echo "📦 Applying schema via migrate deploy (${NODE_ENV_MANUAL})..."
    DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy --schema=./src/prisma/schema.prisma || {
      echo "⚠️  migrate deploy failed — attempting baseline resolve..."
      DATABASE_URL="$DATABASE_URL" npx prisma migrate resolve --applied 0_current_baseline --schema=./src/prisma/schema.prisma 2>&1 || true
      DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy --schema=./src/prisma/schema.prisma
    }
  fi
  echo "✅ Schema applied"
}

# Ensure the SEPARATE App Logs database (its own Neon instance, model AppLogRecord)
# has its table before the app writes the first log line. Best-effort by design:
# the logs store is non-critical, so a missing/unhealthy logs DB must never block
# backend startup. Table create = idempotent via a to_regclass guard. Indexes =
# UNCONDITIONAL `CREATE INDEX IF NOT EXISTS` on every start (there is no
# `migrate deploy` for this schema, so schema.prisma @@index additions reach an
# EXISTING prod DB only through this step). Skipped when unconfigured.
ensure_app_logs_schema() {
  [ -n "$DATABASE_APP_LOGS_URL" ] || return 0
  echo "🔍 Ensuring App Logs Store schema (AppLogRecord)..."
  node -e '
    const { Client } = require("pg");
    const fs = require("fs");
    (async () => {
      const c = new Client({ connectionString: process.env.DATABASE_APP_LOGS_URL });
      await c.connect();
      const { rows } = await c.query("SELECT to_regclass(\x27public.\"AppLogRecord\"\x27) AS t");
      if (!rows[0].t) {
        const sql = fs.readFileSync("./src/prisma-app-logs/migrations/0_current_baseline/migration.sql", "utf8");
        await c.query(sql);
        console.log("✅ App Logs Store schema created");
      } else {
        console.log("✅ App Logs Store schema already present");
      }
      // DECISION (nie usuwaj tego komentarza):
      // App-logs deploy convention = baseline-only + entrypoint (JEDEN folder
      // 0_current_baseline, ZERO `migrate deploy` na starcie dla tego schematu).
      // Nowe indeksy schema.prisma NIE dotra na istniejaca prod-DB przez baseline
      // (baseline SQL odpala sie tylko gdy tabela NIEOBECNA). Dlatego ten krok jest
      // BEZWARUNKOWY (biegnie na kazdy start, dla obu galezi fresh/present) i
      // idempotentny (IF NOT EXISTS). Nazwy indeksow = DOKLADNIE te generowane
      // przez Prisma z @@index (AppLogRecord_<kol>_..._idx), zeby introspekcja ORM
      // widziala je jako in-sync i `migrate diff`/`db pull` nie proponowaly zmian.
      await c.query(
        "CREATE INDEX IF NOT EXISTS \"AppLogRecord_application_created_at_idx\" ON \"AppLogRecord\" (\"application\", \"created_at\" DESC)"
      );
      await c.query(
        "CREATE INDEX IF NOT EXISTS \"AppLogRecord_created_at_idx\" ON \"AppLogRecord\" (\"created_at\")"
      );
      console.log("✅ App Logs Store created_at indexes ensured");
      await c.end();
    })().catch((e) => { console.error("⚠️  App Logs Store schema sync skipped:", e.message); process.exit(0); });
  ' || true
}

# Turbopack (next dev) can't resolve a tsconfig `extends` that points above the
# project root (/app in the container). Inline the mounted base config so dev
# builds resolve compiler options. No-op when the base file isn't mounted (prod).
prepare_tsconfig() {
  [ -f "/tsconfig.base.json" ] || return 0
  node -e "
    const fs = require('fs');
    const base = JSON.parse(fs.readFileSync('/tsconfig.base.json', 'utf8'));
    const local = JSON.parse(fs.readFileSync('/app/tsconfig.json', 'utf8'));
    delete local.extends;
    local.compilerOptions = {...base.compilerOptions, ...local.compilerOptions};
    fs.writeFileSync('/app/tsconfig.json', JSON.stringify(local, null, 2));
  " && echo "✅ tsconfig.base.json inlined for Turbopack"
}

wait_for_database
apply_schema
ensure_app_logs_schema

echo "🔧 Generating Prisma Client..."
npx prisma generate --schema=./src/prisma/schema.prisma

prepare_tsconfig

echo "🎯 Starting application..."
exec "$@"
