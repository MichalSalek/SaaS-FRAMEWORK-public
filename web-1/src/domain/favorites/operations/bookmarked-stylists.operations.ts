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

  // DECISION: the cursor format is gated BEFORE findMany, as in
  // web-1/src/domain/gallery/operations/gallery-explore.query.ts. No existence pre-check: the FE
  // only replays server-issued cursors, so 200-empty on a stale valid cursor is fine.
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
          // A removed stylist (account_status !== ACTIVE after admin disable/ban, or
          // created_by_user.is_active=false after self-disable/soft-delete; DOMAIN_SSOT 13.1 keeps the row)
          // must not appear in bookmarks: the list exposes business_name, city and gallery_count. The client
          // loses the un-bookmark affordance for a vanished stylist; PII protection wins and the filter is
          // reversible on re-enable. SSOT: STYLIST_PUBLICLY_VISIBLE.
          //
          // DECISION: this JOIN predicate relies on @@index([account_status, account_id]) on StylistAccount
          // for the nested-loop join, so do not drop that index; the outer
          // @@index([client_user_id, created_at]) does not cover the join filter under orderBy id desc.
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
      // Professional alias before the registration name, same chain as
      // getStylistsWithLocation_IO and the public profile. User.name alone showed
      // the legal name of a stylist who trades under the studio name, and a
      // magic-link account (User.name '') rendered a row with no name.
      // Blank after the chain (role-only onboarding leaves display_name null,
      // a magic-link User.name is '') becomes null, so the consumer shows its own
      // fallback instead of an empty row title.
      display_name:
        fav.stylist.display_name?.trim() ||
        fav.stylist.created_by_user.name?.trim() ||
        null,
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
    // DECISION: visibility guard, create and increment share ONE interactive $transaction, so
    // cached_bookmark_count and the FavoriteStylist row count commit or roll back together (P2003 or P2002
    // throws before the increment runs). The guard runs BEFORE create (mirror of addRecordToFavorites_IO):
    // with only the FK check a banned or soft-deleted stylist could be bookmarked by id, leaving a ghost
    // row that inflates the counter and an existence oracle (201 vs 404). It sits inside the tx so a
    // concurrent disable/ban cannot slip a row in. findFirst, not findUnique, because
    // STYLIST_PUBLICLY_VISIBLE combines the unique account_id with non-unique account_status and
    // created_by_user.is_active. Not-visible collapses to STYLIST_NOT_FOUND (same anti-enumeration as P2003).
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

      // DECISION: self-bookmark is rejected. A dual-role user passes requireClientAccount but owns a
      // StylistAccount; `id` and created_by_user_id are both user ids, so equality is the exact owner check,
      // and without it the public cached_bookmark_count could be self-inflated. The gate sits inside the
      // tx after the visibility findFirst (TOCTOU-safe, reuses the row already read) and returns a plain
      // VALIDATION_ERROR 400 rather than the 404 collapse: the caller acts on their own account id, so
      // there is no enumeration vector (same precedent as SALON_STAFF_SELF_INVITE). The increment is skipped.
      //
      // DECISION: the guard is forward-only. It blocks new self-rows and neither scans nor cleans old ones,
      // and there is no GET-level self-filter: production launched on a fresh DB (2026-07-15) with zero
      // FavoriteStylist rows, and once the guard is live no self-row can form.
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
    // DECISION: interactive $transaction with deleteIfExists (P2025 -> null) plus a floored decrement via
    // the single-owner write path (bookmark-count.helper). An already-removed bookmark returns null, so
    // there is NO decrement and the call is an idempotent success(false); a real delete decrements in the
    // SAME tx. P2025 is handled inside deleteIfExists, so there is no outer hasCode catch.
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
