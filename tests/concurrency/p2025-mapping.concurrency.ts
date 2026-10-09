// tests/concurrency/p2025-mapping.concurrency.ts
//
// FAMILY 6 — P2025 mapping: a delete/update of a row that VANISHED between the
// find and the act must surface as a mapped 4xx (or an idempotent 2xx), NEVER an
// unmapped Prisma P2025 → 500.
//
// THE BUG CLASS (pre-fix): the weak find-then-act ops read a row (findUnique),
// then mutate it on the unique key. Under READ COMMITTED a concurrent delete of
// THE SAME row, committing BETWEEN the read and the write, makes the write throw
// Prisma P2025 ("record to update/delete not found"). If that throw lands in a
// bare `catch → databaseFailure` (or isn't caught at all) it maps to an opaque
// 500 — the race-loser sees a server error instead of an honest "it's gone" 4xx.
//
// THE FIX (what these guards pin):
//   • ROBUST idempotent delete paths (FAVORITE_REMOVE_RECORD / UNBOOKMARK_STYLIST)
//     already delete-on-unique and translate P2025 → success(false) → idempotent
//     200. Double-firing them in parallel must yield two <500 responses, never a
//     crash on the second (losing) writer.
//   • TOCTOU find-then-act ops (FAVORITE_UPDATE_RECORD_NOTE, GALLERY_UNPIN_RECORD)
//     racing a concurrent delete of the same row: the loser must come back as a
//     mapped 404 (RECORD_NOT_IN_FAVORITES / GALLERY_RECORD_NOT_FOUND), never 500.
//
// INVARIANT (must ALWAYS hold; FAILS on pre-fix code = RED guard):
//   assertNo500 across EVERY response of the race; the vanished-row branch returns
//   a mapped status (idempotent 200 for remove/unbookmark; 200|404 for the loser of
//   the update/unpin TOCTOU pair). We also assert DIRECTLY on Postgres after each
//   race that the row is actually gone — "no 500" alone is not proof.
//
// Status map verified against error-mapper.ts:
//   RECORD_NOT_IN_FAVORITES → respondNotFound      → 404
//   GALLERY_RECORD_NOT_FOUND → respondNotFound      → 404
//   GALLERY_RECORD_NOT_PINNED → respondBadRequest   → 400

import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { fireParallel, fireParallelSame } from '../utils/api-client';
import { test, assertTrue, assertOneOf, assertNo500 } from './_harness';
import { dbQuery, dbQueryOne } from '../utils/db-client';
import {
  createEphemeralStylist,
  createEphemeralClient,
  seedGalleryRecord,
  seedBookmark,
  seedLike,
  countBookmarks,
} from './_fixtures';

// --- direct-SQL readers/setters scoped to this family ------------------------

/** Live count of FavoriteGalleryRecord rows for a (client, record) pair. */
const countFavoriteRow = async (
  clientUserId: string,
  galleryRecordId: string
): Promise<number> => {
  const row = await dbQueryOne<{ cnt: string }>(
    `SELECT count(*)::text AS cnt FROM "FavoriteGalleryRecord"
      WHERE client_user_id = $1 AND gallery_record_id = $2`,
    [clientUserId, galleryRecordId]
  );
  return Number(row?.cnt ?? 0);
};

/** Whether a GalleryRecord row still exists. */
const galleryRecordExists = async (galleryRecordId: string): Promise<boolean> => {
  const row = await dbQueryOne<{ cnt: string }>(
    `SELECT count(*)::text AS cnt FROM "GalleryRecord" WHERE gallery_record_id = $1`,
    [galleryRecordId]
  );
  return Number(row?.cnt ?? 0) > 0;
};

