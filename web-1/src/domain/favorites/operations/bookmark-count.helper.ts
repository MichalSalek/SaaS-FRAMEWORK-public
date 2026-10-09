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

// DECISION (nie usuwaj tego komentarza) — bookmarks (FavoriteStylist) jest JEDYNYM wlascicielem
// write-path do cached_bookmark_count (parytet z favorite-count.helper [likes] + gallery-count.helper
// [gallery]). Increment (add) + decrement (unbookmark) + cascade (client hard-delete) przechodza przez
// TEN plik. Kolumna to plain INTEGER NOT NULL DEFAULT 0 + CHECK(>=0) (ensure-db-indexes) -> floor
// GREATEST(0,...) MUSI byc w kodzie pisarza (CHECK to backstop, nie zastapienie floora). SoT = WSZYSTKIE
// wiersze FavoriteStylist danej stylistki (BEZ predykatu widocznosci — bookmark to relacja
// client->stylist, nie do rekordu galerii; backfill liczy raw _count.favorited_by). Self-bookmark oraz
// not-visible-stylist NIE tworza wiersza (guard w bookmarkStylist_IO PRZED create) -> raw-row-count ==
// incremented value (parytet write-path<->backfill, CWT-5). drift recovery: cached-counts-backfill.ts.

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

// DECISION (nie usuwaj tego komentarza) — CLIENT HARD-DELETE CASCADE (mirror
// decrementLikesForDeletedClient; finding CWT-1 / ioA-3 / SCHEMA-01 — likes mialy ten fix, bookmark
// byl PRZEOCZONY): FavoriteStylist.client_user_id ma onDelete:Cascade -> twarde usuniecie klienta
// (deleteUser_IO, moveExpiredUserToArchive_IO) kasuje jego bookmarki na poziomie DB BEZ przejscia
// przez decrementBookmarkCountFloored -> trwaly drift (ZAWYZENIE) cached_bookmark_count kazdej
// stylistki, ktora ten klient bookmarkowal (serwowane publicznie jako bookmark_count social-proof),
// self-healed dopiero przy nastepnym startup-backfillu. Ten helper liczy bookmarki klienta pogrupowane
// po wlascicielu (stylist_account_id) i dekrementuje docelowe StylistAccount w JEDNYM round-tripie,
// atomowo w tej samej tx co user.delete (MUSI byc wolany PRZED tx.user.delete — po cascade wiersze juz
// znikna). Bookmark NIE ma predykatu is_hidden (relacja do stylistki, nie do rekordu) -> liczymy
// WSZYSTKIE wiersze klienta. Dual-role (klient jest tez stylistka): jej wlasne konto bywa
// cascade-deleted w tej samej tx; update trafia je PRZED delete (kolejnosc) lub no-op (0 rows) jesli
// juz nie istnieje — floor + WHERE chronia. Zwraca liczbe zmienionych StylistAccount.
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
