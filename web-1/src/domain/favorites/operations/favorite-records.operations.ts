import { DB_CLIENT } from '@app/db/db.client';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import type { IDType } from '@kernel/application/application.types';
import type { FavoriteGalleryRecord } from '@kernel/models/db_models.generated.dto';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type {
  RecordAlreadyInFavoritesError,
  RecordNotInFavoritesError,
  RecordToAddNotFoundError,
} from '@kernel/domain/favorites/favorite-errors.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isDeadlock, isP2002, isP2003, isP2025 } from '@app/db/prisma-error';
import { withWriteTx } from '@app/db/with-write-tx';
import { lockStylistAccount } from '@app/db/lock-rows';
import {
  GALLERY_COLORS_TRAITS_SELECT,
  mapGalleryColors,
  mapGalleryTraits,
} from '@domain/gallery/gallery.utils.api';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';
import {
  incrementLikeCount,
  decrementLikeCountFloored,
} from './favorite-count.helper';

export const addRecordToFavorites_IO = async ({
  gallery_record_id,
  id,
  note,
}: {
  gallery_record_id: IDType;
  id: IDType;
  note?: string | null;
}): Promise<
  OperationResult<
    FavoriteGalleryRecord,
    RecordToAddNotFoundError | RecordAlreadyInFavoritesError | DatabaseError
  >
