-- Validates the counter CHECKs added NOT VALID by the previous migration. Separate file on
-- purpose: each DO block is one statement and therefore one transaction, so the scan here never
-- runs under the ACCESS EXCLUSIVE lock of ADD CONSTRAINT. This holds whatever the runner does with
-- a multi-statement file (Prisma 7.10.0 sends each statement in autocommit, measured by
-- npm run db:test:invariants).
-- Already validated constraints are skipped. A negative counter makes VALIDATE fail and the deploy
-- stop (exit 30 in migrate-deploy.sh). Recovery: fix the rows. `npm run db:backfill:cached-counts`
-- recomputes ONLY cached_bookmark_count, cached_gallery_count and cached_likes_count from their
-- source tables; view_count has no source, so floor it by hand
-- (UPDATE "StylistAccount" SET view_count = 0 WHERE view_count < 0). Then
-- `prisma migrate resolve --rolled-back 20261023100100_stylist_account_counter_checks_validate`
-- and deploy again. The constraint stays NOT VALID meanwhile and still rejects new negative writes.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = '"StylistAccount"'::regclass
      AND contype = 'c'
      AND NOT convalidated
      AND conname IN (
        'ck_stylistaccount_view_count_nonneg',
        'ck_stylistaccount_cached_bookmark_count_nonneg',
        'ck_stylistaccount_cached_gallery_count_nonneg',
        'ck_stylistaccount_cached_likes_count_nonneg'
      )
  LOOP
    EXECUTE format('ALTER TABLE "StylistAccount" VALIDATE CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
