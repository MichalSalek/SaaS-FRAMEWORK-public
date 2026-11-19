import { DB_CLIENT } from '@app/db/db.client';

// DECISION: the structural backstops Prisma cannot express (a partial unique index and CHECK
// constraints) are created ONLY by versioned migrations in src/prisma/migrations
// (20261023100000..20261023100300). The application never runs DDL for them: this module is a
// read-only catalog check, safe for a role without DDL rights. Re-adding a boot-time CREATE/ALTER
// brings back schema that exists outside the migration history (review finding F7).
// `migrate diff` and `db push` ignore both object kinds, so "no drift" never proves they exist;
// this check does, by DEFINITION and not by name: a same-named object that enforces something
// else is reported as `definition_mismatch`. The migrations apply the same normalisation in SQL
// (20261023100000 and 20261023100200 stop the deploy on a mismatch).

/** SC-2 (DOMAIN_SSOT §3.2): at most one non-terminal session per client/stylist pair. */
export const SESSION_CONTAINER_ACTIVE_PAIR_INDEX =
  'session_container_active_pair_uq';

/** Expected shape of the SC-2 index: table, key columns in order, normalised predicate. */
export const SESSION_CONTAINER_ACTIVE_PAIR_SPEC = {
  table: 'SessionContainer',
  columns: ['client_account_id', 'stylist_account_id'],
  predicate:
    "lifecycle_state<>allarray['closed','expired']andstylist_account_idisnotnull",
} as const;

/** CHECK(>= 0) backstops on the denormalised StylistAccount counters, by constraint name. */
export const STYLIST_ACCOUNT_COUNTER_CHECK_COLUMNS = {
  ck_stylistaccount_view_count_nonneg: 'view_count',
  ck_stylistaccount_cached_bookmark_count_nonneg: 'cached_bookmark_count',
  ck_stylistaccount_cached_gallery_count_nonneg: 'cached_gallery_count',
  ck_stylistaccount_cached_likes_count_nonneg: 'cached_likes_count',
} as const;

export type StylistAccountCounterCheck =
  keyof typeof STYLIST_ACCOUNT_COUNTER_CHECK_COLUMNS;

export const STYLIST_ACCOUNT_COUNTER_CHECKS = Object.keys(
  STYLIST_ACCOUNT_COUNTER_CHECK_COLUMNS
) as StylistAccountCounterCheck[];

export type DbInvariantProblemKind =
  /** The object does not exist: the migration never ran or the object was dropped. */
  | 'missing'
  /** The index exists but is INVALID (interrupted CONCURRENTLY build) or not unique. */
  | 'invalid'
  /** A same-named object enforces something else (table, columns, predicate or expression). */
  | 'definition_mismatch'
  /** The CHECK exists NOT VALID: new writes are checked, existing rows are not proven. */
  | 'not_validated';

export type DbInvariantProblem = {
  readonly name: string;
  readonly kind: DbInvariantProblemKind;
};

export type DbIndexCatalogRow = {
  readonly indisvalid: boolean;
  readonly indisunique: boolean;
  /** Table the index is on (pg_class.relname of indrelid). */
  readonly table_name: string;
  /** Key column names in index order (empty entries for expression columns). */
  readonly columns: readonly string[];
  /** pg_get_expr(indpred, indrelid), null for a non-partial index. */
  readonly predicate: string | null;
};

export type DbCheckCatalogRow = {
  readonly conname: string;
  readonly convalidated: boolean;
  /** pg_get_constraintdef(oid). */
  readonly definition: string;
};

/**
 * Index predicate as compared by the check and by migration 20261023100200: lower case, without
 * whitespace, parentheses, double quotes and `::type` casts. PG16 and PG17 render the SC-2
 * predicate identically under this form (measured by npm run db:test:invariants).
 */
