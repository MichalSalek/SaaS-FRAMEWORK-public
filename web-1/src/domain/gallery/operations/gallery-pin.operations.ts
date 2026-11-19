import { DB_CLIENT } from '@app/db/db.client';
import type { Prisma } from '../../../prisma/js-client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  isUnlimitedLimit,
  PRICING_POLICY,
} from '@kernel/policies/pricing.policy';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { lockStylistAccount } from '@app/db/lock-rows';
import { VISIBLE_PINNED_GALLERY_RECORD_WHERE } from '@domain/gallery/gallery-record-visibility';
import type {
  GalleryRecordNotFoundError,
  GalleryPinLimitReachedError,
  GalleryRecordAlreadyPinnedError,
  GalleryRecordNotPinnedError,
} from '@kernel/domain/gallery/gallery-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';

/** Position right after the stylist's last pinned work (0 for her first pin). */
const resolveNextPinnedPosition = async (
  tx: Prisma.TransactionClient,
  stylistAccountId: string
): Promise<number> => {
  const last = await tx.galleryRecord.aggregate({
    where: { created_by_account_id: stylistAccountId, is_pinned: true },
    _max: { pinned_position: true },
  });
  const max = last._max.pinned_position;
  return max === null ? 0 : max + 1;
};

/**
 * Pin a gallery record (atomic transaction).
 *
 * A read-then-update would let concurrent requests all read is_pinned=false and all succeed.
 * Instead an atomic updateMany with { id, is_pinned: false, owner } in WHERE lets only one request
 * match; the others get count=0 and fall through to the fetch-to-distinguish path.
 * The cross-record pin-quota race is handled by the StylistAccount FOR UPDATE lock, see the DECISION
 * inside the transaction below.
 * Test: web-1/src/domain/gallery/operations/gallery-pin.operations.test.ts (covers the WHERE keys and
 * race-loser branches against a mocked DB; not lock order or a live concurrent burst).
 */
export const pinGalleryRecord_IO = async ({
  gallery_record_id,
  stylist_account_id,
  pricing_plan,
}: {
  gallery_record_id: string;
  stylist_account_id: string;
  pricing_plan: PricingPlan;
}): Promise<
  OperationResult<
    { pinnedCount: number },
    // DECISION: no GalleryRecordOwnershipError in the union: a foreign record is masked as
    // GALLERY_RECORD_NOT_FOUND (see the ownership branch below); the op never returns OWNERSHIP_ERROR.
    | GalleryRecordNotFoundError
    | GalleryRecordAlreadyPinnedError
    | GalleryPinLimitReachedError
    | DatabaseError
  >
