/**
 * Bookmarks — `cached_bookmark_count` write-path (single owner).
 *
 * `cached_bookmark_count` is a denormalized counter on StylistAccount (public bookmark_count
 * social-proof in public-stylists-list + bookmarked-stylists + account-profile). It counts the
 * FavoriteStylist rows pointing at the account. This module is the ONE owner of every
 * increment/decrement of that column, parytet z favorite-count.helper.ts (cached_likes_count) i
 * gallery-count.helper.ts (cached_gallery_count). Writer sites: bookmark add (+1) / unbookmark (-1)
 * and client hard-delete cascade (-N per affected stylist).
 *
 * Both per-account helpers MUST be called INSIDE an active interactive `$transaction` (tx) so the
 * counter mutation commits/rolls back atomically with the bookmark mutation it accompanies.
 */

import type { Prisma } from '../../../prisma/js-client';

// DECISION: this file is the only writer of cached_bookmark_count (add, unbookmark, client hard-delete
// cascade). The column is INTEGER NOT NULL DEFAULT 0 with CHECK(>=0), but the CHECK is only a backstop:
// the GREATEST(0, ...) floor must stay in the writer. The count is ALL FavoriteStylist rows of the
// stylist, with no visibility predicate (a bookmark is a client->stylist relation, not tied to a gallery
// record), matching the backfill's raw _count.favorited_by. Self-bookmark and not-visible-stylist never
// create a row (guard in bookmarkStylist_IO before create), so write path and backfill agree.

// Increment in a single round-trip (no read-modify-write) — race-safe under concurrent inserts.
// `by` is always a row count (>=1 at every caller), interpolated as ${by}::int (parameterized).
// Returns the number of rows changed.
export const incrementBookmarkCount = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  by: number
): Promise<number> => {
  return tx.$executeRaw`
    UPDATE "StylistAccount"
       SET "cached_bookmark_count" = "cached_bookmark_count" + ${by}::int
     WHERE "account_id" = ${accountId}`;
};

// Floor-at-zero decrement via GREATEST(0, count - by) in a single round-trip — anti-negative,
// race-safe even without a row lock, idempotent under existing understated drift (parytet z
// decrementLikeCountFloored / decrementGalleryCountFloored). `by` interpolated as ${by}::int.
export const decrementBookmarkCountFloored = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  by: number
): Promise<number> => {
  return tx.$executeRaw`
    UPDATE "StylistAccount"
       SET "cached_bookmark_count" = GREATEST(0, "cached_bookmark_count" - ${by}::int)
     WHERE "account_id" = ${accountId}`;
};

// DECISION: FavoriteStylist.client_user_id is onDelete:Cascade, so a hard-deleted client's bookmarks
// vanish in the DB without passing decrementBookmarkCountFloored, which would leave every bookmarked
// stylist's cached_bookmark_count inflated until the next startup backfill. This helper therefore runs
// in the same tx as user.delete and MUST be called BEFORE it (after the cascade the rows are gone). It
// counts all of the client's rows per stylist (no is_hidden predicate). For dual-role users the client's
// own StylistAccount may be cascade-deleted in the same tx: the update hits it first or matches 0 rows.
export const decrementBookmarksForDeletedClient = async (
  tx: Prisma.TransactionClient,
  clientUserId: string
): Promise<number> => {
  return tx.$executeRaw`
    UPDATE "StylistAccount" sa
       SET "cached_bookmark_count" = GREATEST(0, sa."cached_bookmark_count" - sub.cnt)
      FROM (
        SELECT "stylist_account_id" AS acc, COUNT(*)::int AS cnt
          FROM "FavoriteStylist"
         WHERE "client_user_id" = ${clientUserId}
         GROUP BY "stylist_account_id"
      ) AS sub
     WHERE sa."account_id" = sub.acc`;
};