export const normalizeIndexPredicate = (predicate: string): string =>
  predicate
    .toLowerCase()
    .replace(/"/g, '')
    .replace(/::[a-z_]+(\[\])?/g, '')
    .replace(/[\s()]/g, '');

/** CHECK definition as compared by the check and by migration 20261023100000. */
export const normalizeCheckDefinition = (definition: string): string =>
  definition
    .replace(/\s+NOT VALID\s*$/i, '')
    .replace(/[\s()"]/g, '')
    .toLowerCase();

const expectedCheckDefinition = (column: string): string => `check${column}>=0`;

/** Pure evaluation of the catalog rows; the I/O lives in verifyDbInvariants. */
export const evaluateDbInvariants = (
  indexRows: readonly DbIndexCatalogRow[],
  checkRows: readonly DbCheckCatalogRow[]
): DbInvariantProblem[] => {
  const problems: DbInvariantProblem[] = [];

  const [index] = indexRows;
  if (!index) {
    problems.push({
      name: SESSION_CONTAINER_ACTIVE_PAIR_INDEX,
      kind: 'missing',
    });
  } else if (
    index.table_name !== SESSION_CONTAINER_ACTIVE_PAIR_SPEC.table ||
    index.columns.join(',') !==
      SESSION_CONTAINER_ACTIVE_PAIR_SPEC.columns.join(',') ||
    index.predicate === null ||
    normalizeIndexPredicate(index.predicate) !==
      SESSION_CONTAINER_ACTIVE_PAIR_SPEC.predicate
  ) {
    problems.push({
      name: SESSION_CONTAINER_ACTIVE_PAIR_INDEX,
      kind: 'definition_mismatch',
    });
  } else if (!index.indisvalid || !index.indisunique) {
    problems.push({
      name: SESSION_CONTAINER_ACTIVE_PAIR_INDEX,
      kind: 'invalid',
    });
  }

  const checks = new Map(checkRows.map(row => [row.conname, row]));
  for (const name of STYLIST_ACCOUNT_COUNTER_CHECKS) {
    const check = checks.get(name);
    if (!check) {
      problems.push({ name, kind: 'missing' });
    } else if (
      normalizeCheckDefinition(check.definition) !==
      expectedCheckDefinition(STYLIST_ACCOUNT_COUNTER_CHECK_COLUMNS[name])
    ) {
      problems.push({ name, kind: 'definition_mismatch' });
    } else if (!check.convalidated) {
      problems.push({ name, kind: 'not_validated' });
    }
  }

  return problems;
};

/**
 * A problem that means the invariant is NOT enforced as designed for new writes. `not_validated`
 * is excluded: a NOT VALID CHECK already rejects every new negative counter.
 */
export const isBlockingDbInvariantProblem = (
  problem: DbInvariantProblem
): boolean => problem.kind !== 'not_validated';

export const formatDbInvariantProblems = (
  problems: readonly DbInvariantProblem[]
): string => problems.map(({ name, kind }) => `${name} (${kind})`).join(', ');

/**
 * Reads pg_index / pg_constraint for the current schema and returns every invariant that is
 * missing or not fully in force (empty = OK). Read-only; a query failure propagates to the
 * caller, which decides (boot: report and continue, health: degraded).
 */
export const verifyDbInvariants = async (): Promise<DbInvariantProblem[]> => {
  const indexRows = await DB_CLIENT.use.$queryRaw<DbIndexCatalogRow[]>`
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
      pg_get_expr(i.indpred, i.indrelid) AS predicate
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = ${SESSION_CONTAINER_ACTIVE_PAIR_INDEX}
      AND n.nspname = current_schema()
    LIMIT 1`;

  const checkRows = await DB_CLIENT.use.$queryRaw<DbCheckCatalogRow[]>`
    SELECT con.conname, con.convalidated, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con
    WHERE con.conrelid = to_regclass('"StylistAccount"')
      AND con.contype = 'c'
      AND con.conname = ANY(${STYLIST_ACCOUNT_COUNTER_CHECKS}::text[])
    LIMIT 10`;

  return evaluateDbInvariants(indexRows, checkRows);
};
