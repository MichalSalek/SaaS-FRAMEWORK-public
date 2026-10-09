// tests/concurrency/advisory-xact-lock.concurrency.ts
//
// FAMILY 7 — `acquireAdvisoryXactLock` must actually RUN and actually SERIALIZE.
//
// THE BUG CLASS (pre-fix, found 2026-08-20): `pg_advisory_xact_lock()` returns the
// Postgres type `void`. Prisma's driver adapter cannot deserialize a `void` column,
// so a bare `$queryRaw` selecting it throws on EVERY call:
//   "Failed to deserialize column of type 'void'."
// The throw happened INSIDE the webhook transaction, so it did not merely skip the
// lock — it aborted the whole transaction. Both consumers are Stripe money paths
// (checkout.session.completed + customer.subscription.*), so in production every
// subscription activation, plan grant and cancellation failed with a 500 and Stripe
// retried into the same wall.
//
// WHY THE EXISTING SUITE COULD NOT CATCH IT (this is the whole point of this file):
//   • web-1 unit tests MOCK the function (checkout-completed.gate.test.ts:29) — they
//     assert it was CALLED, never that it works.
//   • the rest of this concurrency suite talks to Postgres through raw `pg`, which
//     decodes `void` happily — the defect lives ONLY in the Prisma adapter layer.
//   • static audits cannot see a runtime deserialization failure.
// So the guard has to import the REAL function and run it through a REAL Prisma
// client built exactly like the app builds it (PrismaPg adapter over a pg Pool).
//
// INVARIANT (must ALWAYS hold; FAILS on pre-fix code = RED guard):
//   1. acquireAdvisoryXactLock() inside an interactive transaction does not throw.
//   2. It genuinely serializes: two concurrent transactions taking the SAME key do
//      not overlap — the second one enters only after the first commits. "It did not
//      throw" alone is not proof; a lock that silently no-ops would pass test 1.
//   3. Two DIFFERENT keys do NOT contend (otherwise the whole platform would
//      serialize behind one lock).

import { createRequire } from 'module';
import { test, assertTrue } from './_harness';
import { resolveDatabaseUrl } from '../utils/db-client';
import { acquireAdvisoryXactLock } from '../../web-1/src/application/db/lock-rows';

// `@prisma/adapter-pg` and the generated client live in web-1's dependency tree, not
// in tests/. Resolve them through web-1's own package.json so Node's normal algorithm
// finds them — no hand-written paths into node_modules/dist that rot on every bump.
const web1Require = createRequire(new URL('../../web-1/package.json', import.meta.url));

type MinimalPool = { end: () => Promise<void> };
type MinimalPrisma = {
  $transaction: <T>(fn: (tx: never) => Promise<T>) => Promise<T>;
  $disconnect: () => Promise<void>;
};

const buildPrisma = (): { prisma: MinimalPrisma; pool: MinimalPool } => {
  const { PrismaClient } = web1Require('./src/prisma/js-client/index.js');
  const { PrismaPg } = web1Require('@prisma/adapter-pg');
  const pg = web1Require('pg');

  const pool = new pg.Pool({ connectionString: resolveDatabaseUrl() });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return { prisma, pool };
};

const withPrisma = async (
  fn: (prisma: MinimalPrisma) => Promise<void>
): Promise<void> => {
  const { prisma, pool } = buildPrisma();
  try {
    await fn(prisma);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
};

const LOCK_KEY = 'conc-advisory-lock-probe';
const OTHER_KEY = 'conc-advisory-lock-probe-other';

test('advisory-xact-lock: acquiring the lock does not throw (void column decodes)', async () => {
  await withPrisma(async prisma => {
    let threw: string | null = null;
    try {
      await prisma.$transaction(async tx => {
        await acquireAdvisoryXactLock(tx, LOCK_KEY);
      });
    } catch (error) {
      threw = error instanceof Error ? error.message : String(error);
    }
    assertTrue(
      threw === null,
      `acquireAdvisoryXactLock threw instead of taking the lock: ${threw ?? ''}`
    );
  });
});

test('advisory-xact-lock: the SAME key serializes two concurrent transactions', async () => {
  await withPrisma(async prisma => {
    const HOLD_MS = 400;

    // Deterministic ordering matters here. Firing both contenders at once and
    // sorting by entry time measures nothing: whichever transaction wins the lock
    // first sets the gap, so if the SHORT holder happens to win, a perfectly
    // serializing lock still shows a ~10ms gap and the test fails for no reason.
    // Instead: the holder announces that it owns the lock, and only then does the
    // waiter start — so the wait we measure is unambiguously time spent blocked.
    let announceHeld: () => void = () => undefined;
    const lockHeld = new Promise<void>(resolve => {
      announceHeld = resolve;
    });
    let releasedAt = 0;

    const holder = prisma.$transaction(async tx => {
      await acquireAdvisoryXactLock(tx, LOCK_KEY);
      announceHeld();
      await new Promise(resolve => setTimeout(resolve, HOLD_MS));
      releasedAt = Date.now();
    });

    const waiter = (async (): Promise<number> => {
      await lockHeld;
      const askedAt = Date.now();
      await prisma.$transaction(async tx => {
        await acquireAdvisoryXactLock(tx, LOCK_KEY);
      });
      return Date.now() - askedAt;
    })();

    const [, waitedMs] = await Promise.all([holder, waiter]);

    assertTrue(
      releasedAt > 0,
      'holder transaction did not complete — cannot judge serialization'
    );
    // A lock that silently no-ops lets the waiter through immediately (~0ms).
    // 0.75x slack absorbs scheduler jitter on a loaded WSL2 box.
    assertTrue(
      waitedMs >= HOLD_MS * 0.75,
      `lock did not serialize: waiter acquired after only ${waitedMs}ms of blocking (expected >= ${HOLD_MS * 0.75}ms)`
    );
  });
});

test('advisory-xact-lock: DIFFERENT keys do not contend', async () => {
  await withPrisma(async prisma => {
    // Same shape as the serialization test, but on a DIFFERENT key: the waiter must
    // NOT be blocked by the holder.
    let announceHeld: () => void = () => undefined;
    const lockHeld = new Promise<void>(resolve => {
      announceHeld = resolve;
    });

    const holder = prisma.$transaction(async tx => {
      await acquireAdvisoryXactLock(tx, LOCK_KEY);
      announceHeld();
      await new Promise(resolve => setTimeout(resolve, 300));
    });

    const waiter = (async (): Promise<number> => {
      await lockHeld;
      const askedAt = Date.now();
      await prisma.$transaction(async tx => {
        await acquireAdvisoryXactLock(tx, OTHER_KEY);
      });
      return Date.now() - askedAt;
    })();

    const [, waitedMs] = await Promise.all([holder, waiter]);

    assertTrue(
      waitedMs < 200,
      `distinct keys contended: waiter blocked ${waitedMs}ms on a different key (expected immediate)`
    );
  });
});
