-- CHECK(>= 0) backstops on the denormalised StylistAccount counters (formerly created at boot by
-- ensure-db-indexes.ts). Prisma cannot express CHECK constraints and `migrate diff` ignores them, so
-- this migration is their only source; verify-db-invariants.ts checks they exist and are VALIDATED.
-- DECISION: added NOT VALID here and validated in the next migration. Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS for CHECK, so each one is looked up in pg_constraint by name on
-- "StylistAccount". Same name and same definition (every database the old boot step reached,
-- production included): left untouched. Same name, different definition: the deploy STOPS, because
-- skipping it would leave a constraint that does not enforce the invariant under the right name;
-- drop or rename it by hand. Definitions are compared normalised (no whitespace, parentheses,
-- quotes, case, trailing NOT VALID), exactly like verify-db-invariants.ts.
-- NOT VALID takes the ACCESS EXCLUSIVE lock only for the catalog change and skips the table scan;
-- the scan runs in the next file under SHARE UPDATE EXCLUSIVE, which does not block writes.
DO $$
DECLARE
  c RECORD;
  existing TEXT;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('ck_stylistaccount_view_count_nonneg', 'view_count'),
      ('ck_stylistaccount_cached_bookmark_count_nonneg', 'cached_bookmark_count'),
      ('ck_stylistaccount_cached_gallery_count_nonneg', 'cached_gallery_count'),
      ('ck_stylistaccount_cached_likes_count_nonneg', 'cached_likes_count')
    ) AS v(conname, colname)
  LOOP
    SELECT pg_get_constraintdef(oid) INTO existing
    FROM pg_constraint
    WHERE conname = c.conname AND conrelid = '"StylistAccount"'::regclass;

    IF existing IS NULL THEN
      EXECUTE format(
        'ALTER TABLE "StylistAccount" ADD CONSTRAINT %I CHECK (%I >= 0) NOT VALID',
        c.conname, c.colname
      );
    ELSIF lower(regexp_replace(regexp_replace(existing, '\s+NOT VALID\s*$', '', 'i'), '[\s()"]', '', 'g'))
          <> ('check' || c.colname || '>=0') THEN
      RAISE EXCEPTION 'Constraint % exists with a different definition: %. Drop or rename it, then deploy again.',
        c.conname, existing;
    END IF;
  END LOOP;
END $$;
