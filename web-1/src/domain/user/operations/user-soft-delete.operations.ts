import { finishSalonInvitationsAfterReactivation } from '@domain/salon-staff/salon-invitation-token.service';
import { finishFreeForSalonOwners_IO } from '@domain/email/operations/free-email.salon-access';
import { DB_CLIENT } from '@app/db/db.client';
import { withWriteTx } from '@app/db/with-write-tx';
import { lockUserRow } from '@app/db/lock-rows';
import type { IDType } from '@kernel/application/application.types';
import {
  AccountStatusValue,
  type AccountStatus,
} from '@kernel/models/db_models.generated.dto';
import {
  assertType,
  isAccountStatusNarrower,
  narrowUser,
} from '@kernel/models/type_narrowing';
import { isDeadlock, isP2025 } from '@app/db/prisma-error';
import type { UserWithRelations } from '@kernel/models/user/user.types';
import { USER_POLICY } from '@kernel/policies/user.policy';
import {
  userRelationsEnabler,
  userRelationsArchiveEnabler,
} from '@domain/user/user.config';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  UserNotFoundError,
  AccountNotRecoverableError,
} from '@kernel/domain/user-and-account/user-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { RECOVERY_CONFIG } from '@kernel/domain/recovery/deleted-user-backup.types';
import { revokeImpersonationOnEviction } from '@domain/admin/impersonation-eviction';
import { decrementLikesForDeletedClient } from '@domain/favorites/operations/favorite-count.helper';
import { decrementBookmarksForDeletedClient } from '@domain/favorites/operations/bookmark-count.helper';
import { cancelStripeSubscriptionIfExists } from '@app/stripe/customer.operations';

/**
 * Soft-delete the current user's own account.
 * Sets is_active false, deleted_at now and recovery_available true, and clears
 * sessions. Data stays in place; reactivation restores it. null means the account
 * was not ACTIVE (no-op).
 * DECISION: updateMany WHERE id AND is_active=true. count 0 returns null, so a
 * replay does not refresh the window or revive an inactive account. No test pins
 * the replay. disabled_at stays null so soft-delete (deleted_at) stays distinct
 * from an admin ban (disableUser_IO).
 */
export const softDeleteAccount_IO = async (
  passedUser: UserWithRelations
): Promise<
  OperationResult<UserWithRelations | null, UserNotFoundError | DatabaseError>
> => {
  let userRaw: UserWithRelations | null;
  try {
    userRaw = await DB_CLIENT.use.$transaction(async tx => {
      // Atomic compare-and-set: only an ACTIVE row transitions to RECOVERABLE.
      const claim = await tx.user.updateMany({
        where: { id: passedUser.id, is_active: true },
        data: {
          is_active: false,
          deleted_at: new Date(),
          recovery_available: true,
        },
      });

      if (claim.count === 0) {
        // Already inactive (RECOVERABLE/EXPIRED/ADMIN-DISABLED) or missing.
        // No-op: do not re-arm recovery or reset the deletion clock.
        return null;
      }

      // Stylist account_status → NOT_ACTIVE (nested write needs the dedicated
      // call; updateMany above cannot touch the relation).
      if (passedUser.stylist_account) {
        await tx.stylistAccount.updateMany({
          where: { created_by_user_id: passedUser.id },
          data: {
            account_status: assertType(
              AccountStatusValue.NOT_ACTIVE,
              isAccountStatusNarrower,
              'NOT_ACTIVE status'
            ),
          },
        });
      }

      // Log the user out everywhere.
      await tx.session.deleteMany({ where: { userId: passedUser.id } });

      const fresh = await tx.user.findUnique({
        where: { id: passedUser.id },
        include: userRelationsEnabler,
      });
      return fresh
        ? narrowUser<UserWithRelations>(fresh, 'softDeleteAccount_IO:fresh')
        : null;
    });
  } catch (error: unknown) {
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
    }
    return databaseFailure('softDeleteAccount_IO', error);
  }

  // Eviction cleanup: if the soft-deleted user was a mid-impersonation admin,
  // tear down the orphaned impersonated (target) session + ImpersonationBackup.
  // Best-effort, outside the tx — failure must never block the soft-delete.
  // Mirror of deleteAllSessionsOfUser_IO (user-session.operations.ts ~line 330).
  await revokeImpersonationOnEviction(passedUser.id);

  // null === idempotent no-op (account was not ACTIVE). Surface as success(null)
  // so the caller can short-circuit without re-killing a recovered account.
  return success(userRaw);
};