> => {
  // Access guard (SSOT §5.1): a client may only like a record that is either pinned on a
  // public profile (discovery channel) OR belongs to a stylist they are actively paired with
  // (Session Share). Without this, any record could be liked by id, leaking asset_url of an
  // unpaired stylist's private gallery. Mask inaccessible records as NOT_FOUND.
  //
  // DD-M3: the guard reads run INSIDE the same $transaction as the create so they share one
  // snapshot — without this, a concurrent pairing-revoke between the pair-check and the insert
  // could flip the pair to REVOKED yet the like for a non-pinned private record would still
  // persist (TOCTOU). Pattern: addSupportMessage_IO — guards return a discriminated result
  // ({ok:false}), only a throw rolls back; the callback return value always commits.
  let favorite: FavoriteGalleryRecord;
  try {
    const txResult = await DB_CLIENT.use.$transaction(async tx => {
      const accessRecord = await tx.galleryRecord.findUnique({
        where: { gallery_record_id },
        select: {
          is_pinned: true,
          is_hidden: true,
          created_by_account_id: true,
          // created_by_account.created_by_user_id resolves record OWNERSHIP at the
          // User level (StylistAccount.created_by_user_id @unique → User.id). Needed
          // for the dual-role self-favorite guard below; NEVER returned to the client.
          created_by_account: {
            select: { created_by_user_id: true },
          },
        },
      });

      if (!accessRecord) {
        return { ok: false as const };
      }

      // DECISION (nie usuwaj tego komentarza):
      // Rekord ukryty przez moderacje (HIDE) lub cala galeria zbanowanego stylisty
      // (BAN ustawia is_hidden=true, NIE odpina is_pinned) NIE moze byc polubiony —
      // parytet z gallery-detail.query.ts (getGalleryRecordByID_IO maskuje is_hidden
      // jako NOT_FOUND dla obcych). Bez tego: (1) existence oracle — add-record
      // zwraca 201 dla pinned-but-hidden vs 404 dla nieistniejacego, ujawniajac ze
      // moderacyjnie-ukryta tresc wciaz istnieje; (2) ghost favorite — wiersz jest
      // niewidoczny w listach (record:{is_hidden:false}) ale odzylby po un-hide.
      // Sprawdzenie PRZED obiema galeziami dostepu (pinned ORAZ active-pair), bo
      // ukrycie ubija dostep niezaleznie od kanalu.
      //
      // DECISION (nie usuwaj tego komentarza):
      // SELF-FAVORITE GUARD (dual-role). Wczesniejsza teza „klient nigdy nie jest
      // wlascicielem rekordu (endpoint=requireClientAccount), wiec brak wyjatku isOwner"
      // jest FALSZYWA dla usera DUAL-ROLE: jeden User.id ma rownoczesnie client_account
      // (przepuszcza requireClientAccount) ORAZ stylist_account (created_by_user_id ===
      // User.id), ktory posiada rekordy galerii. Galaz active-pair sama z siebie odrzuca
      // self-favorite (self-pairing nie istnieje), ale galaz PINNED (discovery) jest
      // osiagalna: user przypina WLASNY rekord na WLASNYM publicznym profilu, po czym go
      // lajkuje → inflacja WLASNEGO cached_likes_count na publicznym profilu (sztuczny
      // social-proof). Resolwujemy ownership tak samo jak gallery-detail.query.ts
      // (created_by_account.created_by_user_id === id) i odrzucamy PRZED obiema galeziami
      // (parytet z is_hidden — ownership ubija add niezaleznie od kanalu). Maska NOT_FOUND
      // (RECORD_TO_ADD_NOT_FOUND, jak pozostale odrzucenia w tym pliku) — anti-enumeration,
      // a wlasciciel i tak widzi swoj rekord przez gallery owner-bypass, wiec 404 z
      // endpointu FAVORITE nie jest leakiem. cached_likes_count NIE inkrementuje (return
      // przed create+increment). Ownership-resolwer = ten sam wzorzec co
      // gallery-detail.query.ts isOwner (sibling bookmarkStylist_IO ma analogiczny
      // self-guard na cached_bookmark_count).
      //
      // DECISION (nie usuwaj tego komentarza) — favorite-1b (forward-only, intentional):
      // The self-favorite branch (created_by_user_id === id) is FORWARD-ONLY — it blocks NEW
      // self-favorite inserts; it does NOT scan, filter, or clean PRE-EXISTING self-rows. That
      // is correct and complete pre-launch and needs NO backfill migration and NO GET-level
      // self-filter, because PRODUCTION launches on a FRESH DB (2026-07-15) with ZERO existing
      // FavoriteGalleryRecord rows, and once this guard is live NO new self-row can form (insert
      // rejected before create+increment, so cached_likes_count is never inflated by a self-
      // favorite). A GET-level self-filter would add read-path complexity for a state that
      // cannot occur post-guard; a backfill would migrate a table that is empty at launch. No
      // self-favorite rows were even present in dev/QA (the bookmark-1 sweep produced 0), so
      // existing-row cleanup is unnecessary. Do NOT re-raise "no GET self-filter / no cleanup":
      // it is a deliberate pre-launch (fresh-DB) judgment, not a gap.
      if (
        accessRecord.is_hidden ||
        accessRecord.created_by_account.created_by_user_id === id
      ) {
        return { ok: false as const };
      }

      // DECISION (nie usuwaj tego komentarza):
      // Galaz PINNED (kanal discovery) wymaga, by wlasciciel rekordu byl PUBLICZNIE
      // WIDOCZNY — account_status===ACTIVE ORAZ created_by_user.is_active===true
      // (SSOT: STYLIST_PUBLICLY_VISIBLE). is_hidden NIE wystarcza: self-disable
      // (USER_DISABLE_SELF / soft-delete, DOMAIN_SSOT §13.1) i admin-disable/ban przez
      // account_status NIE odpinaja rekordu (is_pinned zostaje true, is_hidden=false),
      // wiec bez tego pinned-rekord niewidocznego stylisty dalej dawal sie polubic →
      // (1) ghost favorite (wiersz niewidoczny w GET — getFavoriteRecords_IO filtruje
      // record.created_by_account: STYLIST_PUBLICLY_VISIBLE — odzylby po re-enable);
      // (2) existence oracle (201 dla pinned-niewidocznego vs 404 dla nieistniejacego).
      // Parytet z bookmarkStylist_IO (NOT_FOUND dla tego samego przypadku) + z read-filtrem
      // tego pliku. findFirst (nie findUnique) bo STYLIST_PUBLICLY_VISIBLE laczy unique
      // account_id z non-unique account_status + relacja created_by_user.is_active. Check
      // W tej samej tx co create (DD-M3) — TOCTOU-safe: concurrent disable/ban miedzy
      // sprawdzeniem a insertem nie przemyca wiersza. Tylko galaz pinned: active-pair
      // (Session Share) to osobny kanal dostepu i pozostaje bez zmian.
      if (accessRecord.is_pinned) {
        const visibleStylist = await tx.stylistAccount.findFirst({
          where: {
            account_id: accessRecord.created_by_account_id,
            ...STYLIST_PUBLICLY_VISIBLE,
          },
          select: { account_id: true },
        });

        if (!visibleStylist) {
          return { ok: false as const };
        }
      } else {
        const activePair = await tx.clientStylistPair.findUnique({
          where: {
            client_user_id_stylist_account_id: {
              client_user_id: id,
              stylist_account_id: accessRecord.created_by_account_id,
            },
          },
          select: { status: true },
        });

        if (!activePair || activePair.status !== PairingStatusValue.ACTIVE) {
          return { ok: false as const };
        }
      }

      // DOMAIN_SSOT §5.7 (2026-02-17): Like does NOT auto-bookmark.
      // Smart Bookmark Suggestion (frontend dialog) after 3 likes from same stylist.
      // Trim mirror updateRecordNote_IO (whitespace-only → null) — symetria add/update.
      const trimmedNote = note != null ? note.trim() || null : null;

      // DECISION (nie usuwaj tego komentarza) — SA-FIRST COUNTER LOCK (finding testy-api fav-drift-1):
      // pesymistyczny lock StylistAccount (kanoniczny lockStylistAccount, SA-first w globalnym lock-order)
      // brany PRZED create+increment serializuje TEN add z rownoleglym favorite-remove/moderation na tym
      // koncie. Bez tego delta-licznik cached_likes_count DRYFOWAL pod concurrent add/remove toggle na tym
      // samym (client,record): mimo atomowego +1/-1 SQL para (row-op + counter-op) obu tx NIE byla
      // serializowana jako calosc, zostawiajac cached_likes_count o 1 nizej niz liczba wierszy (undercount,
      // zreprodukowane izolowanie: rows=1, count=0). Lock domyka toggle (kazdy add/remove atomowy per-konto)
      // i zastepuje falszywa teze „toggle-race ZAMKNIETY round-4 s14" (delete-based atomicity domykala
      // tylko double-decrement dwoch concurrent remove, NIE add-vs-remove interleave). Parytet z gallery-pin
      // / gallery-create (ten sam SA-lock serializuje ich per-konto quota-writery).
      await lockStylistAccount(tx, accessRecord.created_by_account_id);

      const fav = await tx.favoriteGalleryRecord.create({
        data: {
          client_user_id: id,
          gallery_record_id,
          note: trimmedNote,
        },
      });

      // Single SoT writer: favorite-count.helper.ts owns the whole cached_likes_count
      // write-path (favorites owns this counter; parytet z gallery-create incrementGalleryCount).
      // +1 unconditional — the access guards above already rejected is_hidden records (the only
      // case excluded from the counter's SoT predicate), so a record reaching create is always
      // visible. Inside the same tx → commits/rolls back atomically with the like insert.
      await incrementLikeCount(tx, accessRecord.created_by_account_id, 1);

      return { ok: true as const, fav };
    });

    if (!txResult.ok) {
      return failure({
        type: 'RECORD_TO_ADD_NOT_FOUND',
        recordId: gallery_record_id,
      });
    }

    favorite = txResult.fav;
  } catch (error: unknown) {
    if (isP2002(error)) {
      return failure({
        type: 'RECORD_ALREADY_IN_FAVORITES',
        recordId: gallery_record_id,
        userId: id,
      });
    }
    if (isP2003(error)) {
      return failure({
        type: 'RECORD_TO_ADD_NOT_FOUND',
        recordId: gallery_record_id,
      });
    }
    return databaseFailure('addRecordToFavorites_IO', error);
  }

  return success(favorite);
};

