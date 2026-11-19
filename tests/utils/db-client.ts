// tests/utils/db-client.ts
//
// SSOT direct-DB client for the LIVE concurrency suite (tests/concurrency/).
//
// The HTTP harness cannot prove one-effect invariants: a double-decremented counter, a stale
// active pair or a lost webhook write all return 200/4xx. Proving the invariant held under real
// parallelism needs Postgres read AFTER the race; this module is that read side.
//
// Connection: SSOT is web-1/.env.development DATABASE_URL (postgresql://user:pw@db:5432/db).
// `db:5432` resolves only INSIDE the docker network; from the host the DB is published at
// localhost:3200. A readable web-1/.env.development (as in backend-env.ts) means a host run, so
// @db:5432 is remapped to @localhost:3200. TEST_DATABASE_URL fully overrides (in-container, CI).
//
// Read-mostly infra: the suite mutates state through the real API, never by writing rows here
// (that would bypass the code under test). Direct SQL writes are only fixture cleanup.

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse backend dev env from disk. Success ⇒ we are on the host (file is NOT mounted
// under tests/ in-container) ⇒ remap db:5432 → localhost:3200. Failure ⇒ in-container,
// rely on process.env DATABASE_URL as-is.
let onHost = false;
let backendEnv: Record<string, string> = {};
try {
  backendEnv = dotenv.parse(
    fs.readFileSync(path.resolve(__dirname, '../../web-1/.env.development'))
  );
  onHost = true;
} catch {
  /* in-container — process.env has DATABASE_URL via env_file */
}

const rawDatabaseUrl = (): string => {
  const url =
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    backendEnv['DATABASE_URL'];
  if (!url) {
    throw new Error(
      'db-client: no DATABASE_URL — set TEST_DATABASE_URL or ensure web-1/.env.development is readable'
    );
  }
  return url;
};

/**
 * Resolve the connection string for THIS process. Host-runs (default) remap the
 * docker-internal host:port to the published localhost:3200, unless the caller
 * already supplied an explicit TEST_DATABASE_URL.
 */
export const resolveDatabaseUrl = (): string => {
  const url = rawDatabaseUrl();
  if (process.env.TEST_DATABASE_URL) {
    return url; // explicit override, never rewritten
  }
  if (onHost) {
    return url.replace('@db:5432', '@localhost:3200');
  }
  return url;
};

let pool: pg.Pool | undefined;

/** Lazily-constructed shared pool. Call closeDb() at suite end. */
export const getDbPool = (): pg.Pool => {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: resolveDatabaseUrl(),
      // Prisma stores UTC in timestamp without time zone. pg otherwise interprets
      // OID 1114 in the runner's local timezone and shifts direct-DB evidence.
      types: {
        getTypeParser: (oid, format) => {
          const parse = pg.types.getTypeParser(oid, format);
          if (oid !== 1114 || format === 'binary') {
            return parse;
          }
          return (value: string) =>
            parse(
              value === 'infinity' || value === '-infinity'
                ? value
                : `${value}Z`
            );
        },
      },
      max: 12,
      // Concurrency probes hold FOR UPDATE locks deliberately; keep a generous
      // statement timeout so an intentional 2-conn deadlock-probe surfaces the
      // 40P01 rather than a client-side timeout masking it.
      statement_timeout: 15_000,
    });
  }
  return pool;
};

export const closeDb = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
};

/** Single round-trip query against the shared pool. */
export const dbQuery = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> => {
  const res = await getDbPool().query<T>(sql, params);
  return res.rows;
};

/** First row or null. */
export const dbQueryOne = async <
  T extends pg.QueryResultRow = pg.QueryResultRow,
>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> => {
  const rows = await dbQuery<T>(sql, params);
  return rows[0] ?? null;
};

/**
 * Run fn with a DEDICATED client checked out of the pool (released in finally).
 * Required for FOR UPDATE probes — row locks are connection-scoped, so the lock
 * must be held on one client while another client races it.
 */
export const withClient = async <T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> => {
  const client = await getDbPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
};

// ============================================================================
// COUNTER INVARIANT — cached_X == live_count(X)
//
// SQL below is the EXACT recompute logic from
// web-1/src/application/startup/cached-counts-backfill.ts. CWT-4: the invariant
// test must use the same definition as the backfill, otherwise a drift the
// backfill would heal looks like a test failure (or vice versa). Scope: the 3
// derived counts only (view_count / moderation_strikes excluded — CWT-8).
// ============================================================================

export type CachedCounts = {
  account_id: string;
  cached_bookmark_count: number;
  cached_gallery_count: number;
  cached_likes_count: number;
};

export type LiveCounts = {
  account_id: string;
  live_bookmark_count: number;
  live_gallery_count: number;
  live_likes_count: number;
};

