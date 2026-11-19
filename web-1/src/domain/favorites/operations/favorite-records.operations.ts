import { resolveSalonAccess_IO } from '@domain/pairing/salon-access.resolver';
import {
  favoriteReadableRecordWhere,
  resolveFavoriteReadScope_IO,
} from './favorite-access';
import { DB_CLIENT } from '@app/db/db.client';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import type { IDType } from '@kernel/application/application.types';
import type { FavoriteGalleryRecord } from '@kernel/models/db_models.generated.dto';
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
import { lockInOrder, lockStylistAccount } from '@app/db/lock-rows';
import { favoriteAddLockPlan } from '@app/db/lock-plans';
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
  // public profile (discovery channel) OR whose author she can currently reach (resolveSalonAccess_IO:
  // direct pair or live salon access). Without this, any record could be liked by id, leaking asset_url of
  // an unpaired stylist's private gallery. Mask inaccessible records as NOT_FOUND.
  //
  // DECISION: the owner id (immutable) is read first, then the StylistAccount lock (lockInOrder), and only THEN is the mutable
  // access evaluated. Pairing revoke takes the same lock before it deletes likes and flips the pair, so the
  // two serialize: add-then-revoke deletes the new like, revoke-then-add re-reads REVOKED under READ COMMITTED
  // (each statement after the lock sees the revoke's commit) and is refused. Evaluating access BEFORE the
  // lock let a revoke commit while add waited, and add then inserted a private like for a former client
  // (F1, reproduced over HTTP + Postgres 2026-10-22). One transaction does NOT give one snapshot here: only
  // the lock orders the reads after the revoke. Do not move the access reads above the lock.
  let favorite: FavoriteGalleryRecord;
  try {
    const txResult = await DB_CLIENT.use.$transaction(async tx => {
      const owner = await tx.galleryRecord.findUnique({
        where: { gallery_record_id },
        select: { created_by_account_id: true },
      });
      if (!owner) {
        return { ok: false as const };
      }

      // DECISION: the StylistAccount lock is taken BEFORE the access reads and create+increment. It
      // serializes add with pairing revoke (see above) and with add/remove toggles on the same (client,
      // record), whose row op and counter op must be ordered as a pair, or cached_likes_count drifts.
      // The client's users row comes FIRST in KEY SHARE (favoriteAddLockPlan): the like INSERT's FK check
      // takes it anyway, and taking it after the StylistAccount deadlocked with session create/share,
      // which hold users FOR UPDATE and then insert a row referencing this StylistAccount (LOCK_GRAPH.md C1).
      await lockInOrder(
        tx,
        favoriteAddLockPlan(id, owner.created_by_account_id)
      );

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

      // DECISION: a record hidden by moderation (HIDE), or any record of a banned stylist (BAN sets
      // is_hidden=true and does not unpin), cannot be liked. This matches getGalleryRecordByID_IO, which
      // masks is_hidden as NOT_FOUND for non-owners; otherwise add-record would answer 201 for
      // pinned-but-hidden vs 404 for missing (existence oracle) and leave a ghost favorite that revives on
      // un-hide. The check runs BEFORE both access branches (pinned and active-pair).
      //
      // DECISION: self-favorite guard for dual-role users. One User.id can own a client account (passes
      // requireClientAccount) and a stylist account with records. The active-pair branch rejects
      // self-favorite by itself (no self-pairing), but the PINNED branch does not: a user could pin their own
      // record and like it, inflating their own public cached_likes_count. Ownership is resolved like
      // gallery-detail.query.ts (created_by_account.created_by_user_id === id) and rejected before both
      // branches with the usual RECORD_TO_ADD_NOT_FOUND mask (the owner still sees the record through the
      // gallery owner bypass, so the 404 leaks nothing). The counter is never incremented. The guard is
      // forward-only: it adds no backfill and no GET-level self-filter because the pre-launch production
      // DB has no FavoriteGalleryRecord rows and no new self-row can form.
      if (
        accessRecord.is_hidden ||
        accessRecord.created_by_account.created_by_user_id === id
      ) {
        return { ok: false as const };
      }

      // DECISION: the PINNED (discovery) branch requires the record owner to be publicly visible
      // (STYLIST_PUBLICLY_VISIBLE: account_status ACTIVE and created_by_user.is_active). is_hidden is not
      // enough: self-disable/soft-delete and admin disable/ban keep is_pinned=true and is_hidden=false, so
      // a pinned record of an invisible stylist could still be liked, leaving a ghost favorite (hidden in
      // GET, revived on re-enable) and an existence oracle (201 vs 404). Same NOT_FOUND as
      // bookmarkStylist_IO and the read filter of this file. findFirst, not findUnique, because the
      // predicate mixes the unique account_id with non-unique fields. Only the pinned branch: the unpinned
      // branch goes through resolveSalonAccess_IO, which applies the same visibility itself.
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
        const access = await resolveSalonAccess_IO(
          id,
          accessRecord.created_by_account_id,
          tx
        );
        if (!access) {
          return { ok: false as const };
        }
      }

      // DOMAIN_SSOT §5.7 (2026-02-17): Like does NOT auto-bookmark.
      // Smart Bookmark Suggestion (frontend dialog) after 3 likes from same stylist.
      // Trim mirror updateRecordNote_IO (whitespace-only → null) — symetria add/update.
      const trimmedNote = note != null ? note.trim() || null : null;

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
  // DECISION: the decrement must be atomic with the row delete and serialized with concurrent
  // add/remove/moderation on the same stylist, so lockStylistAccount (the global order is LOCK_RANK in
  // application/db/lock-order.ts; this tx takes no lower-rank row) is the FIRST counting step,
  // before the is_hidden read and deleteMany. The counter is likes of VISIBLE records: an already hidden
  // record is outside it, so un-liking it does not decrement. is_hidden is read under the lock (moderation
  // HIDE is also SA-first, so no double count). The decrement is gated on deleted.count===1 (0 = already
  // removed, idempotent no-op), and GREATEST(0, ...) is the last defence. Both together are needed: gating
  // alone left add-vs-remove undercounts, the lock alone would still decrement on a stale read.
  // Taking StylistAccount first also aligns remove with moderation-DELETE; the old Favorite-then-
  // StylistAccount order was an ABBA deadlock (40P01) hidden by retries. withWriteTx with
  // retryOn:isDeadlock stays for hidden FK-cascade locks (gallery-delete), see lock-rows.ts. If the record
  // is gone entirely (cascade), the owner read is null and the call is a no-op because that path already decremented.
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

  let favorites;
  try {
    // DECISION: the access scope and the page are read in ONE Repeatable Read snapshot, and the scope is a
    // SQL predicate applied before take/cursor (favorite-access.ts), so a page never has holes from
    // post-filtering and a like whose access is gone (orphaned by an old race, a salon departure, a lost
    // plan) never returns its asset_url. Read-only, so Repeatable Read cannot raise serialization errors.
    favorites = await DB_CLIENT.use.$transaction(
      async tx => {
        const scope = await resolveFavoriteReadScope_IO(id, tx);
        return tx.favoriteGalleryRecord.findMany({
          where: {
            client_user_id: id,
            record: favoriteReadableRecordWhere(scope),
          },
          // Scoped select: only the needed Color/Trait fields, no junction-table columns.
          // SSOT: GALLERY_COLORS_TRAITS_SELECT (@domain/gallery/gallery.utils.api), shared with explore/list/detail/public/update.
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
      },
      { isolationLevel: 'RepeatableRead' }
    );
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
