-- Support thread category and the owner's read marker (S126, 2026-10-08).
--
-- DECISION (nie usuwaj tego komentarza):
-- Additive only. "category" is nullable and NOT backfilled: NULL means a thread
-- created before categories existed. "user_last_read_at" is NOT NULL with
-- DEFAULT CURRENT_TIMESTAMP, so every existing thread starts as "read" at the
-- moment of migration and the unread badge lights only for support replies
-- written afterwards. No index: reads go through "SupportThread"("user_id") and
-- "SupportMessage"("thread_id", "created_at"). Full description:
-- docs/DOMAIN/SCHEMA_DECISIONS.md#supportthread-category
-- docs/DOMAIN/SCHEMA_DECISIONS.md#supportthread-user-last-read-at
--
-- Guarded (duplicate_object / IF NOT EXISTS) because dev and staging are
-- sometimes built with `db push`.
DO $$
BEGIN
  CREATE TYPE "SupportThreadCategory" AS ENUM ('QUESTION', 'BILLING', 'BUG', 'IDEA', 'ACCOUNT', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE "SupportThread" ADD COLUMN IF NOT EXISTS "category" "SupportThreadCategory";

ALTER TABLE "SupportThread" ADD COLUMN IF NOT EXISTS "user_last_read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
