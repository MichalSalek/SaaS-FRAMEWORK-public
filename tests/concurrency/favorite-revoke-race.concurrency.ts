// tests/concurrency/favorite-revoke-race.concurrency.ts
//
// FAMILY 9: a like add racing a pairing revoke must not leave a private asset_url readable by the
// former client.
//
// Mechanism: add reads the immutable owner id, takes lockStylistAccount, and only then evaluates access;
// revoke takes the same lock before it deletes likes and flips the pair; both list reads filter by
// CURRENT access in SQL before pagination (web-1/src/domain/favorites/operations/favorite-access.ts).
//
// The race is driven by observed state, not sleeps: a separate connection holds the stylist's row lock,
// the test waits until the add backend is blocked BY THAT connection (pg_blocking_pids), fires revoke,
// gives it a bounded window to finish while the lock is held, then releases. Accepted outcomes: add
// first and its like deleted by revoke, or revoke first and add refused. Never: REVOKED pair plus a
// surviving unpinned like, or its asset_url in any list.
// Test: this file (covers the forced add/revoke interleaving over HTTP + Postgres; not other lock orders).

import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { apiCallRaw, fireParallel } from '../utils/api-client';
import { test, assertTrue, assertEqual, assertNo500 } from './_harness';
import {
  dbQuery,
  dbQueryOne,
  getDbPool,
  readLiveCounts,
} from '../utils/db-client';
import {
  createEphemeralStylist,
  createEphemeralClient,
  seedActivePair,
  seedGalleryRecord,
  seedLike,
  setCachedCounts,
  type EphemeralClient,
  type EphemeralStylist,
} from './_fixtures';

type ListBody = {
  data?: { records?: Array<{ gallery_record_id: string; asset_url: string }> };
};
type GroupedBody = {
  data?: {
    groups?: Array<{
      favorites_count: number;
      recent_favorites: Array<{ gallery_record_id: string }>;
    }>;
  };
};

type Scenario = {
  stylist: EphemeralStylist;
  client: EphemeralClient;
  pairId: string;
  privateRecord: string;
  pinnedRecord: string;
};

/** Fresh stylist + client + ACTIVE direct pair, one private record and one liked pinned record. */
const seedScenario = async (label: string): Promise<Scenario> => {
  const stylist = await createEphemeralStylist(`${label}-stylist`);
  const client = await createEphemeralClient(`${label}-client`);
  const pairId = await seedActivePair(client.userId, stylist.accountId);
  const privateRecord = await seedGalleryRecord(stylist.accountId);
  const pinnedRecord = await seedGalleryRecord(stylist.accountId);
  await dbQuery(
    `UPDATE "GalleryRecord" SET is_pinned = true WHERE gallery_record_id = $1`,
    [pinnedRecord]
  );
  await seedLike(client.userId, pinnedRecord);
  await syncLikes(stylist.accountId);
  return { stylist, client, pairId, privateRecord, pinnedRecord };
};

/** Seeded likes bypass the counter writer; align cached_likes_count so the invariant measures only the race. */
const syncLikes = async (accountId: string): Promise<void> => {
  const live = await readLiveCounts(accountId);
  await setCachedCounts(accountId, { likes: live.live_likes_count });
};

const add = (s: Scenario, recordId: string) =>
  apiCallRaw({
    endpoint: ROUTES_API.FAVORITE_ADD_RECORD,
    method: 'POST',
    token: s.client.token,
    body: { gallery_record_id: recordId },
  });

const revoke = (s: Scenario) =>
  apiCallRaw({
    endpoint: ROUTES_API.PAIRING_ACCESS_REVOKE,
    method: 'POST',
    token: s.client.token,
    body: { target_account_id: s.stylist.accountId },
  });

