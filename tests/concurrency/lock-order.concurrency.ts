// tests/concurrency/lock-order.concurrency.ts
//
// FAMILY 10: the canonical lock order against REAL Postgres.
//
// Bug class: a writer holding a higher-rank row lock that then INSERTS a child row takes FOR KEY SHARE
// on the child's FK parent, which conflicts with FOR UPDATE: a lower-rank lock taken out of order.
// Cycles are listed in web-1/src/application/db/LOCK_GRAPH.md (C1 favorite add vs session create,
// C2 pairing revoke vs visit create, N1 user hard delete vs favorite add, N2 onboarding / switch role
// vs moderation BAN). Unit tests mock $queryRaw and cannot see FK locks, so barriers force the
// interleaving on two real transactions using the real lock primitives, lock plans and FK inserts.
//
// Invariant per scenario: (1) the pre-fix acquisition order deadlocks (40P01) under the forced
// interleaving, proving the scenario reproduces the cycle; (2) the current order (lockInOrder + lock
// plan) commits both transactions under every interleaving the order allows.
// Test: this file (covers the listed cycles under barrier-forced interleavings; not other lock pairs).

import { createRequire } from 'module';
import { test, assertTrue, assertEqual } from './_harness';
import {
  createEphemeralClient,
  createEphemeralStylist,
  seedActivePair,
  seedGalleryRecord,
} from './_fixtures';
import { resolveDatabaseUrl } from '../utils/db-client';
import {
  lockActivePair,
  lockInOrder,
  lockStylistAccount,
  lockUserRow,
} from '../../web-1/src/application/db/lock-rows';
import {
  favoriteAddLockPlan,
  moderationResolveLockPlan,
  roleChangeLockPlan,
  visitWriteLockPlan,
} from '../../web-1/src/application/db/lock-plans';
import {
  configureLockOrderAssertions,
  LockOrderViolationError,
} from '../../web-1/src/application/db/lock-order';

const web1Require = createRequire(
  new URL('../../web-1/package.json', import.meta.url)
);

type Tx = {
  $queryRaw: (...args: never[]) => Promise<unknown>;
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<number>;
};
type MinimalPrisma = {
  $transaction: <T>(
    fn: (tx: Tx) => Promise<T>,
    options?: { timeout?: number; maxWait?: number }
  ) => Promise<T>;
  $disconnect: () => Promise<void>;
};
type LockTx = Parameters<typeof lockUserRow>[0];
// The test-side client is untyped (web-1's generated client is resolved at runtime); the primitives
// only call $queryRaw on it, so this cast is the boundary.
const asLockTx = (tx: Tx): LockTx => tx as unknown as LockTx;

