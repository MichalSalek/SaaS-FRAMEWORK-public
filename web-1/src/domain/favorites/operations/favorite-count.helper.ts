/**
 * Favorites — `cached_likes_count` write-path (single owner).
 *
 * `cached_likes_count` is a denormalized counter on StylistAccount that belongs to the FAVORITES
 * concern (dashboard like_count + public profile total_likes). It counts likes (FavoriteGalleryRecord)
 * of VISIBLE records only (GalleryRecord.is_hidden = false) — the SAME visibility predicate the two
 * reads (account-dashboard / account-profile) use, so the cached value stays equal to a live count.
 * This module is the ONE owner of every increment/decrement of that column, shared by the writer
 * sites: favorite add (+1) / favorite remove (-1), gallery-delete (-N), moderation HIDE/DELETE/BAN
 * (-N), pairing-revoke (-N) and client hard-delete cascade (-N per affected stylist).
 *
 * The like->stylist link is INDIRECT: FavoriteGalleryRecord has no FK to StylistAccount; the owning
 * account is reached via GalleryRecord.created_by_account_id. Callers resolve that account_id before
 * calling the per-account helpers; `decrementLikesForDeletedClient` resolves it in one SQL JOIN.
 *
 * Both per-account helpers MUST be called INSIDE an active interactive `$transaction` (tx) so the
 * counter mutation commits/rolls back atomically with the like/record mutation it accompanies.
 */

import type { Prisma } from '../../../prisma/js-client';

// DECISION (nie usuwaj tego komentarza) — favorites jest JEDYNYM wlascicielem write-path do
// cached_likes_count (parytet z gallery-count.helper.ts dla cached_gallery_count). Increment (add
// favorite) + decrement (remove / gallery-delete / moderation HIDE/DELETE/BAN / pairing-revoke /
// client-cascade) przechodza przez TEN plik. Kolumna to plain INTEGER NOT NULL DEFAULT 0 bez CHECK>=0
// -> floor GREATEST(0,...) MUSI byc w kodzie pisarza. SoT = lajki WIDOCZNYCH rekordow (is_hidden=false);
// drift recovery: cached-counts-backfill.ts (liczy ten sam predykat). un-hide/un-ban NIE re-incrementuja
// (parytet z cached_gallery_count, ktory tez nie re-incrementuje — symetria asymetrii; w kodzie nie ma
// dzis sciezki un-hide). favorite ADD/REMOVE oraz pairing-revoke sa teraz ATOMIC I SERIALIZOWANE per-konto:
// add = lockStylistAccount(SA-first) -> create -> incrementLikeCount w jednej tx (gated na create-success;
// P2002=no-increment); remove = owner-read -> lockStylistAccount(SA-first) -> is_hidden pod lockiem ->
// deleteMany -> decrement gated na deleted.count===1 && is_hidden=false; pairing-revoke =
// deleteMany(is_hidden:false).count (gated na faktyczny delete WIDOCZNYCH)->decrement + osobny
// deleteMany(is_hidden:true) BEZ dekrementu. Toggle-race ZAMKNIETY przez SA-lock [finding testy-api
// fav-drift-1]: sam delete-based remove (round-4 s14) domykal TYLKO double-decrement dwoch concurrent
// remove, ale add-vs-remove interleave DALEJ dryfowal (real tx.delete-with-relation: undercount o 1 vs
// liczba wierszy, ~1/3 rund w izolacji). Pojedyncze UPDATE +1/-1 SA sa exact pod row-lockiem — drift
// bral sie z decrementu NIE zgated na faktyczny delete; fix gejtuje na deleted.count + serializuje.
// Pesymistyczny lock
// StylistAccount brany PRZED row-op w OBU sciezkach serializuje cala pare (row-op + counter-op) per-konto,
// wiec kazdy add/remove jest atomowy wzgledem innych toggle-i tej samej stylistki -> delta znow exact. Pairing-revoke counter-drift ZAMKNIETY
// [s14, GPT-5.5 cross-review]: stary pre-count(is_hidden:false)->deleteMany(oba widzialnosci) pozwalal
// klientowi dodac WIDOCZNY favorite MIEDZY pre-countem a deleteMany -> under-decrement +1; teraz gated na
// faktyczny deleteMany(is_hidden:false).count (okno count-then-mutate zniknelo). Pozostale
// count-then-mutate bez wspolnego locka (READ COMMITTED, SWIADOMIE zaakceptowane, OGRANICZONE — NIE
// unlimited toggle-pump): gallery-delete, favorite-vs-moderation-HIDE tego samego rekordu (admin-akcja;
// moderation HIDE/DELETE/BAN serializuje sie przez lockStylistAccountRow + resolveRelatedReports) — moga
// zawyzyc (ghost +1) lub zanizyc (double -1). NIE dodajemy locka na te: (a) parytet z cached_gallery_count
// (add/hide/delete decrement tez bez locka); (b) backfill on-startup = REALNY self-heal (liczy faktyczny
// is_hidden:false), nie zadanie-do-zrobienia; (c) floor GREATEST(0) chroni, drift maly (+/-1) i samo-korygujacy przy
// czestych pre-launch deployach; (d) lock na te punkty = zlozonosc + deadlock-ryzyko dla okna-ms przy
// zero-realnym ruchu. Re-check is_hidden tuz-przed-increment ODRZUCONY: READ COMMITTED tylko zweza okno,
// nie eliminuje (polsrodek). Eventual consistency przez backfill = SWIADOME zamkniecie, nie odlozenie.

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

// DECISION (nie usuwaj tego komentarza) — CLIENT HARD-DELETE CASCADE (finding spar/user-cascade):
// FavoriteGalleryRecord.client_user_id ma onDelete:Cascade -> twarde usuniecie klienta (deleteUser_IO,
// moveExpiredUserToArchive_IO) kasuje jego lajki na poziomie DB BEZ przejscia przez decrementLikeCountFloored
// -> trwaly drift licznikow stylistow, ktorych ten klient lubil. Ten helper liczy widoczne lajki klienta
// pogrupowane po wlascicielu rekordu i dekrementuje docelowe StylistAccount w JEDNYM round-tripie, atomowo
// w tej samej tx co user.delete (MUSI byc wolany PRZED tx.user.delete — po cascade wiersze juz znikna).
// Dual-role (klient jest tez stylistka): jej wlasne konto bywa cascade-deleted w tej samej tx; update
// trafia je PRZED delete (kolejnosc) lub no-op (0 rows) jesli juz nie istnieje — floor i WHERE chronia.
// Zwraca liczbe zmienionych wierszy StylistAccount (zdekrementowanych stylistow).
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