/**
 * Reactivate a soft-deleted (RECOVERABLE) account IN PLACE (post-login, 1-click).
 *
 * Sets is_active=true, deleted_at=null, recovery_available=false. Account returns
 * to its pre-deletion state — plan, gallery, settings are NOT reset (data was
 * never removed). Idempotency + authorization guard: the update is scoped with
 * `recovery_available=true AND disabled_at=null`, so EXPIRED (window passed),
 * ADMIN-DISABLED (ban), banned-while-recoverable (soft-delete → admin-ban hybrid)
 * and already-ACTIVE rows cannot be reactivated — they hit count=0 → error.
 *
 * userId MUST come from the authenticated session (currentUser.id), never body.
 */
export const reactivateAccount_IO = async ({
  id,
}: {
  id: IDType;
}): Promise<
  OperationResult<
    UserWithRelations,
    UserNotFoundError | AccountNotRecoverableError | DatabaseError
  >
> => {
  try {
    // DECISION: guard = updateMany WHERE id AND recovery_available=true AND disabled_at=null
    // (compare-and-set). count=0 (expired, banned, active, no such user) => ACCOUNT_NOT_RECOVERABLE.
    // The stylist account_status is set in a second step inside the same $transaction.
    //
    // DECISION: delete_confirm_version++ on EVERY reactivation. It invalidates pending delete-confirm
    // tokens, so replaying an old (<= 24h) link after reactivation hits the version mismatch in
    // confirmDeleteSelf_IO and is rejected.
    const reactivated = await DB_CLIENT.use.$transaction(async tx => {
      // DECISION: recovery_available=true is the ONLY reactivation gate; the 90d window
      // (RECOVERY_CONFIG.MAX_DAYS) is deliberately NOT re-checked (no deleted_at condition). Only the
      // MOVE cron (expireMoveRecoveryWindows_IO) enforces 90d by hard-deleting the row, so an account can
      // stay reactivable up to the sweep's <= 24h delay past 90d.
      //
      // DECISION: SECURITY: disabled_at:null is MANDATORY in the WHERE; recovery must NOT lift an admin
      // ban. A soft-deleted-then-banned hybrid (deleted_at set, recovery_available=true, disabled_at set)
      // passes account-state-guard as RECOVERABLE; without the condition self-service removed the ban.
      // It now gets count=0 => ACCOUNT_NOT_RECOVERABLE (same answer as expired/active, anti-enumeration).
      // Test: web-1/src/domain/user/operations/user-soft-delete.operations.test.ts (covers hybrid not
      // lifted and clean reactivation; not concurrent reactivations).
      //
      // DECISION: disabled_at:null in the data block keeps the state coherent (is_active=true implies
      // disabled_at=null) for consumers that filter on both (salon-staff invite lookup, email-change
      // confirm stateGuard).
      const claim = await tx.user.updateMany({
        where: { id, recovery_available: true, disabled_at: null },
        data: {
          is_active: true,
          disabled_at: null,
          deleted_at: null,
          recovery_available: false,
          delete_confirm_version: { increment: 1 },
        },
      });

      if (claim.count === 0) {
        return null;
      }

      const fresh = await tx.user.findUnique({
        where: { id },
        include: userRelationsEnabler,
      });
      const narrowedFresh = fresh
        ? narrowUser<UserWithRelations>(fresh, 'reactivateAccount_IO:fresh')
        : null;

      // Re-activate stylist account_status (mirror enableUser_IO policy gate).
      if (narrowedFresh?.stylist_account) {
        const nextStatus: AccountStatus | undefined =
          USER_POLICY.utils.CAN_USER_HAVE_ACTIVE_ACCOUNT({
            user: narrowedFresh,
          })
            ? assertType(
                AccountStatusValue.ACTIVE,
                isAccountStatusNarrower,
                'ACTIVE status'
              )
            : undefined;
        if (nextStatus) {
          await tx.stylistAccount.updateMany({
            where: { created_by_user_id: id },
            data: { account_status: nextStatus },
          });
          // Reflect the status change on the object we return.
          narrowedFresh.stylist_account.account_status = nextStatus;
        }
      }

      if (
        narrowedFresh?.stylist_account &&
        (narrowedFresh.stylist_account.pricing_plan === 'STUDIO' ||
          narrowedFresh.stylist_account.pricing_plan === 'SCALE') &&
        narrowedFresh.stylist_account.subscription_status === 'ACTIVE'
      ) {
        await finishFreeForSalonOwners_IO(tx, [id]);
      }

      return narrowedFresh;
    });

    if (reactivated === null) {
      return failure({ type: 'ACCOUNT_NOT_RECOVERABLE', userId: id });
    }

    // DECISION: see salon-invitation-token.service.ts (an active account again finishes both sides).
    await finishSalonInvitationsAfterReactivation(id, 'account reactivation');
    return success(reactivated);
  } catch (error: unknown) {
    return databaseFailure('reactivateAccount_IO', error);
  }
};

