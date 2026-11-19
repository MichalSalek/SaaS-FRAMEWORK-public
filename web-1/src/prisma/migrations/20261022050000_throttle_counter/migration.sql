-- Fixed-window abuse counters (SCHEMA_DECISIONS.md#throttle-counter): the magic-link send
-- throttle keeps its per-address budgets here so a deploy or restart does not hand out a fresh
-- daily ceiling. Additive: a new table, no backfill. Keys are hashes, never an address or an IP.
CREATE TABLE IF NOT EXISTS "ThrottleCounter" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThrottleCounter_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "ThrottleCounter_expires_at_idx" ON "ThrottleCounter"("expires_at");