/** Post-condition shared by every interleaving. */
const assertNoPrivateLeak = async (
  s: Scenario,
  where: string
): Promise<void> => {
  const pair = await dbQueryOne<{ status: string }>(
    `SELECT status FROM "ClientStylistPair" WHERE id = $1`,
    [s.pairId]
  );
  assertEqual(pair?.status, 'REVOKED', `${where}: pair status`);

  const rows = await dbQueryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM "FavoriteGalleryRecord" WHERE client_user_id = $1 AND gallery_record_id = $2`,
    [s.client.userId, s.privateRecord]
  );
  assertEqual(
    Number(rows?.n ?? -1),
    0,
    `${where}: private like rows after a committed revoke`
  );

  const list = await apiCallRaw<ListBody>({
    endpoint: ROUTES_API.FAVORITE_GET_RECORDS,
    token: s.client.token,
  });
  assertEqual(list.status, 200, `${where}: list status`);
  const ids = (list.body.data?.records ?? []).map(r => r.gallery_record_id);
  assertTrue(
    !ids.includes(s.privateRecord),
    `${where}: LEAK — get-records returned the private record ${s.privateRecord}`
  );
  assertTrue(
    ids.includes(s.pinnedRecord),
    `${where}: pinned like must survive revoke (public channel), got ${JSON.stringify(ids)}`
  );

  const grouped = await apiCallRaw<GroupedBody>({
    endpoint: ROUTES_API.FAVORITE_GET_GROUPED,
    token: s.client.token,
  });
  const groupedIds = (grouped.body.data?.groups ?? []).flatMap(g =>
    g.recent_favorites.map(f => f.gallery_record_id)
  );
  assertTrue(
    !groupedIds.includes(s.privateRecord),
    `${where}: LEAK — get-grouped returned the private record`
  );

  const cached = await dbQueryOne<{ c: number }>(
    `SELECT cached_likes_count AS c FROM "StylistAccount" WHERE account_id = $1`,
    [s.stylist.accountId]
  );
  const live = await readLiveCounts(s.stylist.accountId);
  assertEqual(
    cached?.c,
    live.live_likes_count,
    `${where}: cached_likes_count vs live rows`
  );
};

const waitUntil = async (
  probe: () => Promise<boolean>,
  timeoutMs: number
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) {
      return true;
    }
    await new Promise(r => setTimeout(r, 20));
  }
  return false;
};

test(
  'add blocked at the stylist lock + revoke: no surviving private like, no asset_url in either list',
  async () => {
    const s = await seedScenario('t3-lock');
    // Warm compilation of every route on the path, so the timed window measures locks, not the dev compiler.
    await apiCallRaw({
      endpoint: ROUTES_API.FAVORITE_GET_RECORDS,
      token: s.client.token,
    });
    await apiCallRaw({
      endpoint: ROUTES_API.FAVORITE_GET_GROUPED,
      token: s.client.token,
    });
    await add(s, 'cmissingrace0000000000000');
    await apiCallRaw({
      endpoint: ROUTES_API.PAIRING_ACCESS_REVOKE,
      method: 'POST',
      token: s.client.token,
      body: { target_account_id: 'cmissingrace0000000000000' },
    });

    const holder = await getDbPool().connect();
    let released = false;
    const release = async (): Promise<void> => {
      if (!released) {
        released = true;
        await holder.query('COMMIT');
      }
    };
    try {
      await holder.query('BEGIN');
      const pidRow = await holder.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid'
      );
      const holderPid = pidRow.rows[0]?.pid;
      await holder.query(
        `SELECT 1 FROM "StylistAccount" WHERE account_id = $1 FOR UPDATE`,
        [s.stylist.accountId]
      );
      // Backends queued behind the holder, directly or behind a backend that is (a second FOR UPDATE on the
      // same row waits on the first waiter's tuple lock, so pg_blocking_pids names that waiter, not the holder).
      const blockedByHolder = async (): Promise<number> => {
        const r = await dbQueryOne<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_stat_activity a
            WHERE $1 = ANY(pg_blocking_pids(a.pid))
               OR EXISTS (SELECT 1 FROM pg_stat_activity b
                           WHERE $1 = ANY(pg_blocking_pids(b.pid))
                             AND b.pid = ANY(pg_blocking_pids(a.pid)))`,
          [holderPid]
        );
        return Number(r?.n ?? 0);
      };

      const adding = add(s, s.privateRecord);
      const addWaits = await waitUntil(
        async () => (await blockedByHolder()) >= 1,
        10_000
      );
      assertTrue(
        addWaits,
        'precondition: add-record never blocked on the stylist row lock'
      );

      let revokeDone = false;
      const revoking = revoke(s).then(r => {
        revokeDone = true;
        return r;
      });
      // Old code: revoke takes no stylist lock and answers while the holder still blocks add.
      // Fixed code: revoke queues behind the same lock (a second blocked backend).
      // Bounded well under Prisma's 5 s interactive-tx timeout, which the blocked add is already spending.
      await waitUntil(
        async () => revokeDone || (await blockedByHolder()) >= 2,
        2_500
      );
      const revokeFinishedWhileAddBlocked = revokeDone;
      const revokeQueuedBehindLock =
        !revokeDone && (await blockedByHolder()) >= 2;
      await release();

      const [addResp, revokeResp] = await Promise.all([adding, revoking]);
      assertNo500([addResp, revokeResp]);
      assertEqual(revokeResp.status, 200, 'revoke status');
      assertTrue(
        [201, 404].includes(addResp.status),
        `add status ${addResp.status} (201 then deleted, or 404 refused)`
      );
      await assertNoPrivateLeak(s, 'T3 controlled interleaving');
      assertTrue(
        !revokeFinishedWhileAddBlocked,
        'revoke committed while add was blocked at the stylist lock: the two are not serialized'
      );
      assertTrue(
        revokeQueuedBehindLock,
        'revoke was never observed waiting on the stylist lock'
      );
    } finally {
      await release().catch(() =>
        holder.query('ROLLBACK').catch(() => undefined)
      );
      holder.release();
    }
  },
  'F1/T3 add-vs-revoke serialized on lockStylistAccount, recheck after lock'
);

