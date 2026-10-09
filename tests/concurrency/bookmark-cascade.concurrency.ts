// tests/concurrency/bookmark-cascade.concurrency.ts
//
// FAMILY 5 — bookmark-cascade drift (decrementBookmarksForDeletedClient, finding
// CWT-1 / ioA-3 / SCHEMA-01 — the likes path had this fix; bookmark was OVERLOOKED).
//
// THE BUG (pre-fix): FavoriteStylist.client_user_id has onDelete:Cascade. A client
// hard-delete (gdpr-erase → deleteSelfUser_IO → deleteUser_IO) removed the client's
// FavoriteStylist rows at the DB level WITHOUT routing through the
// cached_bookmark_count write-path → permanent INFLATION (overstated drift) of every
// bookmarked stylist's cached_bookmark_count (served publicly as bookmark_count
// social-proof), self-healed only at the next startup backfill.
//
// THE FIX: decrementBookmarksForDeletedClient(tx, clientUserId) runs INSIDE the same
// tx as user.delete, BEFORE the FK cascade wipes the rows, grouping the client's
// bookmarks by owner and floored-decrementing each StylistAccount in one round-trip.
//
// INVARIANT (must ALWAYS hold; FAILS on pre-fix code = RED guard):
//   cached_bookmark_count == live count(FavoriteStylist for that stylist),
//   never negative.
//
// TEST A — cascade (deterministic): bookmark through the REAL writer, then the client
// gdpr-erases itself; after the delete BOTH the live count AND cached must be 0.
// TEST B — toggle race: fire BOOKMARK ⊥ UNBOOKMARK in parallel repeatedly; the cached
// counter must always reconverge to the live count (0 or 1), never go negative, no 500.

import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { apiCallRaw, fireParallel } from '../utils/api-client';
import { test, assertTrue, assertNo500 } from './_harness';
import { dbQueryOne } from '../utils/db-client';
import {
  createEphemeralStylist,
  createEphemeralClient,
  seedBookmark,
  setCachedCounts,
  countBookmarks,
} from './_fixtures';

/** Read the denormalized cached_bookmark_count for a stylist account. */
const readCachedBookmark = async (accountId: string): Promise<number | null> => {
  const row = await dbQueryOne<{ cached_bookmark_count: number }>(
    `SELECT cached_bookmark_count FROM "StylistAccount" WHERE account_id = $1`,
    [accountId]
  );
  return row == null ? null : row.cached_bookmark_count;
};

test(
  'client gdpr-erase decrements bookmarked stylist cached count in-tx before FK cascade',
  async () => {
    const stylist = await createEphemeralStylist('bm-cascade-stylist');
    const client = await createEphemeralClient('bm-cascade-client');

    // Set up the bookmark through the REAL writer so the counter increments via the
    // production path. A freshly dev-login'd stylist is ACTIVE + is_active ⇒ publicly
    // visible, so the real BOOKMARK_STYLIST should succeed. If it ever returns
    // STYLIST_NOT_FOUND (not publicly visible), fall back to a direct SQL seed.
    const bookmarkResp = await apiCallRaw({
      endpoint: ROUTES_API.BOOKMARK_STYLIST,
      method: 'POST',
      token: client.token,
      body: { stylist_account_id: stylist.accountId },
    });

    let setupPath: string;
    if (bookmarkResp.status === 201 || bookmarkResp.status === 200) {
      setupPath = 'real-api';
    } else {
      // Fallback: stylist not publicly visible to the real writer — seed the row and
      // the cached counter directly, then exercise the cascade decrement.
      await seedBookmark(client.userId, stylist.accountId);
      await setCachedCounts(stylist.accountId, { bookmark: 1 });
      setupPath = `seed-fallback (bookmark returned ${bookmarkResp.status})`;
    }

    // Precondition: exactly one bookmark, counter in sync.
    const liveBefore = await countBookmarks(stylist.accountId);
    const cachedBefore = await readCachedBookmark(stylist.accountId);
    assertTrue(
      liveBefore === 1 && cachedBefore === 1,
      `[${setupPath}] setup expected live=1 cached=1, got live=${liveBefore} cached=${cachedBefore}`
    );

    // Client deletes itself (GDPR Art.17 hard-delete). actor = the client themself.
    const eraseResp = await apiCallRaw({
      endpoint: ROUTES_API.USER_GDPR_ERASE,
      method: 'POST',
      token: client.token,
      body: {},
    });
    assertTrue(
      eraseResp.status === 200 || eraseResp.status === 201,
      `gdpr-erase failed: ${eraseResp.status} ${JSON.stringify(eraseResp.body)}`
    );

    // After the cascade: the FavoriteStylist row is gone AND the cached counter was
    // decremented in-tx (pre-fix: cached would stay 1 = overstated drift = RED).
    const liveAfter = await countBookmarks(stylist.accountId);
    const cachedAfter = await readCachedBookmark(stylist.accountId);
    assertTrue(
      liveAfter === 0,
      `[${setupPath}] live count after erase expected 0, got ${liveAfter}`
    );
    assertTrue(
      cachedAfter === 0,
      `[${setupPath}] CACHED DRIFT — cached_bookmark_count after client erase expected 0, got ${cachedAfter} (decrementBookmarksForDeletedClient did not run before cascade)`
    );
  },
  'CWT-1/ioA-3 bookmark-cascade: client hard-delete decrements cached_bookmark_count'
);

test(
  'BOOKMARK ⊥ UNBOOKMARK toggle race keeps cached_bookmark_count == live count, never negative',
  async () => {
    const stylist = await createEphemeralStylist('bm-toggle-stylist');
    const client = await createEphemeralClient('bm-toggle-client');
    const ITER = 10;
    const allResponses: { status: number; body?: unknown }[] = [];

    for (let i = 0; i < ITER; i++) {
      const responses = await fireParallel([
        {
          endpoint: ROUTES_API.BOOKMARK_STYLIST,
          method: 'POST',
          token: client.token,
          body: { stylist_account_id: stylist.accountId },
        },
        {
          endpoint: ROUTES_API.UNBOOKMARK_STYLIST,
          method: 'POST',
          token: client.token,
          body: { stylist_account_id: stylist.accountId },
        },
      ]);
      allResponses.push(...responses);

      // After each interleaving the cached counter must equal the live row count and
      // be non-negative — regardless of which writer landed first.
      const live = await countBookmarks(stylist.accountId);
      const cached = await readCachedBookmark(stylist.accountId);
      if (cached == null) {
        throw new Error(`iter ${i}: stylist account vanished`);
      }
      assertTrue(
        cached >= 0,
        `iter ${i}: cached_bookmark_count went NEGATIVE: ${cached}`
      );
      assertTrue(
        live === 0 || live === 1,
        `iter ${i}: live bookmark count out of toggle range (0|1): ${live}`
      );
      assertTrue(
        cached === live,
        `iter ${i}: COUNTER DRIFT — cached=${cached} live=${live}`
      );
    }

    assertNo500(allResponses);
  },
  'CWT-1/ioA-3 bookmark-count toggle stays in sync, never negative, no 5xx'
);

// Tests register on import.
