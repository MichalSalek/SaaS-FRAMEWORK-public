import { DB_CLIENT } from '@app/db/db.client';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import type { IDType } from '@kernel/application/application.types';
import type { FavoriteStylist } from '@kernel/models/db_models.generated.dto';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type { BookmarkAlreadyExistsError } from '@kernel/domain/favorites/favorite-errors.types';
import type {
  StylistNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import { countPublicGalleryRecordsByAccount } from '@domain/gallery/public-gallery-count';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  incrementBookmarkCount,
  decrementBookmarkCountFloored,
} from './bookmark-count.helper';
import { deleteIfExists } from '@app/db/cas';
import { isP2002, isP2003 } from '@app/db/prisma-error';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';
import type { ValidationError } from '@kernel/application/common-errors.types';

export const getBookmarkedStylists_IO = async ({
  id,
  cursor,
  take = 50,
}: {
  id: IDType;
  cursor?: string;
  take?: number;
}): Promise<
  OperationResult<
    FAVORITE_DTO_API_V1['GET_BOOKMARKED_STYLISTS']['RESPONSE'],
    DatabaseError | ValidationError
  >
> => {
  const effectiveTake = Math.min(Math.max(take, 1), 100);

  // DECISION (nie usuwaj tego komentarza):
  // Format-gate cursora PRZED findMany (wzorzec SSOT z gallery-explore.query.ts —
  // isValidCursorFormat @kernel validation.utils). Bez tego null-byte (\0) lub inny
  // niezgodny z PG `text` cursor rzucałby w findMany → niezmapowany 500 GENERAL_ERROR.
  // Malformowany/non-cuid cursor = jednolity kontrakt VALIDATION_ERROR 400 'Invalid cursor'
  // (zamyka też cuid existence-oracle defense-in-depth — helper DECISION). Existence
  // pre-check pominięty: brak osobnego ownership lookupu do reużycia, a FE odtwarza tylko
  // server-issued cursory (200-empty na valid-format stale cursor akceptowalne).
  if (cursor !== undefined && !isValidCursorFormat(cursor)) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'cursor',
      message: 'Invalid cursor',
    });
  }

  // Fetch bookmarked stylists with pairing info for unified list (DOMAIN_SSOT 5.1).
  // Pairs lookup uses bigger ceiling because pairings are independent of pagination window.
  let bookmarks;
  let pairs;
  try {
    [bookmarks, pairs] = await Promise.all([
      DB_CLIENT.use.favoriteStylist.findMany({
        where: {
          client_user_id: id,
          // Visibility-cascade parity: a removed stylist (account_status !== ACTIVE after admin
          // disable/ban, OR created_by_user.is_active=false after self-disable/soft-delete —
          // DOMAIN_SSOT 13.1 keeps the FavoriteStylist row) must not appear in the client's
          // bookmarks. Without this filter GET get-bookmarked leaked PII (business_name +
          // address_city + display_name + gallery_count). The client loses the un-bookmark
          // affordance for a vanished stylist — acceptable (PII protection > affordance; the
          // row stays in DB, filter reversible on re-enable). SSOT: STYLIST_PUBLICLY_VISIBLE.
          //
          // DECISION (nie usuwaj tego komentarza):
          // This JOIN visibility predicate (stylist.account_status + created_by_user.is_active)
          // relies on @@index([account_status, account_id]) on StylistAccount for the nested-loop
          // join — DO NOT drop that index. The outer @@index([client_user_id, created_at]) does
          // not cover the JOIN filter under orderBy {id desc}. Long-term option: a denormalized
          // `stylist_is_visible` column on FavoriteStylist updated atomically on
          // account_status/is_active toggle (removes the per-row join filter).
          stylist: STYLIST_PUBLICLY_VISIBLE,
        },
        select: {
          id: true,
          stylist_account_id: true,
          created_at: true,
          stylist: {
            select: {
              business_name: true,
              address_city: true,
              display_name: true,
              created_by_user: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: {
          id: 'desc',
        },
        take: effectiveTake + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      DB_CLIENT.use.clientStylistPair.findMany({
        where: { client_user_id: id, status: PairingStatusValue.ACTIVE },
        select: { stylist_account_id: true },
        // Cap linked to platform pairing limit (PRICING_POLICY.PLATFORM_LIMITS.MAX_PAIRED_STYLISTS).
        // No active client can exceed this — +1 buffer guards against off-by-one if cap raised.
        take: PRICING_POLICY.PLATFORM_LIMITS.MAX_PAIRED_STYLISTS + 1,
      }),
    ]);
  } catch (error) {
    return databaseFailure('getBookmarkedStylists_IO', error);
  }

  const pairedAccountIds = new Set(pairs.map(p => p.stylist_account_id));

  const hasMore = bookmarks.length > effectiveTake;
  const pageItems = hasMore ? bookmarks.slice(0, effectiveTake) : bookmarks;

  // `gallery_count` = the public portfolio size, the same number the profile and
  // the public list show (DECISION in public-gallery-count.ts): non-hidden works,
  // counted fresh instead of from the cache, which includes moderation-hidden ones.
  let galleryCounts: Map<string, number>;
  try {
    galleryCounts = await countPublicGalleryRecordsByAccount(
      pageItems.map(fav => ({ account_id: fav.stylist_account_id }))
    );
  } catch (error) {
    return databaseFailure('getBookmarkedStylists_IO:galleryCounts', error);
  }
  const nextCursor =
    hasMore && pageItems.length > 0
      ? (pageItems[pageItems.length - 1]?.id ?? null)
      : null;

  return success({
    records: pageItems.map(fav => ({
      id: fav.id,
      stylist_account_id: fav.stylist_account_id,
      business_name: fav.stylist.business_name,
      address_city: fav.stylist.address_city,
      // Zawodowy alias PRZED imieniem z rejestracji — ten sam fallback co kanoniczny
      // sibling `getStylistsWithLocation_IO` (account-query.operations.ts) i profil
      // publiczny. Sam `created_by_user.name` był tu podwójnym błędem: pokazywał
      // klientce imię i nazwisko stylistki, która świadomie handluje pod nazwą studia,
      // a dla kont z magic-linka (gdzie `name` to pusty string) renderował wiersz BEZ
      // nazwy, mimo że profil publiczny nazwę ma.
      display_name:
        fav.stylist.display_name || fav.stylist.created_by_user.name,
      gallery_count: galleryCounts.get(fav.stylist_account_id) ?? 0,
      is_paired: pairedAccountIds.has(fav.stylist_account_id),
      bookmarked_at: fav.created_at.toISOString(),
    })),
    nextCursor,
  });
};

export const bookmarkStylist_IO = async ({
  stylist_account_id,
  id,
}: {
  stylist_account_id: IDType;
  id: IDType;
}): Promise<
  OperationResult<
    FavoriteStylist,
    | StylistNotFoundError
    | BookmarkAlreadyExistsError
    | ValidationError
    | DatabaseError
  >
> => {
  // Bookmark has no limit — neither client-side nor stylist-side.
  // Limit is on pairing (ClientStylistPair), not bookmarking.
  // Non-existent stylist is caught by Prisma P2003 (FK violation) below.

  let existingBookmark: FavoriteStylist;
  try {
    // DECISION (nie usuwaj tego komentarza):
    // Atomic $transaction(callback) — visibility guard + create + increment share ONE
    // snapshot. Keeps cached_bookmark_count in sync with FavoriteStylist row count: all
    // succeed or all rollback. If P2003 (stylist not found) create throws before increment
    // runs — no drift. P2002 (duplicate bookmark) likewise throws atomically. D7+DD3-D1 run 24.
    //
    // DECISION (nie usuwaj tego komentarza):
    // Visibility-gate PRZED create+increment (mirror addRecordToFavorites_IO): bez tego
    // bookmark gejtowal TYLKO FK existence (P2003), wiec zbanowany/soft-deleted stylista
    // dawalo sie zbookmarkowac po ID → (1) ghost row (filtrowany z GET przez
    // STYLIST_PUBLICLY_VISIBLE, ale UI nie ma affordance do un-bookmark) + inflacja
    // cached_bookmark_count, (2) existence oracle (201 dla niewidocznego vs 404). Guard W
    // tej samej tx co create — TOCTOU-safe (concurrent disable/ban miedzy check a insert nie
    // przemyca wiersza). findFirst (nie findUnique) bo STYLIST_PUBLICLY_VISIBLE laczy unique
    // account_id z non-unique account_status + relacja created_by_user.is_active. Collapse
    // not-visible → STYLIST_NOT_FOUND (parytet anty-enumeracji z P2003 + sibling
    // addRecordToFavorites_IO maskujacym jako NOT_FOUND).
    const txResult = await DB_CLIENT.use.$transaction(async tx => {
      const visibleStylist = await tx.stylistAccount.findFirst({
        where: {
          account_id: stylist_account_id,
          ...STYLIST_PUBLICLY_VISIBLE,
        },
        select: { account_id: true, created_by_user_id: true },
      });

      if (!visibleStylist) {
        return { ok: false as const, selfBookmark: false as const };
      }

      // DECISION (nie usuwaj tego komentarza):
      // Self-bookmark gate (bookmark-1): a dual-role user (owns a StylistAccount AND a
      // CLIENT account — the handler's requireClientAccount only proves the client side)
      // must NOT bookmark their OWN stylist account. Without this, `id` (caller's session
      // user id) == StylistAccount.created_by_user_id and the increment below inflates the
      // PUBLIC cached_bookmark_count = self-referential social-proof inflation. `id` and
      // created_by_user_id are BOTH user ids (created_by_user_id is the owner's user id,
      // schema.prisma StylistAccount), so the equality is the precise owner check.
      // Gate lives INSIDE the same tx, AFTER the visibility findFirst — TOCTOU-safe and it
      // reuses the row already read (no extra query). Distinct VALIDATION_ERROR (400, not
      // the not-found 404 collapse) because there is NO enumeration vector: the caller acts
      // on their OWN account id (obtained from their own session/profile), so an honest 400
      // leaks nothing while masking-as-404 would only confuse the UI. Mirrors the existing
      // self-referential-action precedent SALON_STAFF_SELF_INVITE (clean 400 BadRequest).
      // The increment is bypassed entirely — the public counter never moves on self-bookmark.
      //
      // DECISION (nie usuwaj tego komentarza) — bookmark-1b (forward-only, intentional):
      // This guard is FORWARD-ONLY — it blocks NEW self-bookmark inserts; it does NOT scan,
      // filter, or clean PRE-EXISTING self-rows. That is correct and complete pre-launch and
      // needs NO backfill migration and NO GET-level self-filter, because PRODUCTION launches
      // on a FRESH DB (2026-07-15) with ZERO existing FavoriteStylist rows, and once this guard
      // is live NO new self-row can form (insert rejected before create+increment, so
      // cached_bookmark_count is never inflated by a self-bookmark). A GET-level self-filter
      // would add read-path complexity for a state that cannot occur post-guard; a backfill
      // would migrate a table that is empty at launch. The only self-rows ever observed were
      // ephemeral dev/QA repro data (scrubbed in the QA session that raised this), so existing-
      // row cleanup is unnecessary. Do NOT re-raise "no GET self-filter / no cleanup": it is a
      // deliberate pre-launch (fresh-DB) judgment, not a gap.
      if (visibleStylist.created_by_user_id === id) {
        return { ok: false as const, selfBookmark: true as const };
      }

      const created = await tx.favoriteStylist.create({
        data: {
          client_user_id: id,
          stylist_account_id,
        },
      });

      // Single SoT writer: bookmark-count.helper.ts owns the cached_bookmark_count write-path
      // (parytet z favorite-count.helper [likes] + gallery-count.helper). +1 gated on create-success
      // (guards above rejected self-bookmark + not-visible), inside the same tx -> atomic with insert.
      await incrementBookmarkCount(tx, stylist_account_id, 1);

      return { ok: true as const, created };
    });

    if (!txResult.ok) {
      if (txResult.selfBookmark) {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'stylist_account_id',
          message: 'Cannot bookmark your own stylist account',
        });
      }
      return failure({
        type: 'STYLIST_NOT_FOUND',
        stylistAccountId: stylist_account_id,
      });
    }

    existingBookmark = txResult.created;
  } catch (error: unknown) {
    if (isP2002(error)) {
      return failure({
        type: 'BOOKMARK_ALREADY_EXISTS',
        stylistAccountId: stylist_account_id,
        clientUserId: id,
      });
    }
    if (isP2003(error)) {
      return failure({
        type: 'STYLIST_NOT_FOUND',
        stylistAccountId: stylist_account_id,
      });
    }
    return databaseFailure('bookmarkStylist_IO', error);
  }

  return success(existingBookmark);
};

export const unbookmarkStylist_IO = async ({
  stylist_account_id,
  id,
}: {
  stylist_account_id: IDType;
  id: IDType;
}): Promise<OperationResult<boolean, DatabaseError>> => {
  let removed: boolean;
  try {
    // DECISION (nie usuwaj tego komentarza):
    // Atomic interactive $transaction — deleteIfExists (P2025->null, idempotent) + floored decrement
    // keep cached_bookmark_count in sync via the single-owner write-path (bookmark-count.helper). If
    // the bookmark is already gone, deleteIfExists returns null -> NO decrement, idempotent
    // success(false); a real delete -> decrement in the SAME tx (atomic, no drift). Floor
    // GREATEST(0,...) + DB CHECK(>=0) = backstop. P2025 handled INSIDE via deleteIfExists (no outer
    // hasCode-catch). D7+DD3-D1 run 24.
    removed = await DB_CLIENT.use.$transaction(async tx => {
      const deleted = await deleteIfExists(() =>
        tx.favoriteStylist.delete({
          where: {
            client_user_id_stylist_account_id: {
              client_user_id: id,
              stylist_account_id,
            },
          },
        })
      );
      if (deleted === null) {
        return false;
      }
      await decrementBookmarkCountFloored(tx, stylist_account_id, 1);
      return true;
    });
  } catch (error: unknown) {
    return databaseFailure('unbookmarkStylist_IO', error);
  }

  // Unbookmark ONLY removes the bookmark record — no cascades.
  // Pairing (ClientStylistPair) and liked records (FavoriteGalleryRecord) are independent.

  return success(removed);
};