test(
  'like orphaned after a revoke (row exists, access gone) is not returned by get-records or get-grouped',
  async () => {
    const s = await seedScenario('t3-orphan');
    // The exact end state of the old race, seeded directly: REVOKED pair + a surviving unpinned like.
    await dbQuery(
      `UPDATE "ClientStylistPair" SET status = 'REVOKED', revoked_at = now(), revoked_by = 'CLIENT' WHERE id = $1`,
      [s.pairId]
    );
    await seedLike(s.client.userId, s.privateRecord);
    await syncLikes(s.stylist.accountId);

    const list = await apiCallRaw<ListBody>({
      endpoint: ROUTES_API.FAVORITE_GET_RECORDS,
      token: s.client.token,
    });
    const ids = (list.body.data?.records ?? []).map(r => r.gallery_record_id);
    assertTrue(
      !ids.includes(s.privateRecord),
      'LEAK — orphaned private like returned by get-records'
    );
    assertTrue(ids.includes(s.pinnedRecord), 'pinned like must stay readable');

    const grouped = await apiCallRaw<GroupedBody>({
      endpoint: ROUTES_API.FAVORITE_GET_GROUPED,
      token: s.client.token,
    });
    const groups = grouped.body.data?.groups ?? [];
    const groupedIds = groups.flatMap(g =>
      g.recent_favorites.map(f => f.gallery_record_id)
    );
    assertTrue(
      !groupedIds.includes(s.privateRecord),
      'LEAK — orphaned private like returned by get-grouped'
    );
    assertEqual(
      groups[0]?.favorites_count,
      1,
      'favorites_count counts only readable likes'
    );

    // Pagination over the filtered set: take=1 walks pinned only, no empty page, no cursor onto the orphan.
    const page = await apiCallRaw<{
      data?: { records?: unknown[]; nextCursor?: string | null };
    }>({
      endpoint: `${ROUTES_API.FAVORITE_GET_RECORDS}?take=1`,
      token: s.client.token,
    });
    assertEqual(page.body.data?.records?.length, 1, 'first page of 1');
    assertEqual(
      page.body.data?.nextCursor ?? null,
      null,
      'no next page: the orphan is filtered before pagination'
    );
  },
  'F1 read boundary: current access, not row existence'
);

test(
  'unsynchronized add ⊥ revoke bursts on fresh pairs: no leak, counter exact, no deadlock or 5xx',
  async () => {
    const ITER = 5;
    for (let i = 0; i < ITER; i++) {
      const s = await seedScenario(`t3-burst-${i}`);
      const responses = await fireParallel([
        {
          endpoint: ROUTES_API.FAVORITE_ADD_RECORD,
          method: 'POST',
          token: s.client.token,
          body: { gallery_record_id: s.privateRecord },
        },
        {
          endpoint: ROUTES_API.PAIRING_ACCESS_REVOKE,
          method: 'POST',
          token: s.client.token,
          body: { target_account_id: s.stylist.accountId },
        },
      ]);
      assertNo500(responses);
      await assertNoPrivateLeak(s, `burst ${i}`);
    }
  },
  'F1/T3 repeated races: both orders valid, no 40P01'
);

// Tests register on import.
