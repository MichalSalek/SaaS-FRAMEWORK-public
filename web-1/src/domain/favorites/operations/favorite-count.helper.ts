/**
 * Only writer of StylistAccount.cached_likes_count (visible likes, is_hidden=false,
 * same predicate as the dashboard and public profile). Callers: favorite add and
 * remove, gallery-delete, moderation hide/delete/ban, pairing-revoke, client hard-delete.
 * The stylist is GalleryRecord.created_by_account_id (one JOIN in
 * decrementLikesForDeletedClient). Both per-account helpers must run inside the
 * caller's interactive $transaction or the counter can commit without the like.
 */

import type { Prisma } from '../../../prisma/js-client';

// DECISION: this file is the only writer of cached_likes_count (parity with gallery-count.helper.ts).
// The count is likes of VISIBLE records (is_hidden=false); un-hide/un-ban deliberately do not
// re-increment (same as cached_gallery_count), and cached-counts-backfill.ts self-heals with the same
// predicate. The column has a CHECK(>=0) backstop (migration 20261023100000) but the GREATEST(0, ...) floor
// stays in the writer. Favorite add and remove take lockStylistAccount (StylistAccount first in the global
// lock order) before the row operation, so row op and counter op are serialized per stylist: add
// increments only after a successful create (P2002 = no increment); remove decrements only when
// deleteMany deleted exactly 1 row and the record is visible under the lock. Without the lock an
// add/remove interleave undercounted by 1. Pairing-revoke decrements by the count of deleteMany
// (is_hidden:false) and deletes hidden rows without a decrement; counting before the delete let a
// concurrently added visible favorite slip through. gallery-delete and favorite-vs-moderation-HIDE
// on the same record stay count-then-mutate without a shared lock (READ COMMITTED, bounded +/-1):
// the same as cached_gallery_count, the backfill self-heals, and a lock there costs deadlock risk for a
// millisecond window. Re-checking is_hidden just before the increment was rejected: it only narrows the window.

// Increment in a single round-trip (no read-modify-write) — race-safe under concurrent inserts.
// `by` is always a record count (>=1 at every caller), interpolated as ${by}::int (parameterized).
// Returns the number of rows changed.
export const incrementLikeCount = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  by: number
): Promise<number> => {
  return tx.$executeRaw`
    UPDATE "StylistAccount"
       SET "cached_likes_count" = "cached_likes_count" + ${by}::int
     WHERE "account_id" = ${accountId}`;
};

// Floor-at-zero decrement via GREATEST(0, count - by) in a single round-trip — anti-negative, race-safe
// even without a row lock, idempotent under existing understated drift (parytet z
// decrementGalleryCountFloored). `by` interpolated as ${by}::int. Returns rows changed.
export const decrementLikeCountFloored = async (
  tx: Prisma.TransactionClient,
  accountId: string,
  by: number
): Promise<number> => {
  return tx.$executeRaw`
    UPDATE "StylistAccount"
       SET "cached_likes_count" = GREATEST(0, "cached_likes_count" - ${by}::int)
     WHERE "account_id" = ${accountId}`;
};

// DECISION: FavoriteGalleryRecord.client_user_id is onDelete:Cascade, so a hard-deleted client's likes
// vanish in the DB without passing decrementLikeCountFloored. This helper counts the client's visible
// likes per record owner and decrements each StylistAccount in one round-trip, in the same tx as
// user.delete, and MUST be called BEFORE it (after the cascade the rows are gone). For dual-role users
// the client's own StylistAccount may be cascade-deleted in the same tx: the update hits it first or
// matches 0 rows.
export const decrementLikesForDeletedClient = async (
  tx: Prisma.TransactionClient,
  clientUserId: string
): Promise<number> => {
  return tx.$executeRaw`
    UPDATE "StylistAccount" sa
       SET "cached_likes_count" = GREATEST(0, sa."cached_likes_count" - sub.cnt)
      FROM (
        SELECT gr."created_by_account_id" AS acc, COUNT(*)::int AS cnt
          FROM "FavoriteGalleryRecord" f
          JOIN "GalleryRecord" gr ON gr."gallery_record_id" = f."gallery_record_id"
         WHERE f."client_user_id" = ${clientUserId}
           AND gr."is_hidden" = false
         GROUP BY gr."created_by_account_id"
      ) AS sub
     WHERE sa."account_id" = sub.acc`;
};
