-- Index on StylistAccount.subscription_id for the Stripe lookups by subscription id
-- (orphan-subscription scan, cancel-reconcile paid-owner guard). See
-- Deliberately plain CREATE INDEX, NOT CONCURRENTLY: `prisma migrate deploy` runs the
-- migration file inside ONE transaction and CREATE INDEX CONCURRENTLY cannot run in a
-- transaction (build_failed on Render, lesson 2026-07-19). The table is small, so the
-- write lock lasts milliseconds. IF NOT EXISTS keeps it idempotent for a dev database
-- that already received the index through `db push`.
-- Deliberately NOT unique: the code never assumes one account per subscription
-- (findFirst, not findUnique), and existing rows cannot be proven free of duplicates.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StylistAccount_subscription_id_idx" ON "StylistAccount"("subscription_id");