/** Force a gallery record into the pinned state (precondition for unpin). */
const pinRecordDirectly = async (galleryRecordId: string): Promise<void> => {
  await dbQuery(
    `UPDATE "GalleryRecord" SET is_pinned = true WHERE gallery_record_id = $1`,
    [galleryRecordId]
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// ROBUST PATH 1 — FAVORITE_REMOVE_RECORD double-fire is idempotent, never 500.
// ─────────────────────────────────────────────────────────────────────────────
test(
  'FAVORITE_REMOVE_RECORD fired twice in parallel on a favorited record is idempotent (both <500)',
  async () => {
    const stylist = await createEphemeralStylist('p2025-rm-stylist');
    const record = await seedGalleryRecord(stylist.accountId);
    const client = await createEphemeralClient('p2025-rm-client');

    // Deterministic guard FIRST: a sequential second remove on an already-removed
    // favorite must be idempotent 200, never a P2025 → 500. (Pre-fix: a remove that
    // re-threw P2025 instead of mapping to success(false) would 500 here.)
    await seedLike(client.userId, record);
    const firstRemove = await fireParallelSame(
      {
        endpoint: ROUTES_API.FAVORITE_REMOVE_RECORD,
        method: 'POST',
        token: client.token,
        body: { gallery_record_id: record },
      },
      1
    );
    assertOneOf(
      firstRemove[0]?.status ?? -1,
      [200],
      `first remove status: ${JSON.stringify(firstRemove[0]?.body)}`
    );
    const secondRemove = await fireParallelSame(
      {
        endpoint: ROUTES_API.FAVORITE_REMOVE_RECORD,
        method: 'POST',
        token: client.token,
        body: { gallery_record_id: record },
      },
      1
    );
    assertOneOf(
      secondRemove[0]?.status ?? -1,
      [200],
      `idempotent second remove must be 200, got ${secondRemove[0]?.status}: ${JSON.stringify(secondRemove[0]?.body)}`
    );

    // Race loop: re-seed the like, double-fire remove. One writer deletes (200),
    // the loser hits P2025 → success(false) → 200. Never a 500.
    const ITER = 12;
    const all: { status: number; body?: unknown }[] = [];
    for (let i = 0; i < ITER; i++) {
      await seedLike(client.userId, record);
      const responses = await fireParallelSame<{ event: string }>(
        {
          endpoint: ROUTES_API.FAVORITE_REMOVE_RECORD,
          method: 'POST',
          token: client.token,
          body: { gallery_record_id: record },
        },
        2
      );
      all.push(...responses);
      for (const r of responses) {
        assertOneOf(
          r.status,
          [200],
          `iter ${i}: parallel remove must be idempotent 200, got ${r.status}: ${JSON.stringify(r.body)}`
        );
      }
      // Postgres proof: the favorite row is actually gone after the race.
      const remaining = await countFavoriteRow(client.userId, record);
      assertTrue(
        remaining === 0,
        `iter ${i}: favorite row survived double-remove (count=${remaining})`
      );
    }
    assertNo500(all);
  },
  'p2025-remove: idempotent FAVORITE_REMOVE_RECORD double-fire maps P2025→200, no 500'
);

// ─────────────────────────────────────────────────────────────────────────────
// ROBUST PATH 2 — UNBOOKMARK_STYLIST double-fire is idempotent, never 500.
// ─────────────────────────────────────────────────────────────────────────────
test(
  'UNBOOKMARK_STYLIST fired twice in parallel on a bookmarked stylist is idempotent (both <500)',
  async () => {
    const stylist = await createEphemeralStylist('p2025-unbm-stylist');
    const client = await createEphemeralClient('p2025-unbm-client');

    // Deterministic guard: sequential double-unbookmark — both idempotent 200.
    await seedBookmark(client.userId, stylist.accountId);
    const first = await fireParallelSame(
      {
        endpoint: ROUTES_API.UNBOOKMARK_STYLIST,
        method: 'POST',
        token: client.token,
        body: { stylist_account_id: stylist.accountId },
      },
      1
    );
    assertOneOf(first[0]?.status ?? -1, [200], `first unbookmark: ${JSON.stringify(first[0]?.body)}`);
    const second = await fireParallelSame(
      {
        endpoint: ROUTES_API.UNBOOKMARK_STYLIST,
        method: 'POST',
        token: client.token,
        body: { stylist_account_id: stylist.accountId },
      },
      1
    );
    assertOneOf(
      second[0]?.status ?? -1,
      [200],
      `idempotent second unbookmark must be 200, got ${second[0]?.status}: ${JSON.stringify(second[0]?.body)}`
    );

    const ITER = 12;
    const all: { status: number; body?: unknown }[] = [];
    for (let i = 0; i < ITER; i++) {
      await seedBookmark(client.userId, stylist.accountId);
      const responses = await fireParallelSame<{ event: string }>(
        {
          endpoint: ROUTES_API.UNBOOKMARK_STYLIST,
          method: 'POST',
          token: client.token,
          body: { stylist_account_id: stylist.accountId },
        },
        2
      );
      all.push(...responses);
      for (const r of responses) {
        assertOneOf(
          r.status,
          [200],
          `iter ${i}: parallel unbookmark must be idempotent 200, got ${r.status}: ${JSON.stringify(r.body)}`
        );
      }
      const remaining = await countBookmarks(stylist.accountId);
      assertTrue(
        remaining === 0,
        `iter ${i}: bookmark row survived double-unbookmark (count=${remaining})`
      );
    }
    assertNo500(all);
  },
  'p2025-unbookmark: idempotent UNBOOKMARK_STYLIST double-fire maps P2025→200, no 500'
);

// ─────────────────────────────────────────────────────────────────────────────
// TOCTOU 1 — FAVORITE_UPDATE_RECORD_NOTE ⊥ FAVORITE_REMOVE_RECORD same record.
// find-then-update racing a concurrent delete; loser must be 404, never 500.
// ─────────────────────────────────────────────────────────────────────────────
test(
  'FAVORITE_UPDATE_RECORD_NOTE racing FAVORITE_REMOVE_RECORD never 500s; vanished-favorite update maps to 404',
  async () => {
    const stylist = await createEphemeralStylist('p2025-note-stylist');
    const record = await seedGalleryRecord(stylist.accountId);
    const client = await createEphemeralClient('p2025-note-client');

    // Deterministic guard: remove the favorite, THEN update its note. The row is
    // gone → must be mapped 404 RECORD_NOT_IN_FAVORITES, never 500.
    await seedLike(client.userId, record);
    const removeFirst = await fireParallelSame(
      {
        endpoint: ROUTES_API.FAVORITE_REMOVE_RECORD,
        method: 'POST',
        token: client.token,
        body: { gallery_record_id: record },
      },
      1
    );
    assertOneOf(removeFirst[0]?.status ?? -1, [200], `setup remove: ${JSON.stringify(removeFirst[0]?.body)}`);
    const noteOnVanished = await fireParallelSame(
      {
        endpoint: ROUTES_API.FAVORITE_UPDATE_RECORD_NOTE,
        method: 'POST',
        token: client.token,
        body: { gallery_record_id: record, note: 'note-on-vanished' },
      },
      1
    );
    assertOneOf(
      noteOnVanished[0]?.status ?? -1,
      [404],
      `note-update on vanished favorite must be 404, got ${noteOnVanished[0]?.status}: ${JSON.stringify(noteOnVanished[0]?.body)}`
    );

    // Race loop: re-seed, fire UPDATE_NOTE ⊥ REMOVE on the same favorite.
    const ITER = 16;
    const all: { status: number; body?: unknown }[] = [];
    for (let i = 0; i < ITER; i++) {
      await seedLike(client.userId, record);
      const [updateResp, removeResp] = await fireParallel<{ event: string }>([
        {
          endpoint: ROUTES_API.FAVORITE_UPDATE_RECORD_NOTE,
          method: 'POST',
          token: client.token,
          body: { gallery_record_id: record, note: `race-note-${i}` },
        },
        {
          endpoint: ROUTES_API.FAVORITE_REMOVE_RECORD,
          method: 'POST',
          token: client.token,
          body: { gallery_record_id: record },
        },
      ]);
      if (updateResp == null || removeResp == null) {
        throw new Error(`iter ${i}: missing response from fireParallel`);
      }
      all.push(updateResp, removeResp);

      // Remove is idempotent → always 200. Update is either 200 (it won, note set)
      // or 404 RECORD_NOT_IN_FAVORITES (remove won, row vanished). NEVER 500.
      assertOneOf(
        removeResp.status,
        [200],
        `iter ${i}: remove must be 200, got ${removeResp.status}: ${JSON.stringify(removeResp.body)}`
      );
      assertOneOf(
        updateResp.status,
        [200, 404],
        `iter ${i}: note-update loser must be 200|404 (not a 500 P2025 leak), got ${updateResp.status}: ${JSON.stringify(updateResp.body)}`
      );

      // Postgres proof: remove always deletes the favorite (whether or not update
      // landed first), so the row is gone after the race.
      const remaining = await countFavoriteRow(client.userId, record);
      assertTrue(
        remaining === 0,
        `iter ${i}: favorite row survived update⊥remove race (count=${remaining})`
      );
    }
    assertNo500(all);
  },
  'p2025-toctou-note: UPDATE_RECORD_NOTE ⊥ REMOVE loser maps P2025→404, no 500'
);

// ─────────────────────────────────────────────────────────────────────────────
// TOCTOU 2 — GALLERY_UNPIN_RECORD ⊥ DELETE_GALLERY_RECORD same record (owner).
// find-then-update racing a concurrent delete; loser must be 404/400, never 500.
// ─────────────────────────────────────────────────────────────────────────────
test(
  'GALLERY_UNPIN_RECORD racing DELETE_GALLERY_RECORD never 500s; vanished-record unpin maps to 404',
  async () => {
    const stylist = await createEphemeralStylist('p2025-unpin-stylist');

    // Deterministic guard: delete a pinned record, THEN unpin it. Row gone → must
    // be mapped 404 GALLERY_RECORD_NOT_FOUND, never 500.
    const detRecord = await seedGalleryRecord(stylist.accountId);
    await pinRecordDirectly(detRecord);
    const deleteFirst = await fireParallelSame(
      {
        endpoint: ROUTES_API.DELETE_GALLERY_RECORD,
        method: 'POST',
        token: stylist.token,
        body: { gallery_record_id: detRecord },
      },
      1
    );
    assertOneOf(deleteFirst[0]?.status ?? -1, [200], `setup delete: ${JSON.stringify(deleteFirst[0]?.body)}`);
    const unpinVanished = await fireParallelSame(
      {
        endpoint: ROUTES_API.GALLERY_UNPIN_RECORD,
        method: 'POST',
        token: stylist.token,
        body: { gallery_record_id: detRecord },
      },
      1
    );
    assertOneOf(
      unpinVanished[0]?.status ?? -1,
      [404],
      `unpin on vanished record must be 404, got ${unpinVanished[0]?.status}: ${JSON.stringify(unpinVanished[0]?.body)}`
    );

    // Race loop: fresh pinned record each iter (DELETE destroys it), fire
    // UNPIN ⊥ DELETE on the same record.
    const ITER = 16;
    const all: { status: number; body?: unknown }[] = [];
    for (let i = 0; i < ITER; i++) {
      const record = await seedGalleryRecord(stylist.accountId);
      await pinRecordDirectly(record);
      const [unpinResp, deleteResp] = await fireParallel<{ event: string }>([
        {
          endpoint: ROUTES_API.GALLERY_UNPIN_RECORD,
          method: 'POST',
          token: stylist.token,
          body: { gallery_record_id: record },
        },
        {
          endpoint: ROUTES_API.DELETE_GALLERY_RECORD,
          method: 'POST',
          token: stylist.token,
          body: { gallery_record_id: record },
        },
      ]);
      if (unpinResp == null || deleteResp == null) {
        throw new Error(`iter ${i}: missing response from fireParallel`);
      }
      all.push(unpinResp, deleteResp);

      // Delete on an owned existing record always succeeds → 200. Unpin is either
      // 200 (it won), 404 GALLERY_RECORD_NOT_FOUND (delete won, row vanished), or
      // 400 GALLERY_RECORD_NOT_PINNED (defensive — never on a freshly pinned row,
      // but accepted as a mapped non-500). NEVER 500.
      assertOneOf(
        deleteResp.status,
        [200],
        `iter ${i}: delete must be 200, got ${deleteResp.status}: ${JSON.stringify(deleteResp.body)}`
      );
      assertOneOf(
        unpinResp.status,
        [200, 404, 400],
        `iter ${i}: unpin loser must be 200|404|400 (not a 500 P2025 leak), got ${unpinResp.status}: ${JSON.stringify(unpinResp.body)}`
      );

      // Postgres proof: delete always wins the existence battle — record is gone.
      const exists = await galleryRecordExists(record);
      assertTrue(
        !exists,
        `iter ${i}: gallery record survived unpin⊥delete race`
      );
    }
    assertNo500(all);
  },
  'p2025-toctou-unpin: UNPIN ⊥ DELETE loser maps P2025→404/400, no 500'
);

// Tests register on import.
