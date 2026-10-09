-- PostgreSQL extensions required by the Nailfolio schema (LOCAL DEV postgres only).
--
-- Why this lives here (DB layer), not in the app entrypoint:
--   The schema declares GIN trigram indexes (gin_trgm_ops on stylist_account) that REQUIRE
--   pg_trgm. In production the extensions are created by `prisma migrate deploy` running
--   src/prisma/migrations/0_current_baseline/migration.sql (and Neon ships pg_trgm anyway).
--   In DEV the entrypoint uses `prisma db push`, which ignores migrations/ entirely — so the
--   CREATE EXTENSION never runs there. A fresh local `postgres:16` then fails db push with:
--     ERROR: operator class "gin_trgm_ops" does not exist for access method "gin"
--
-- docker-entrypoint-initdb.d/*.sql runs ONCE, on a fresh data volume, BEFORE the app starts —
-- exactly when db push first builds the indexes. Extensions are a property of the database,
-- so they belong to the database container, not to the application bootstrap script.
--
-- SSOT: keep this list in sync with the CREATE EXTENSION block at the top of
-- web-1/src/prisma/migrations/0_current_baseline/migration.sql (the prod/Neon path).
-- pg_stat_statements is also enabled at runtime via `shared_preload_libraries` in
-- docker-compose.dev.yml so the P95 health probe works locally like in prod.

CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
