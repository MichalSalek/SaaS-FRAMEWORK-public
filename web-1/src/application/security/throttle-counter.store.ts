import { TIME } from '@kernel/application/constants.config';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';

/**
 * Fixed-window abuse counters. Keys are opaque; callers hash anything personal.
 * DECISION: one atomic increment. Read-then-increment let parallel hits share a count
 * and pass a budget of 5. Production uses the ThrottleCounter table (a daily budget
 * survives deploy and a second instance). An unreachable table falls back to memory,
 * which weakens the limit to one process instead of blocking logins.
 * Test: web-1/src/application/security/throttle-counter.store.test.ts (parallel
 * in-memory counts and the fallback; not the SQL upsert under concurrent sessions).
 */
export type ThrottleHit = {
  /** Hits in the open window, this one included. */
  count: number;
  /** When the open window closes (the truthful Retry-After for a refusal on this key). */
  resetAt: Date;
};

export type ThrottleCounterStore = {
  hit: (key: string, windowMs: number, now: Date) => Promise<ThrottleHit>;
};

type MemoryEntry = { count: number; expiresAt: number };

/** Upper bound for the in-memory store; expired entries go first, then the oldest. */
const MEMORY_MAX_KEYS = 10_000;

export const createMemoryThrottleCounterStore = (): ThrottleCounterStore => {
  const entries = new Map<string, MemoryEntry>();

  const prune = (nowMs: number): void => {
    if (entries.size < MEMORY_MAX_KEYS) {
      return;
    }
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= nowMs) {
        entries.delete(key);
      }
    }
    for (const key of entries.keys()) {
      if (entries.size < MEMORY_MAX_KEYS) {
        break;
      }
      entries.delete(key);
    }
  };

  return {
    // Synchronous body: in one process, the read and the write cannot interleave.
    hit: (key, windowMs, now) => {
      const nowMs = now.getTime();
      const entry = entries.get(key);
      if (entry === undefined || entry.expiresAt <= nowMs) {
        prune(nowMs);
        const expiresAt = nowMs + windowMs;
        entries.set(key, { count: 1, expiresAt });
        return Promise.resolve({ count: 1, resetAt: new Date(expiresAt) });
      }
      entry.count += 1;
      return Promise.resolve({
        count: entry.count,
        resetAt: new Date(entry.expiresAt),
      });
    },
  };
};

/** Rows whose window closed this long ago are deleted by the opportunistic prune. */
const PRUNE_GRACE_MS = TIME.MS_PER_HOUR;
/** At most one prune per process per hour. */
const PRUNE_INTERVAL_MS = TIME.MS_PER_HOUR;

const createDatabaseThrottleCounterStore = (): ThrottleCounterStore => {
  let lastPruneAt = 0;

  const pruneExpired = (now: Date): void => {
    if (now.getTime() - lastPruneAt < PRUNE_INTERVAL_MS) {
      return;
    }
    lastPruneAt = now.getTime();
    const cutoff = new Date(now.getTime() - PRUNE_GRACE_MS);
    void DB_CLIENT.use.throttleCounter
      .deleteMany({ where: { expires_at: { lt: cutoff } } })
      .catch((error: unknown) => {
        reportIssueBackend({
          namespace: 'THROTTLE_COUNTER',
          message: 'Pruning expired throttle counters failed',
          payload: error,
          mode: 'warn',
        });
      });
  };

  return {
    hit: async (key, windowMs, now) => {
      const expiresAt = new Date(now.getTime() + windowMs);
      // One atomic statement (row lock of the upsert): a closed window restarts at 1, an open one
      // increments, and every concurrent caller gets a distinct count. The columns are UTC
      // `timestamp(3)` (how Prisma stores DateTime), so values are pinned to UTC explicitly and
      // the window end comes back as epoch milliseconds, independent of the session time zone.
      const rows = await DB_CLIENT.use.$queryRaw<
        Array<{ count: number; reset_at_ms: number }>
      >`
        WITH params AS (
          SELECT (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC') AS now_at,
                 (${expiresAt.toISOString()}::timestamptz AT TIME ZONE 'UTC') AS expires_at
        )
        INSERT INTO "ThrottleCounter" ("key", "count", "window_start", "expires_at")
        SELECT ${key}, 1, params.now_at, params.expires_at FROM params
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE WHEN "ThrottleCounter"."expires_at" <= EXCLUDED."window_start"
            THEN 1 ELSE "ThrottleCounter"."count" + 1 END,
          "window_start" = CASE WHEN "ThrottleCounter"."expires_at" <= EXCLUDED."window_start"
            THEN EXCLUDED."window_start" ELSE "ThrottleCounter"."window_start" END,
          "expires_at" = CASE WHEN "ThrottleCounter"."expires_at" <= EXCLUDED."window_start"
            THEN EXCLUDED."expires_at" ELSE "ThrottleCounter"."expires_at" END
        RETURNING "count",
          (EXTRACT(EPOCH FROM ("expires_at" AT TIME ZONE 'UTC')) * 1000)::float8 AS reset_at_ms
      `;
      pruneExpired(now);
      const row = rows[0];
      return row === undefined
        ? { count: 1, resetAt: expiresAt }
        : { count: row.count, resetAt: new Date(row.reset_at_ms) };
    },
  };
};

/**
 * Database store with a per-call in-memory fallback. The fallback keeps its own counts, so after
 * an outage the limits restart from the database values; that is the accepted cost of never
 * locking logins out on a database blip.
 */
export const createResilientThrottleCounterStore = (
  primary: ThrottleCounterStore = createDatabaseThrottleCounterStore(),
  fallback: ThrottleCounterStore = createMemoryThrottleCounterStore()
): ThrottleCounterStore => ({
  hit: async (key, windowMs, now) => {
    try {
      return await primary.hit(key, windowMs, now);
    } catch (error) {
      reportIssueBackend({
        namespace: 'THROTTLE_COUNTER',
        message:
          'Throttle counter table unavailable, using the in-memory fallback',
        payload: error,
        mode: 'warn',
      });
      return fallback.hit(key, windowMs, now);
    }
  },
});