> => {
  const planConfig = PRICING_POLICY.utils.getPlanConfig(pricing_plan);
  const pinLimit = planConfig.max_pinned_records;

  try {
    return await DB_CLIENT.use.$transaction(async tx => {
      await lockStylistAccount(tx, stylist_account_id);

      // DECISION: an already-pinned record is resolved BEFORE the quota gate. Re-pinning a pinned record is
      // an idempotent no-op that consumes no new slot, so without this a re-pin at the limit returned
      // GALLERY_PIN_LIMIT_REACHED (403) instead of GALLERY_RECORD_ALREADY_PINNED (400). Not-found and foreign
      // records are resolved here too (same anti-enumeration mask as below). Under the lock the read is
      // consistent with concurrent pins of this account; for an unpinned record the flow goes to quota plus
      // the atomic updateMany (race loser: count===0 with owner ok means a concurrent pin won = ALREADY_PINNED).
      const target = await tx.galleryRecord.findUnique({
        where: { gallery_record_id },
        select: {
          created_by_account_id: true,
          is_pinned: true,
          is_hidden: true,
        },
      });

      if (!target) {
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      if (target.created_by_account_id !== stylist_account_id) {
        reportIssueBackend({
          namespace: 'pinGalleryRecord_IO',
          message: `Unauthorized pin attempt (masked as 404). Owner: ${target.created_by_account_id}, Requester: ${stylist_account_id}`,
          payload: { gallery_record_id },
          mode: 'error',
        });
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      // DECISION: a moderation-hidden record cannot be pinned. Pinning only serves the public profile and the
      // public gallery filters `is_hidden:false`, so pinning a hidden record returned 200, consumed a plan slot
      // and showed nothing (measured: pinned_count=2 while the public gallery returned 1). The mask is the same
      // GALLERY_RECORD_NOT_FOUND as for a foreign or missing record, because on the public surface the record
      // does not exist (same as gallery-detail.query, where a hidden record is 404 for everyone but the owner).
      // A dedicated domain error would read better but needs a kernel type and an error-mapper branch. Hiding
      // is terminal here: no path writes `is_hidden:false` (un-ban deliberately does not bulk-unhide), so the
      // refusal is never premature.
      if (target.is_hidden) {
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      if (target.is_pinned) {
        return failure({
          type: 'GALLERY_RECORD_ALREADY_PINNED',
          recordId: gallery_record_id,
        });
      }

      // Quota check before the atomic update. With the FOR UPDATE lock above held,
      // this count reads COMMITTED state (concurrent pins for this account queue on
      // the lock), so it is now the authoritative gate, not just a fast-fail.
      //
      // DECISION: the quota counts VISIBLE pins (`is_hidden:false`), exactly what the public profile returns
      // and what the dashboard usage tile shows (account-dashboard counts `is_pinned + !is_hidden`). Counted
      // differently, a record hidden after pinning kept its slot: the panel said "2/3" while the gate refused
      // as at 3/3. Same as the other per-account counters (cached_gallery_count, cached_likes_count).
      const pinnedCount = await tx.galleryRecord.count({
        where: {
          created_by_account_id: stylist_account_id,
          ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
        },
      });

      if (!PRICING_POLICY.utils.canPinGalleryRecord(planConfig, pinnedCount)) {
        return failure({
          type: 'GALLERY_PIN_LIMIT_REACHED',
          currentPinned: pinnedCount,
          limit: pinLimit,
        });
      }

      // A new pin goes to the END of the stylist's order on the public profile.
      // Under the account lock above no other pin of this account can take the same
      // slot. Hidden pinned records keep their position, so they count here too.
      const nextPosition = await resolveNextPinnedPosition(
        tx,
        stylist_account_id
      );

      // Atomic guard: WHERE includes is_pinned=false + ownership so only
      // one concurrent request wins. PostgreSQL's UPDATE is atomic — no
      // two transactions can both match and increment the same row.
      const updated = await tx.galleryRecord.updateMany({
        where: {
          gallery_record_id,
          is_pinned: false,
          created_by_account_id: stylist_account_id,
          // The whole precondition in one atomic UPDATE. Moderation HIDE takes the same StylistAccount
          // lock (see moderation-admin), so is_hidden cannot flip inside this tx, but the gate stays
          // self-sufficient: the same SQL statement checks what the pre-check above checked.
          is_hidden: false,
        },
        data: { is_pinned: true, pinned_position: nextPosition },
      });

      if (updated.count > 0) {
        // DECISION: the POST-UPDATE VERIFY recount is belt-and-suspenders only. The StylistAccount lock
        // (see the DECISION at the start of this tx) closes the cross-record pin race at the source, so the
        // pre-check under the lock is authoritative and this recount practically never fires. It stays as a
        // cheap in-tx guard in case a non-locking is_pinned writer appears: finalPinnedCount > limit throws a
        // sentinel, the tx rolls back and the outer catch maps it to GALLERY_PIN_LIMIT_REACHED. It is NOT the
        // primary fix: alone, under READ COMMITTED, it read the peer's pre-commit snapshot and did not close
        // the race (confirmed live). Parity: gallery-create.operation.ts (recount) + moderation-admin (lock-first).
        if (!isUnlimitedLimit(pinLimit)) {
          const finalPinnedCount = await tx.galleryRecord.count({
            where: {
              created_by_account_id: stylist_account_id,
              // Same visibility filter as the pre-check above, otherwise the recount would compare a
              // different set against the limit than the gate that let the pin through.
              ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
            },
          });
          if (finalPinnedCount > pinLimit) {
            throw new Error('__PIN_QUOTA_RACE__');
          }
        }
        // Happy path: we won the race.
        return success({ pinnedCount: pinnedCount + 1 });
      }

      // count===0: not found, not owner, or already pinned — fetch once to
      // distinguish. This path is hit only in the failure/race-loser case.
      const existing = await tx.galleryRecord.findUnique({
        where: { gallery_record_id },
        select: {
          created_by_account_id: true,
          is_pinned: true,
          is_hidden: true,
        },
      });

      if (!existing || existing.is_hidden) {
        // Vanished or hidden between the pre-check and the UPDATE: both give the same 404 mask as the
        // is_hidden branch above (the record does not exist for the public surface).
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      // DECISION: anti-enumeration mask (404 for a foreign record, never 403): see
      // web-1/src/domain/gallery/operations/gallery-update.operation.ts. Ownership stays after
      // RBAC.
      if (existing.created_by_account_id !== stylist_account_id) {
        reportIssueBackend({
          namespace: 'pinGalleryRecord_IO',
          message: `Unauthorized pin attempt (masked as 404). Owner: ${existing.created_by_account_id}, Requester: ${stylist_account_id}`,
          payload: { gallery_record_id },
          mode: 'error',
        });
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      // Record exists, is owned by requester, but is_pinned=true — either
      // it was already pinned before this request, or a concurrent request
      // won the race. Both cases: correct response is ALREADY_PINNED.
      return failure({
        type: 'GALLERY_RECORD_ALREADY_PINNED',
        recordId: gallery_record_id,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === '__PIN_QUOTA_RACE__') {
      return failure({
        type: 'GALLERY_PIN_LIMIT_REACHED',
        currentPinned: pinLimit,
        limit: pinLimit,
      });
    }
    return databaseFailure('pinGalleryRecord', error);
  }
};

/**
 * Unpin a gallery record (atomic transaction).
 *
 * DECISION: unpin follows the same pattern as pin, lock-first plus an atomic updateMany. Without the
 * lock one state change could return 200 SUCCESS twice, and `pinnedCount` could be taken after another
 * commit. The StylistAccount lock serializes unpin with pin of the same account (pin takes the same
 * row), so `pinnedCount` in the response is the number after THIS operation.
 * Test: web-1/src/domain/gallery/operations/gallery-pin.operations.test.ts (covers the NOT_PINNED
 * branch against a mocked DB; not lock order or a live burst).
 */
export const unpinGalleryRecord_IO = async ({
  gallery_record_id,
  stylist_account_id,
}: {
  gallery_record_id: string;
  stylist_account_id: string;
}): Promise<
  OperationResult<
    { pinnedCount: number },
    // DECISION: no GalleryRecordOwnershipError in the union: a foreign record is masked as
    // GALLERY_RECORD_NOT_FOUND (see the ownership branch below); the op never returns OWNERSHIP_ERROR.
    GalleryRecordNotFoundError | GalleryRecordNotPinnedError | DatabaseError
  >
> => {
  try {
    return await DB_CLIENT.use.$transaction(async tx => {
      // Per-account serialization point, taken FIRST: the same row and order as in pinGalleryRecord_IO (see
      // its lock DECISION), so pin and unpin of one account never count pins on each other's pre-commit snapshot.
      await lockStylistAccount(tx, stylist_account_id);

      const record = await tx.galleryRecord.findUnique({
        where: { gallery_record_id },
        select: { created_by_account_id: true, is_pinned: true },
      });

      if (!record) {
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      // DECISION: same anti-enumeration mask as in pinGalleryRecord_IO: a foreign record returns
      // GALLERY_RECORD_NOT_FOUND (404), not OWNERSHIP_ERROR (403), and the attempt is logged server-side only.
      // Same as gallery-update and gallery-delete.
      if (record.created_by_account_id !== stylist_account_id) {
        reportIssueBackend({
          namespace: 'unpinGalleryRecord_IO',
          message: `Unauthorized unpin attempt (masked as 404). Owner: ${record.created_by_account_id}, Requester: ${stylist_account_id}`,
          payload: { gallery_record_id },
          mode: 'error',
        });
        return failure({
          type: 'GALLERY_RECORD_NOT_FOUND',
          recordId: gallery_record_id,
        });
      }

      if (!record.is_pinned) {
        return failure({
          type: 'GALLERY_RECORD_NOT_PINNED',
          recordId: gallery_record_id,
        });
      }

      // Atomic gate (parity with pin): the full precondition sits in ONE SQL statement, so a second
      // request matches no row. updateMany (not update) does not throw P2025 when the record vanished
      // mid-flight: count=0 is resolved by one read below (same 404 mask).
      // Test: web-1/src/domain/gallery/operations/gallery-pin.operations.test.ts (covers the count=0
      // branches against a mocked DB; not a live burst), tests/concurrency/p2025-mapping.concurrency.ts
      // (covers unpin racing a delete of the same row).
      const updated = await tx.galleryRecord.updateMany({
        where: {
          gallery_record_id,
          is_pinned: true,
          created_by_account_id: stylist_account_id,
        },
        // Unpinned works have no place in the order; a later re-pin appends.
        data: { is_pinned: false, pinned_position: null },
      });

      if (updated.count === 0) {
        const existing = await tx.galleryRecord.findUnique({
          where: { gallery_record_id },
          select: { created_by_account_id: true, is_pinned: true },
        });
        if (
          !existing ||
          existing.created_by_account_id !== stylist_account_id
        ) {
          // Vanished (owner delete / moderation DELETE) or, theoretically, no longer ours: the same
          // anti-enumeration mask as above.
          return failure({
            type: 'GALLERY_RECORD_NOT_FOUND',
            recordId: gallery_record_id,
          });
        }
        // Lost the race to a parallel unpin: the record is already unpinned but THIS request changed
        // nothing, so 400 NOT_PINNED, not 200 SUCCESS.
        return failure({
          type: 'GALLERY_RECORD_NOT_PINNED',
          recordId: gallery_record_id,
        });
      }

      const pinnedCount = await tx.galleryRecord.count({
        where: {
          created_by_account_id: stylist_account_id,
          // Same visibility filter as the pin gate: one definition of "how many pinned" on both paths and
          // in the usage tiles (account-dashboard, usage-stats).
          ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
        },
      });

      return success({ pinnedCount });
    });
  } catch (error) {
    return databaseFailure('unpinGalleryRecord', error);
  }
};