export const moveExpiredUserToArchive_IO = async ({
  id,
}: {
  id: IDType;
}): Promise<OperationResult<{ moved: boolean }, DatabaseError>> => {
  try {
    const snapshot = await DB_CLIENT.use.user.findUnique({
      where: { id },
      include: userRelationsArchiveEnabler,
    });

    if (!snapshot) {
      // Already moved/deleted by a concurrent instance — idempotent skip.
      return success({ moved: false });
    }

    // Fail-safe Stripe cancel: MOVE is the only permanent-delete path that did not cancel the
    // subscription. If the best-effort cancel at soft-delete failed and the alert was missed for 90
    // days, the subscription would bill an account with no owner. The helper is never-throw (logs,
    // alerts, continues the delete) and a no-op without a subscription.
    await cancelStripeSubscriptionIfExists(id);

    await withWriteTx(
      async tx => {
        // DECISION: see user-crud.operations.ts deleteUser_IO (users row locked first, deadlock retry).
        await lockUserRow(tx, id);
        // Normalize Prisma 7 TaggedDateTime ({$type,value}) -> plain ISO (same as deleteUser_IO).
        const normalizedBody = JSON.parse(JSON.stringify(snapshot)) as object;

        // Permanent RAW archive (NON-restorable). is_move_archive set from the start so a crash
        // between upsert and delete never leaves a "restorable" half-archive.
        await tx.deletedUser.upsert({
          where: { user_id: id },
          update: {
            body: normalizedBody,
            email: snapshot.email,
            is_move_archive: true,
          },
          create: {
            user_id: id,
            body: normalizedBody,
            email: snapshot.email,
            is_move_archive: true,
          },
        });

        // Target-side impersonation backup cleanup (mirror deleteUser_IO; idempotent count=0).
        await tx.impersonationBackup.deleteMany({
          where: { impersonated_user_id: id },
        });

        // CLIENT HARD-DELETE CASCADE drift fix (mirror deleteUser_IO; finding spar/user-cascade):
        // FavoriteGalleryRecord.client_user_id has onDelete:Cascade, so the tx.user.delete below
        // removes this client's likes at the DB level WITHOUT routing through the cached_likes_count
        // write-path. Decrement every affected stylist's counter (visible likes only) in the SAME tx,
        // BEFORE the delete — afterwards the FavoriteGalleryRecord rows are already gone. The user id
        // (= client_user_id) is the join key; independent of the recovery_available delete guard.
        await decrementLikesForDeletedClient(tx, id);
        // Bookmark sibling (CWT-1, mirror deleteUser_IO): FavoriteStylist.client_user_id
        // onDelete:Cascade ALSO bypasses cached_bookmark_count — decrement BEFORE the delete.
        await decrementBookmarksForDeletedClient(tx, id);

        // DELETE the User row -> email freed. Cascade removes StylistAccount/gallery/client/
        // favorites/pairings/staff/strikes/accounts/sessions. Soft-FK rows survive (raw user_id).
        // Guard recovery_available=true: closes the SELECT-then-delete race with
        // reactivateAccount_IO (which flips recovery_available=false). If reactivation
        // won between the batch SELECT and here, this delete hits P2025 -> the whole tx
        // (incl. the archive upsert) rolls back, so a reactivated ACTIVE account is never
        // archived/deleted on a stale snapshot.
        await tx.user.delete({ where: { id, recovery_available: true } });
      },
      { retryOn: isDeadlock }
    );

    return success({ moved: true });
  } catch (error: unknown) {
    if (isP2025(error)) {
      // Concurrent instance won the delete — atomic rollback of this tx, no double-move.
      return success({ moved: false });
    }
    return databaseFailure('moveExpiredUserToArchive_IO', error);
  }
};

/**
 * Batch move: archive soft-deleted accounts past the 90-day window, 50 per run.
 * A per-row failure is logged and does not abort the batch.
 * DECISION: two instances may select the same rows; the loser gets P2025 and
 * { moved: false }. There is no advisory lock. The list filter is only a fast
 * path. Reactivation between this SELECT and the delete is handled by
 * `WHERE id AND recovery_available=true` on the delete: P2025 rolls the archive
 * upsert back with it. No test pins that interleaving.
 */
export const expireMoveRecoveryWindows_IO = async (): Promise<
  OperationResult<{ moved: number }, DatabaseError>
> => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RECOVERY_CONFIG.MAX_DAYS);

    const expired = await DB_CLIENT.use.user.findMany({
      where: {
        recovery_available: true,
        deleted_at: { lt: cutoff },
      },
      select: { id: true },
      take: 50,
    });

    let moved = 0;
    for (const { id } of expired) {
      const result = await moveExpiredUserToArchive_IO({ id });
      if (result.success && result.data.moved) {
        moved += 1;
      }
    }

    return success({ moved });
  } catch (error: unknown) {
    return databaseFailure('expireMoveRecoveryWindows_IO', error);
  }
};