export const removeRecordFromFavorites_IO = async ({
  gallery_record_id,
  id,
}: {
  gallery_record_id: IDType;
  id: IDType;
}): Promise<OperationResult<boolean, DatabaseError>> => {
  // DECISION (nie usuwaj tego komentarza) — SA-FIRST COUNTER LOCK (finding testy-api fav-drift-1):
  // cached_likes_count = denormalized counter (parytet cached_gallery_count); decrement MUST be atomic
  // Z usunieciem wiersza ORAZ serializowany z rownoleglym add/remove/moderation na tym koncie. Bierzemy
  // pesymistyczny lock StylistAccount (kanoniczny lockStylistAccount, SA-first w globalnym lock-order
  // User->StylistAccount->SessionContainer->SupportThread) JAKO PIERWSZY krok liczacy — PRZED odczytem
  // is_hidden i deleteMany. Powod: delta-licznik DRYFOWAL pod concurrent add/remove toggle na tym samym
  // (client,record) — mimo atomowego +1/-1 SQL para (row-op + counter-op) obu tx NIE byla serializowana
  // jako calosc, zostawiajac cached_likes_count o 1 nizej niz liczba wierszy (undercount; zreprodukowane
  // IZOLOWANIE, zero rownoleglych aktorow: rows=1, count=0 w ~1/3 rund). Poprzednia teza „toggle-race
  // ZAMKNIETY round-4 s14" byla FALSZYWA. Precyzyjny mechanizm (zweryfikowany adwersarsko): pojedyncze
  // UPDATE +1/-1 SA SA exact pod row-lockiem (READ COMMITTED re-read) — drift bral sie z DECREMENTU NIE
  // zgated na FAKTYCZNY delete (real tx.delete-with-relation dryfowal ~1/3 rund w izolacji). Fix domyka
  // to dwutorowo: (1) decrement gated na deleted.count===1 (nie na stale-read), (2) SA-lock serializuje
  // wszystkich pisarzy licznika per-konto deterministycznie, niezaleznie od dekompozycji zapytan Prisma. SoT predykat: lajki WIDOCZNYCH rekordow (is_hidden=false) — juz-ukryty rekord
  // byl poza licznikiem, wiec un-like go NIE dekrementuje; is_hidden czytany POD lockiem (moderation HIDE
  // jest tez SA-first -> pelna serializacja, zero double-count z HIDE-decrement). deleted.count===1 gate
  // = decrement tylko gdy FAKTYCZNIE usunieto wiersz (0 = juz-usuniety -> idempotentny no-op). Floor
  // GREATEST(0,...) = ostatnia obrona.
  // DEADLOCK: SA-first ALIGNUJE remove z kanoniczna kolejnoscia lockow — wczesniej remove bral Favorite
  // (tx.delete) -> StylistAccount (decrement) = odwrotnie niz moderation-DELETE (StylistAccount-first),
  // czyli ABBA 40P01 papierowany retry'em. Teraz oba lockuja StylistAccount PRZED Favorite/GalleryRecord
  // -> ABBA zniknal U ZRODLA. withWriteTx z retryOn:isDeadlock ZOSTAJE belt-and-suspenders dla ukrytych
  // lockow FK-cascade (gallery-delete), zgodnie z DECISION w lock-rows.ts. Rekord w calosci zniknl
  // (cascade) -> owner-read null -> idempotentny no-op (tamta sciezka juz zdekrementowala).
  try {
    const removed = await withWriteTx(
      async tx => {
        // Resolve the record owner FIRST (immutable) so we can take the SA-first counter lock before
        // touching the favorite row. Record fully gone (gallery-delete / moderation-DELETE cascade
        // already removed the favorite + decremented) -> idempotent no-op.
        const rec = await tx.galleryRecord.findUnique({
          where: { gallery_record_id },
          select: { created_by_account_id: true },
        });
        if (!rec) {
          return false;
        }

        // SA-FIRST lock: serializes this remove with concurrent favorite-add / other remove /
        // moderation on this account, so the (delete + decrement) pair is atomic per account and the
        // denormalized cached_likes_count cannot drift under add/remove toggle (finding fav-drift-1).
        await lockStylistAccount(tx, rec.created_by_account_id);

        // is_hidden read UNDER the lock: moderation HIDE (also SA-first) is fully serialized here, so
        // the visibility predicate is committed-consistent and never double-counts a HIDE decrement.
        const recVisible = await tx.galleryRecord.findUnique({
          where: { gallery_record_id },
          select: { is_hidden: true },
        });

        const deleted = await tx.favoriteGalleryRecord.deleteMany({
          where: { client_user_id: id, gallery_record_id },
        });

        // Decrement only when a VISIBLE row was actually deleted (hidden = outside the SoT predicate;
        // count===0 = row already gone -> idempotent). Gated on deleted.count, not a stale read.
        if (deleted.count === 1 && recVisible?.is_hidden === false) {
          await decrementLikeCountFloored(tx, rec.created_by_account_id, 1);
        }

        return deleted.count === 1;
      },
      { retryOn: isDeadlock }
    );

    return success(removed);
  } catch (error: unknown) {
    // Defensive: deleteMany reports 0 rows as count:0 (NOT a P2025 throw), so the no-row case is now
    // handled inside the tx (return false). This P2025 branch stays as belt-and-suspenders for any other
    // structural miss → idempotent success(false), no decrement (parytet unbookmarkStylist_IO).
    // Structural hasCode is Turbopack-safe (NOT instanceof); withWriteTx rethrows P2025 (NIE-retryable).
    if (isP2025(error)) {
      return success(false);
    }
    return databaseFailure('removeRecordFromFavorites_IO', error);
  }
};