const withPrisma = async (
  fn: (prisma: MinimalPrisma) => Promise<void>
): Promise<void> => {
  const { PrismaClient } = web1Require('./src/prisma/js-client/index.js');
  const { PrismaPg } = web1Require('@prisma/adapter-pg');
  const pg = web1Require('pg');
  const pool = new pg.Pool({ connectionString: resolveDatabaseUrl(), max: 4 });
  const prisma: MinimalPrisma = new PrismaClient({
    adapter: new PrismaPg(pool),
  });
  try {
    await fn(prisma);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
};

const TX_OPTIONS = { timeout: 20_000, maxWait: 5_000 };
// Long enough for the other transaction to reach its blocking statement; Postgres detects a
// deadlock after deadlock_timeout (1s default), so a real cycle surfaces well inside TX_OPTIONS.
const SETTLE_MS = 400;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const latch = () => {
  let open: () => void = () => undefined;
  const opened = new Promise<void>(resolve => {
    open = resolve;
  });
  return { open, opened };
};

const errorText = (error: unknown): string => {
  if (error instanceof Error) {
    let text = `${error.name} ${error.message}`;
    try {
      text += ` ${JSON.stringify(error)}`;
    } catch {
      // circular meta: the message is enough
    }
    return text;
  }
  return String(error);
};
const isDeadlockError = (error: unknown): boolean =>
  /40P01|deadlock detected/i.test(errorText(error));

const settle = async (
  a: Promise<unknown>,
  b: Promise<unknown>
): Promise<PromiseSettledResult<unknown>[]> => Promise.allSettled([a, b]);

const newId = (label: string): string =>
  `conc-lo-${label}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

// Raw inserts on the tx's own connection: the FK check is what takes the KEY SHARE lock under test.
const insertLike = (tx: Tx, clientUserId: string, galleryRecordId: string) =>
  tx.$executeRawUnsafe(
    `INSERT INTO "FavoriteGalleryRecord" (id, client_user_id, gallery_record_id, created_at)
     VALUES ($1, $2, $3, now())`,
    newId('fgr'),
    clientUserId,
    galleryRecordId
  );
const insertSession = (
  tx: Tx,
  clientAccountId: string,
  stylistAccountId: string
) =>
  tx.$executeRawUnsafe(
    `INSERT INTO "SessionContainer" (id, client_account_id, stylist_account_id, lifecycle_state, created_at, updated_at)
     VALUES ($1, $2, $3, 'CLOSED', now(), now())`,
    newId('sc'),
    clientAccountId,
    stylistAccountId
  );
const insertVisit = (tx: Tx, clientUserId: string, stylistAccountId: string) =>
  tx.$executeRawUnsafe(
    `INSERT INTO "VisitRecord" (id, client_user_id, stylist_account_id, visit_date, source, created_at, updated_at)
     VALUES ($1, $2, $3, now(), 'MANUAL', now(), now())`,
    newId('vr'),
    clientUserId,
    stylistAccountId
  );
const touchPair = (tx: Tx, pairId: string) =>
  tx.$executeRawUnsafe(
    `UPDATE "ClientStylistPair" SET revoked_at = NULL WHERE id = $1`,
    pairId
  );

type Cast = {
  clientUserId: string;
  clientAccountId: string;
  stylistAccountId: string;
  stylistUserId: string;
  pairId: string;
};

let cast: Cast | null = null;
const getCast = async (): Promise<Cast> => {
  if (cast) {
    return cast;
  }
  const stylist = await createEphemeralStylist('lo-stylist');
  const client = await createEphemeralClient('lo-client');
  const pairId = await seedActivePair(client.userId, stylist.accountId);
  cast = {
    clientUserId: client.userId,
    clientAccountId: client.clientAccountId,
    stylistAccountId: stylist.accountId,
    stylistUserId: stylist.userId,
    pairId,
  };
  return cast;
};

const assertExactlyOneDeadlock = (
  results: PromiseSettledResult<unknown>[],
  label: string
) => {
  const rejected = results.filter(
    (r): r is PromiseRejectedResult => r.status === 'rejected'
  );
  assertEqual(
    rejected.length,
    1,
    `${label}: expected exactly one deadlock victim`
  );
  const victim = rejected[0];
  assertTrue(
    victim !== undefined && isDeadlockError(victim.reason),
    `${label}: the failure must be a 40P01 deadlock, got: ${victim ? errorText(victim.reason) : 'none'}`
  );
};

const assertBothCommitted = (
  results: PromiseSettledResult<unknown>[],
  label: string
) => {
  const failures = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => errorText(r.reason));
  assertEqual(
    failures.length,
    0,
    `${label}: both transactions must commit; failures: ${failures.join(' | ')}`
  );
};

// --- C1: favorite add x session create ------------------------------------------------------------

test('lock-order C1: pre-fix favorite add (StylistAccount, then like insert) deadlocks with session create', async () => {
  // The pre-fix sequence is out of order on purpose: the checker would refuse it before Postgres can.
  configureLockOrderAssertions(false);
  const c = await getCast();
  const galleryRecordId = await seedGalleryRecord(c.stylistAccountId);
  await withPrisma(async prisma => {
    const favHolds = latch();
    const sessHolds = latch();
    const fav = prisma.$transaction(async tx => {
      await lockStylistAccount(asLockTx(tx), c.stylistAccountId);
      favHolds.open();
      await sessHolds.opened;
      await insertLike(tx, c.clientUserId, galleryRecordId); // KEY SHARE users -> waits
    }, TX_OPTIONS);
    const sess = prisma.$transaction(async tx => {
      await favHolds.opened;
      await lockUserRow(asLockTx(tx), c.clientUserId);
      sessHolds.open();
      await sleep(SETTLE_MS);
      await insertSession(tx, c.clientAccountId, c.stylistAccountId);
    }, TX_OPTIONS);
    assertExactlyOneDeadlock(await settle(fav, sess), 'C1 pre-fix');
  });
  configureLockOrderAssertions(true);
});

test('lock-order C1: favoriteAddLockPlan commits both when session create locks the user first', async () => {
  configureLockOrderAssertions(true);
  const c = await getCast();
  const galleryRecordId = await seedGalleryRecord(c.stylistAccountId);
  await withPrisma(async prisma => {
    const sessHolds = latch();
    const sess = prisma.$transaction(async tx => {
      await lockUserRow(asLockTx(tx), c.clientUserId);
      sessHolds.open();
      await sleep(SETTLE_MS); // the favorite add is now blocked on KEY SHARE users, holding nothing
      await insertSession(tx, c.clientAccountId, c.stylistAccountId);
    }, TX_OPTIONS);
    const fav = prisma.$transaction(async tx => {
      await sessHolds.opened;
      await lockInOrder(
        asLockTx(tx),
        favoriteAddLockPlan(c.clientUserId, c.stylistAccountId)
      );
      await insertLike(tx, c.clientUserId, galleryRecordId);
    }, TX_OPTIONS);
    assertBothCommitted(await settle(fav, sess), 'C1 fixed, session first');
  });
});

test('lock-order C1: favoriteAddLockPlan commits both when the favorite add locks first', async () => {
  configureLockOrderAssertions(true);
  const c = await getCast();
  // one record per scenario: a like is unique per (client, record)
  const galleryRecordId = await seedGalleryRecord(c.stylistAccountId);
  await withPrisma(async prisma => {
    const favHolds = latch();
    const fav = prisma.$transaction(async tx => {
      await lockInOrder(
        asLockTx(tx),
        favoriteAddLockPlan(c.clientUserId, c.stylistAccountId)
      );
      favHolds.open();
      await sleep(SETTLE_MS); // session create is now blocked on users FOR UPDATE, holding nothing
      await insertLike(tx, c.clientUserId, galleryRecordId);
    }, TX_OPTIONS);
    const sess = prisma.$transaction(async tx => {
      await favHolds.opened;
      await lockUserRow(asLockTx(tx), c.clientUserId);
      await insertSession(tx, c.clientAccountId, c.stylistAccountId);
    }, TX_OPTIONS);
    assertBothCommitted(await settle(fav, sess), 'C1 fixed, favorite first');
  });
});

// --- C2: pairing revoke x visit create --------------------------------------------------------------

test('lock-order C2: pre-fix visit create (pair, then visit insert) deadlocks with revoke', async () => {
  configureLockOrderAssertions(false);
  const c = await getCast();
  await withPrisma(async prisma => {
    const revHolds = latch();
    const visHolds = latch();
    const rev = prisma.$transaction(async tx => {
      await lockStylistAccount(asLockTx(tx), c.stylistAccountId);
      revHolds.open();
      await visHolds.opened;
      await touchPair(tx, c.pairId); // row lock on the pair -> waits for the visit
    }, TX_OPTIONS);
    const vis = prisma.$transaction(async tx => {
      await revHolds.opened;
      const pair = await lockActivePair(
        asLockTx(tx),
        c.clientUserId,
        c.stylistAccountId
      );
      assertTrue(pair !== null, 'C2 pre-fix: seeded pair must be ACTIVE');
      visHolds.open();
      await sleep(SETTLE_MS);
      await insertVisit(tx, c.clientUserId, c.stylistAccountId);
    }, TX_OPTIONS);
    assertExactlyOneDeadlock(await settle(rev, vis), 'C2 pre-fix');
  });
  configureLockOrderAssertions(true);
});

test('lock-order C2: visitWriteLockPlan commits both when the revoke locks first', async () => {
  configureLockOrderAssertions(true);
  const c = await getCast();
  await withPrisma(async prisma => {
    const revHolds = latch();
    const rev = prisma.$transaction(async tx => {
      await lockStylistAccount(asLockTx(tx), c.stylistAccountId);
      revHolds.open();
      await sleep(SETTLE_MS);
      await lockActivePair(asLockTx(tx), c.clientUserId, c.stylistAccountId);
      await touchPair(tx, c.pairId);
    }, TX_OPTIONS);
    const vis = prisma.$transaction(async tx => {
      await revHolds.opened;
      await lockInOrder(
        asLockTx(tx),
        visitWriteLockPlan(c.clientUserId, c.stylistAccountId)
      );
      const pair = await lockActivePair(
        asLockTx(tx),
        c.clientUserId,
        c.stylistAccountId
      );
      assertTrue(
        pair !== null,
        'C2 fixed: pair stays ACTIVE (the touch does not revoke)'
      );
      await insertVisit(tx, c.clientUserId, c.stylistAccountId);
    }, TX_OPTIONS);
    assertBothCommitted(await settle(rev, vis), 'C2 fixed, revoke first');
  });
});

test('lock-order C2: visitWriteLockPlan commits both when the visit locks first', async () => {
  configureLockOrderAssertions(true);
  const c = await getCast();
  await withPrisma(async prisma => {
    const visHolds = latch();
    const vis = prisma.$transaction(async tx => {
      await lockInOrder(
        asLockTx(tx),
        visitWriteLockPlan(c.clientUserId, c.stylistAccountId)
      );
      await lockActivePair(asLockTx(tx), c.clientUserId, c.stylistAccountId);
      visHolds.open();
      await sleep(SETTLE_MS); // the revoke is blocked on StylistAccount FOR UPDATE, holding nothing
      await insertVisit(tx, c.clientUserId, c.stylistAccountId);
    }, TX_OPTIONS);
    const rev = prisma.$transaction(async tx => {
      await visHolds.opened;
      await lockStylistAccount(asLockTx(tx), c.stylistAccountId);
      await lockActivePair(asLockTx(tx), c.clientUserId, c.stylistAccountId);
      await touchPair(tx, c.pairId);
    }, TX_OPTIONS);
    assertBothCommitted(await settle(rev, vis), 'C2 fixed, visit first');
  });
});

// --- the checker runs against real transactions -------------------------------------------------------

test('lock-order: the checker rejects an out-of-order lock on a real transaction before Postgres waits', async () => {
  configureLockOrderAssertions(true);
  const c = await getCast();
  await withPrisma(async prisma => {
    let caught: unknown = null;
    try {
      await prisma.$transaction(async tx => {
        await lockStylistAccount(asLockTx(tx), c.stylistAccountId);
        await lockUserRow(asLockTx(tx), c.clientUserId);
      }, TX_OPTIONS);
    } catch (error) {
      caught = error;
    }
    assertTrue(
      caught instanceof LockOrderViolationError,
      `expected LockOrderViolationError, got ${caught === null ? 'success' : errorText(caught)}`
    );
  });
});

// --- N1: user hard delete / archive move x favorite add by that user ------------------------------
// The DELETE's own lock is FOR UPDATE on the users row; a SELECT ... FOR UPDATE stands in for it so the
// cast survives the scenario. The counter UPDATE is the decrementLikesForDeletedClient shape.

const touchStylistCounters = (tx: Tx, stylistAccountId: string) =>
  tx.$executeRawUnsafe(
    `UPDATE "StylistAccount" SET cached_likes_count = cached_likes_count WHERE account_id = $1`,
    stylistAccountId
  );
const lockUserLikeDelete = (tx: Tx, userId: string) =>
  tx.$executeRawUnsafe(
    `SELECT 1 FROM "users" WHERE "id" = $1 FOR UPDATE`,
    userId
  );

test('lock-order N1: pre-fix delete (counters, then users) deadlocks with favorite add', async () => {
  configureLockOrderAssertions(true);
  const c = await getCast();
  await withPrisma(async prisma => {
    const delHolds = latch();
    const favHolds = latch();
    const del = prisma.$transaction(async tx => {
      await touchStylistCounters(tx, c.stylistAccountId);
      delHolds.open();
      await favHolds.opened;
      await sleep(SETTLE_MS); // the favorite add is now blocked on StylistAccount FOR UPDATE
      await lockUserLikeDelete(tx, c.clientUserId); // users FOR UPDATE vs its KEY SHARE -> cycle
    }, TX_OPTIONS);
    const fav = prisma.$transaction(async tx => {
      await delHolds.opened;
      // the users KEY SHARE half of the plan, then announce, then the StylistAccount half
      const [userTarget, accountTarget] = favoriteAddLockPlan(
        c.clientUserId,
        c.stylistAccountId
      );
      if (!userTarget || !accountTarget) {
        throw new Error('favoriteAddLockPlan shape changed');
      }
      await lockInOrder(asLockTx(tx), [userTarget]);
      favHolds.open();
      await lockInOrder(asLockTx(tx), [accountTarget]);
    }, TX_OPTIONS);
    assertExactlyOneDeadlock(await settle(del, fav), 'N1 pre-fix');
  });
});

test('lock-order N1: users-first delete commits both, whichever side goes first', async () => {
  configureLockOrderAssertions(true);
  const c = await getCast();
  for (const deleteFirst of [true, false]) {
    await withPrisma(async prisma => {
      const firstHolds = latch();
      const del = prisma.$transaction(async tx => {
        if (!deleteFirst) {
          await firstHolds.opened;
        }
        await lockUserRow(asLockTx(tx), c.clientUserId); // the fix: users first
        if (deleteFirst) {
          firstHolds.open();
          await sleep(SETTLE_MS);
        }
        await touchStylistCounters(tx, c.stylistAccountId);
      }, TX_OPTIONS);
      const fav = prisma.$transaction(async tx => {
        if (deleteFirst) {
          await firstHolds.opened;
        }
        await lockInOrder(
          asLockTx(tx),
          favoriteAddLockPlan(c.clientUserId, c.stylistAccountId)
        );
        if (!deleteFirst) {
          firstHolds.open();
          await sleep(SETTLE_MS);
        }
      }, TX_OPTIONS);
      assertBothCommitted(
        await settle(del, fav),
        `N1 fixed, ${deleteFirst ? 'delete' : 'favorite'} first`
      );
    });
  }
});

// --- N2: onboarding / switch role x moderation BAN --------------------------------------------------

const touchAccount = (tx: Tx, stylistAccountId: string) =>
  tx.$executeRawUnsafe(
    `UPDATE "StylistAccount" SET display_name = display_name WHERE account_id = $1`,
    stylistAccountId
  );
const touchUserRole = (tx: Tx, userId: string) =>
  tx.$executeRawUnsafe(
    `UPDATE "users" SET account_type = account_type WHERE id = $1`,
    userId
  );

test('lock-order N2: pre-fix onboarding (account, then users) deadlocks with BAN', async () => {
  configureLockOrderAssertions(true);
  const c = await getCast();
  await withPrisma(async prisma => {
    const onbHolds = latch();
    const banHoldsUser = latch();
    const onb = prisma.$transaction(async tx => {
      await touchAccount(tx, c.stylistAccountId);
      onbHolds.open();
      await banHoldsUser.opened;
      await sleep(SETTLE_MS); // BAN is now blocked on StylistAccount FOR UPDATE
      await touchUserRole(tx, c.stylistUserId); // users UPDATE vs BAN's users lock -> cycle
    }, TX_OPTIONS);
    const ban = prisma.$transaction(async tx => {
      await onbHolds.opened;
      const [userTarget, accountTarget] = moderationResolveLockPlan(
        c.stylistAccountId,
        c.stylistUserId
      );
      if (!userTarget || !accountTarget) {
        throw new Error('moderationResolveLockPlan shape changed');
      }
      await lockInOrder(asLockTx(tx), [userTarget]);
      banHoldsUser.open();
      await lockInOrder(asLockTx(tx), [accountTarget]);
    }, TX_OPTIONS);
    assertExactlyOneDeadlock(await settle(onb, ban), 'N2 pre-fix');
  });
});

test('lock-order N2: users-first onboarding commits both, whichever side goes first', async () => {
  configureLockOrderAssertions(true);
  const c = await getCast();
  for (const onboardingFirst of [true, false]) {
    await withPrisma(async prisma => {
      const firstHolds = latch();
      const onb = prisma.$transaction(async tx => {
        if (!onboardingFirst) {
          await firstHolds.opened;
        }
        await lockInOrder(asLockTx(tx), roleChangeLockPlan(c.stylistUserId)); // the fix
        if (onboardingFirst) {
          firstHolds.open();
          await sleep(SETTLE_MS);
        }
        await touchAccount(tx, c.stylistAccountId);
        await touchUserRole(tx, c.stylistUserId);
      }, TX_OPTIONS);
      const ban = prisma.$transaction(async tx => {
        if (onboardingFirst) {
          await firstHolds.opened;
        }
        await lockInOrder(
          asLockTx(tx),
          moderationResolveLockPlan(c.stylistAccountId, c.stylistUserId)
        );
        if (!onboardingFirst) {
          firstHolds.open();
          await sleep(SETTLE_MS);
        }
        await touchAccount(tx, c.stylistAccountId);
        await touchUserRole(tx, c.stylistUserId);
      }, TX_OPTIONS);
      assertBothCommitted(
        await settle(onb, ban),
        `N2 fixed, ${onboardingFirst ? 'onboarding' : 'BAN'} first`
      );
    });
  }
});
