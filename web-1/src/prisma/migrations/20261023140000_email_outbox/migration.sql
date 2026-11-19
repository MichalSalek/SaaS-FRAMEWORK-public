-- Durable send intent for important account and billing mail (SCHEMA_DECISIONS.md#email-outbox):
-- outbox rows live on the existing lifecycle ledger. Additive: nullable or defaulted columns (constant
-- defaults are metadata-only in Postgres 11+) and one index on a small table; no backfill, existing rows
-- stay outbox=false and keep their current behaviour.
-- AlterTable
ALTER TABLE "EmailLifecycleMessage" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deadLetteredAt" TIMESTAMP(3),
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "outbox" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "outboxPayload" JSONB;

-- CreateIndex
CREATE INDEX "EmailLifecycleMessage_outbox_status_nextAttemptAt_idx" ON "EmailLifecycleMessage"("outbox", "status", "nextAttemptAt");