export const getFavoriteRecords_IO = async ({
  id,
  cursor,
  take = 50,
}: {
  id: IDType;
  cursor?: string;
  take?: number;
}): Promise<
  OperationResult<
    FAVORITE_DTO_API_V1['FAVORITE_GET_RECORDS']['RESPONSE'],
    DatabaseError | ValidationError
  >
> => {
  // DD-L3: lower clamp (>= 1) prevents effectiveTake=0 → on hasMore, pageItems is empty and
  // pageItems[length-1].id crashes. Parity with getBookmarkedStylists_IO / getSupportThreads_IO.
  const effectiveTake = Math.min(Math.max(take, 1), 100);

  // DECISION (nie usuwaj tego komentarza):
  // Format-gate cursora PRZED findMany (wzorzec SSOT z gallery-explore.query.ts —
  // isValidCursorFormat @kernel validation.utils). Bez tego null-byte (\0) lub inny
  // niezgodny z PG `text` cursor rzucałby w findMany → niezmapowany 500 GENERAL_ERROR.
  // Malformowany/non-cuid cursor = jednolity kontrakt VALIDATION_ERROR 400 'Invalid cursor'.
  // To zamyka też cuid existence-oracle defense-in-depth (helper DECISION). Existence
  // pre-check pominięty: getFavoriteRecords_IO nie robi tu osobnego ownership lookupu do
  // reużycia, a FE odtwarza wyłącznie server-issued cursory (200-empty na valid-format
  // stale cursor akceptowalne).
  if (cursor !== undefined && !isValidCursorFormat(cursor)) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'cursor',
      message: 'Invalid cursor',
    });
  }

  let favorites;
  try {
    favorites = await DB_CLIENT.use.favoriteGalleryRecord.findMany({
      where: {
        client_user_id: id,
        record: {
          is_hidden: false, // Exclude favorites pointing to hidden records
          // Visibility-cascade parity: a removed stylist (disable/ban/soft-delete) must not leak
          // PII (display_name, asset_url) in the client's liked-records list. is_hidden alone is
          // insufficient (those paths don't set it) — gate on the shared visibility invariant. An
          // owner-like on a removed stylist drops off the list until re-enable (filter reversible;
          // the row stays in DB). SSOT: STYLIST_PUBLICLY_VISIBLE.
          created_by_account: STYLIST_PUBLICLY_VISIBLE,
        },
      },
      // DD3-F2: scoped select for colors/traits drops unused GalleryRecord{Color,Trait} junction
      // columns (gallery_record_id duplicate, ids) and only fetches needed Color/Trait fields.
      // SSOT: GALLERY_COLORS_TRAITS_SELECT (@domain/gallery/gallery.utils.api) — 6. konsument
      // tego kształtu obok explore/list/detail/public/update (patrz DECISION w gallery.utils.api).
      select: {
        id: true,
        gallery_record_id: true,
        note: true,
        record: {
          select: {
            asset_url: true,
            created_by_account_id: true,
            ...GALLERY_COLORS_TRAITS_SELECT,
            created_by_account: {
              select: {
                display_name: true,
              },
            },
          },
        },
      },
      // Cursor field (id) must be part of orderBy for stable pagination — created_at is
      // non-unique, so id is the tiebreaker preventing skip/dup on page boundaries.
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      // DD2-M6 r28: fetch effectiveTake + 1 to detect hasMore unambiguously.
      // Previous: take: effectiveTake + length === effectiveTake → false-positive
      // nextCursor gdy total == exact multiple (user fetches empty next page).
      take: effectiveTake + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
  } catch (error) {
    return databaseFailure('getFavoriteRecords_IO', error);
  }

  const hasMore = favorites.length > effectiveTake;
  const pageItems = hasMore ? favorites.slice(0, effectiveTake) : favorites;
  const nextCursor = hasMore
    ? (pageItems[pageItems.length - 1]?.id ?? null)
    : null;

  return success({
    records: pageItems.map(fav => ({
      id: fav.id,
      gallery_record_id: fav.gallery_record_id,
      note: fav.note ?? null,
      asset_url: fav.record.asset_url,
      colors: mapGalleryColors(fav.record.colors),
      traits: mapGalleryTraits(fav.record.traits),
      stylist_account_id: fav.record.created_by_account_id,
      stylist_display_name: fav.record.created_by_account.display_name || null,
    })),
    nextCursor,
  });
};

export const updateRecordNote_IO = async ({
  gallery_record_id,
  id,
  note,
}: {
  gallery_record_id: IDType;
  id: IDType;
  note: string | null;
}): Promise<
  OperationResult<
    { gallery_record_id: IDType; note: string | null },
    RecordNotInFavoritesError | DatabaseError
  >
> => {
  // Update the note (trim if string, or set null)
  const trimmedNote = note !== null ? note.trim() || null : null;

  // Single atomic write: updateMany filters by the composite key and returns
  // count=0 when the favorite doesn't exist (or was concurrently removed by
  // removeRecordFromFavorites_IO / a moderation-owner DELETE cascade). This
  // collapses the previous findUnique(over-fetch of the whole row)+update pair
  // into ONE round-trip and removes the TOCTOU window between them: count=0 →
  // RECORD_NOT_IN_FAVORITES, identical outcome to BOTH the old find-miss branch
  // AND the old update-stage P2025 race branch (updateMany no-matches returns
  // {count:0} instead of throwing P2025, so the explicit detector is no longer
  // needed here). The note is fully client-supplied, so no read-back is required.
  let updated;
  try {
    updated = await DB_CLIENT.use.favoriteGalleryRecord.updateMany({
      where: { client_user_id: id, gallery_record_id },
      data: { note: trimmedNote },
    });
  } catch (error) {
    return databaseFailure('updateRecordNote_IO:updateMany', error);
  }

  if (updated.count === 0) {
    return failure({
      type: 'RECORD_NOT_IN_FAVORITES',
      recordId: gallery_record_id,
      userId: id,
    });
  }

  return success({ gallery_record_id, note: trimmedNote });
};