/** Read the denormalized cached_* columns for one account. */
export const readCachedCounts = async (
  accountId: string
): Promise<CachedCounts | null> =>
  dbQueryOne<CachedCounts>(
    `SELECT account_id, cached_bookmark_count, cached_gallery_count, cached_likes_count
       FROM "StylistAccount" WHERE account_id = $1`,
    [accountId]
  );

/**
 * Recompute the 3 live counts from source tables for one account, using the
 * EXACT predicates from cached-counts-backfill.ts:
 *   - bookmark: COUNT(FavoriteStylist) where favorited account (account._count.favorited_by)
 *   - gallery:  COUNT(GalleryRecord) where is_hidden = false (RC-011 parity)
 *   - likes:    COUNT(FavoriteGalleryRecord JOIN GalleryRecord) where gr.is_hidden = false
 */
export const readLiveCounts = async (
  accountId: string
): Promise<LiveCounts> => {
  const row = await dbQueryOne<{
    live_bookmark_count: string;
    live_gallery_count: string;
    live_likes_count: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM "FavoriteStylist" fs
          WHERE fs."stylist_account_id" = $1)                         AS live_bookmark_count,
       (SELECT COUNT(*) FROM "GalleryRecord" gr
          WHERE gr."created_by_account_id" = $1 AND gr."is_hidden" = false) AS live_gallery_count,
       (SELECT COUNT(*) FROM "FavoriteGalleryRecord" f
          JOIN "GalleryRecord" gr ON gr."gallery_record_id" = f."gallery_record_id"
          WHERE gr."created_by_account_id" = $1 AND gr."is_hidden" = false) AS live_likes_count`,
    [accountId]
  );
  return {
    account_id: accountId,
    live_bookmark_count: Number(row?.live_bookmark_count ?? 0),
    live_gallery_count: Number(row?.live_gallery_count ?? 0),
    live_likes_count: Number(row?.live_likes_count ?? 0),
  };
};

export type InvariantViolation = {
  counter: 'bookmark' | 'gallery' | 'likes';
  cached: number;
  live: number;
};

/**
 * Compare cached_X vs live_count(X) for one account. Returns the list of
 * violations (empty = invariant holds). Caller decides hard-fail vs report.
 */
export const checkCountInvariant = async (
  accountId: string
): Promise<InvariantViolation[]> => {
  const [cached, live] = await Promise.all([
    readCachedCounts(accountId),
    readLiveCounts(accountId),
  ]);
  if (!cached) {
    throw new Error(`checkCountInvariant: no StylistAccount ${accountId}`);
  }
  const violations: InvariantViolation[] = [];
  if (cached.cached_bookmark_count !== live.live_bookmark_count) {
    violations.push({
      counter: 'bookmark',
      cached: cached.cached_bookmark_count,
      live: live.live_bookmark_count,
    });
  }
  if (cached.cached_gallery_count !== live.live_gallery_count) {
    violations.push({
      counter: 'gallery',
      cached: cached.cached_gallery_count,
      live: live.live_gallery_count,
    });
  }
  if (cached.cached_likes_count !== live.live_likes_count) {
    violations.push({
      counter: 'likes',
      cached: cached.cached_likes_count,
      live: live.live_likes_count,
    });
  }
  return violations;
};

// ============================================================================
// pg-probe: helpers for a two-connection FOR UPDATE deadlock probe
//
// Holds a FOR UPDATE lock on `rowA` from connection 1, then has connection 2 attempt rowA→rowB
// (or whatever the probe fn does) while connection 1 races the reverse. Code that takes locks in
// inconsistent order gets a 40P01 under that forced interleaving. A probe shows the order it
// forces, not every possible one; the user is tests/concurrency/lock-order.concurrency.ts.
// ============================================================================

/**
 * Acquire `SELECT … FOR UPDATE` on a single row via a dedicated client and hold
 * it until `release()` is called. Returns the held client + a release fn.
 */
export const holdRowLock = async (
  table: string,
  pkColumn: string,
  pkValue: string
): Promise<{ release: () => Promise<void> }> => {
  const client = await getDbPool().connect();
  await client.query('BEGIN');
  await client.query(
    `SELECT 1 FROM "${table}" WHERE "${pkColumn}" = $1 FOR UPDATE`,
    [pkValue]
  );
  return {
    release: async () => {
      try {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    },
  };
};

/**
 * Whether an error is a Postgres deadlock (40P01) or serialization failure (40001).
 * Used by pg-probe assertions to distinguish "deadlock fired" from other errors.
 */
export const isPgConcurrencyError = (err: unknown): boolean => {
  const code = (err as { code?: string } | null)?.code;
  return code === '40P01' || code === '40001';
};
