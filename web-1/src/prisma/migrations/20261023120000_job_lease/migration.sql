-- Durable schedule of the periodic jobs (SCHEMA_DECISIONS.md#job-lease): one row per job with its
-- next due time and a fenced lease (owner token + expiry). Every claim, renewal and completion is a
-- single statement, so it holds under PgBouncer transaction pooling, unlike the session-level
-- advisory locks it replaces. Additive: a new table, no backfill (the first claim inserts the row).
CREATE TABLE IF NOT EXISTS "JobLease" (
    "job_name" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ(3),
    "last_started_at" TIMESTAMPTZ(3),
    "last_completed_at" TIMESTAMPTZ(3),
    "last_duration_ms" INTEGER,
    "last_error" TEXT,
    "last_instance" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("job_name")
);
