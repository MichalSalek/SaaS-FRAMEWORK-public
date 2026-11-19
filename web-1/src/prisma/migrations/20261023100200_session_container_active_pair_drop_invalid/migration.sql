-- Prepares the name "session_container_active_pair_uq" for the next migration, which builds it
-- CONCURRENTLY with IF NOT EXISTS. IF NOT EXISTS checks only the NAME, so two states are handled here:
--   1. INVALID index (an interrupted CREATE INDEX CONCURRENTLY, pg_index.indisvalid = false): not
--      used for reads, uniqueness not guaranteed. Dropped, so the next file rebuilds it.
--   2. VALID index with another definition (other table, columns, predicate, or not unique): the
--      deploy STOPS; IF NOT EXISTS would otherwise keep it and SC-2 would be unenforced under the
--      right name. Drop it by hand (DROP INDEX CONCURRENTLY) and deploy again.
-- A valid index with the expected definition (every database the old boot step reached,
-- production included) is left alone. The predicate is compared normalised (lower case, no
-- quotes, casts, whitespace, parentheses), exactly like verify-db-invariants.ts.
-- Plain DROP INDEX (not CONCURRENTLY: it sits inside a DO block); dropping an invalid index takes a
-- short ACCESS EXCLUSIVE lock and no table scan.
DO $$
DECLARE
  idx RECORD;
BEGIN
  SELECT
    i.indisvalid,
    i.indisunique,
    t.relname AS table_name,
    ARRAY(
      SELECT coalesce(a.attname::text, '')
      FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
      LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      ORDER BY k.ord
    ) AS columns,
    regexp_replace(
      regexp_replace(replace(lower(coalesce(pg_get_expr(i.indpred, i.indrelid), '')), '"', ''),
        '::[a-z_]+(\[\])?', '', 'g'),
      '[\s()]', '', 'g') AS predicate
  INTO idx
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_class t ON t.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'session_container_active_pair_uq'
    AND n.nspname = current_schema();

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT idx.indisvalid THEN
    DROP INDEX "session_container_active_pair_uq";
  ELSIF NOT idx.indisunique
     OR idx.table_name <> 'SessionContainer'
     OR idx.columns <> ARRAY['client_account_id', 'stylist_account_id']
     OR idx.predicate <> 'lifecycle_state<>allarray[''closed'',''expired'']andstylist_account_idisnotnull' THEN
    RAISE EXCEPTION 'Index session_container_active_pair_uq exists with a different definition (table %, columns %, predicate %). Drop it by hand, then deploy again.',
      idx.table_name, idx.columns, idx.predicate;
  END IF;
END $$;
