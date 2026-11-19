/**
 * Content Moderation — Admin Operations
 *
 * Resolve report (approve/reject with action) and apply strike to users.
 */

import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type {
  ContentReportNotFoundError,
  ContentReportAlreadyResolvedError,
} from '@kernel/domain/moderation/moderation-errors.types';
import type {
  AdminTargetProtectedError,
  AdminInsufficientPermissionsError,
} from '@kernel/domain/admin/admin-errors.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import {
  ModerationAction,
  type ContentReportStatus,
  type ModerationAction as ModerationActionType,
} from '@kernel/models/moderation/moderation.dto';
import {
  ContentReportStatusValue,
  AccountStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { isDeadlockError } from './moderation-admin-concurrency.helper';
import { withWriteTx } from '@app/db/with-write-tx';
import { lockInOrder } from '@app/db/lock-rows';
import { moderationResolveLockPlan } from '@app/db/lock-plans';
// DECISION: the cached_gallery_count writer lives in gallery (gallery owns the counter) and moderation imports
// it; the dependency direction moderation -> gallery is intended, lock/deadlock concerns stay in moderation.
import { decrementGalleryCountFloored } from '@domain/gallery/operations/gallery-count.helper';
// DECISION: the cached_likes_count writer lives in favorites (it owns the counter, like cached_gallery_count)
// and moderation imports it. HIDE/DELETE/BAN hide or delete visible records, so they MUST decrement those
// records' likes atomically in the same $transaction. un-hide/un-ban do not re-increment (deliberate
// asymmetry, see the BAN bulk-hide DECISION below).
import { decrementLikeCountFloored } from '@domain/favorites/operations/favorite-count.helper';

// ── Resolve Report ──

type ResolveReportParams = {
  report_id: string;
  action: ModerationActionType;
  admin_note?: string | undefined;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
};

type ResolveReportResult = {
  report_id: string;
  status: ContentReportStatus;
  action: ModerationActionType;
  gallery_record_id: string | null;
  gallery_record_owner_user_id: string | null;
  gallery_record_owner_email: string | null;
};

export const resolveContentReport_IO = async (
  params: ResolveReportParams
): Promise<
  OperationResult<
    ResolveReportResult,
    | ContentReportNotFoundError
    | ContentReportAlreadyResolvedError
    | AdminTargetProtectedError
    | AdminInsufficientPermissionsError
    | DatabaseError
  >
> => {
  const { report_id, action, admin_note, currentUser } = params;

  // Defense-in-depth: route-level RBAC (ADMIN_RESOLVE_REPORT event wiring) stays,
  // but the operation guards its own boundary — parity with the read sibling
  // getContentReports_IO and the write sibling applyModerationStrike_IO. This is
  // the domain's most destructive mutation (ban + session-evict + hard-delete +
  // bulk-hide), so it must not trust it was only ever reached via the admin route.
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }
  const resolved_by_id = currentUser.id;

  try {
    // Transaction: check PENDING → update → optional delete to prevent double-resolve.
    // DECISION: withWriteTx retries a deadlock (40P01) by re-running the whole callback (DB-only work, side
    // effects run after the commit). The ordered locks below make a cycle with another moderation of the same
    // stylist impossible; a retry covers the hidden cascade/FK locks of GalleryRecord DELETE. A re-run re-reads
    // the report under the lock, so a moderation that won meanwhile yields a genuine ALREADY_RESOLVED.
    const result = await withWriteTx(
      async tx => {
        // 1. Find the report with gallery record owner info
        const report = await tx.contentReport.findUnique({
          where: { id: report_id },
          include: {
            gallery_record: {
              select: {
                gallery_record_id: true,
                asset_url: true,
                is_hidden: true,
                created_by_account_id: true,
                created_by_account: {
                  select: {
                    account_id: true,
                    created_by_user_id: true,
                    created_by_user: {
                      // role_id is read to enforce the BAN protected-target guard
                      // (parity with applyModerationStrike_IO). email is used for the
                      // owner-notification email on HIDE/DELETE.
                      select: { email: true, role_id: true },
                    },
                  },
                },
              },
            },
          },
        });

        if (!report) {
          return failure({
            type: 'CONTENT_REPORT_NOT_FOUND' as const,
            reportId: report_id,
          });
        }

        if (report.gallery_record != null) {
          // DECISION: BAN locks the owner's User row and then the StylistAccount, in ONE lockInOrder call (canonical
          // order User -> StylistAccount, application/db/LOCK_GRAPH.md): BAN touches both rows, and a
          // StylistAccount-first BAN deadlocked with the User-first disable/enable/delete writers. The users lock is
          // FOR NO KEY UPDATE, the mode of the users UPDATE BAN makes later anyway: it serializes with every other
          // users writer, and unlike FOR UPDATE it does not block inserts that merely reference the user (FK KEY
          // SHARE). Targets: moderationResolveLockPlan. The StylistAccount lock still precedes every ContentReport
          // write; HIDE/DELETE lock only the StylistAccount. The owner id comes from the ownership chain (same as
          // user.update and the response).
          const banOwnerUserId =
            action === ModerationAction.BAN
              ? report.gallery_record.created_by_account?.created_by_user_id
              : undefined;
          await lockInOrder(
            tx,
            moderationResolveLockPlan(
              report.gallery_record.created_by_account_id,
              banOwnerUserId ?? null
            )
          );

          // Re-read status AFTER acquiring the lock. Under READ COMMITTED the initial
          // findUnique above ran on a pre-lock snapshot; a concurrent winner may have
          // auto-resolved THIS report (resolveRelatedReports) while we waited for the lock.
          // The post-lock read sees the winner's committed state → clean conflict, no
          // silent no-op of the losing moderation action.
          const lockedStatus = await tx.contentReport.findUnique({
            where: { id: report_id },
            select: { status: true },
          });
          if (lockedStatus === null) {
            // Report hard-deleted while we waited for the lock (e.g. FK cascade
            // after the reporter's account erasure). Without this guard we would
            // fall through to contentReport.update on a missing row → P2025 →
            // outer catch (which only maps 40P01) → opaque DATABASE_ERROR 500.
            return failure({
              type: 'CONTENT_REPORT_NOT_FOUND' as const,
              reportId: report_id,
            });
          }
          if (lockedStatus.status !== ContentReportStatusValue.PENDING) {
            return failure({
              type: 'CONTENT_REPORT_ALREADY_RESOLVED' as const,
              reportId: report_id,
            });
          }
        }

        if (report.status !== ContentReportStatusValue.PENDING) {
          return failure({
            type: 'CONTENT_REPORT_ALREADY_RESOLVED' as const,
            reportId: report_id,
          });
        }

        // 1c. Protected-target guard for BAN.
        // DECISION: BAN deactivates the record OWNER's User row (is_active=false plus session eviction), so it
        // acts on the PERSON like applyModerationStrike_IO and MUST carry the same protected-target guard
        // (moderation-strike.operations.ts): banning yourself or another MASTER_ADMIN is rejected with
        // ADMIN_TARGET_PROTECTED (error-mapper: 403 plus reason). Without it, since admins can own gallery
        // records (admin-seeding.operations.ts), one admin could ban another via a reported record. The guard
        // runs BEFORE the report status write, so a rejection rolls nothing back (same no-partial-commit
        // contract as the ALREADY_RESOLVED early returns). Scoped to BAN only: HIDE/DELETE act on a content
        // record, not on the owner's account, so they need no actor-relationship guard.
        if (action === ModerationAction.BAN && report.gallery_record != null) {
          const targetUserId =
            report.gallery_record.created_by_account?.created_by_user_id;
          const targetRoleId =
            report.gallery_record.created_by_account?.created_by_user?.role_id;
          if (targetUserId != null && targetUserId === resolved_by_id) {
            return failure({
              type: 'ADMIN_TARGET_PROTECTED' as const,
              reason: 'ADMIN_CANNOT_TARGET_SELF' as const,
            });
          }
          if (targetRoleId === SystemRoleId.MASTER_ADMIN) {
            return failure({
              type: 'ADMIN_TARGET_PROTECTED' as const,
              reason: 'ADMIN_CANNOT_TARGET_ADMIN' as const,
            });
          }
        }

        // 2. Determine status based on action
        // WARN/HIDE/DELETE/BAN = report was valid, action taken → APPROVED
        // DISMISS = report invalid/unfounded → REJECTED. DISMISS has ZERO side
        // effects on the content/owner (no hide/delete/strike/ban, no owner email)
        // — it only closes the report; see moderation.dto.ts.
        const ACTION_TO_STATUS: Record<
          ModerationActionType,
          ContentReportStatus
        > = {
          WARN: ContentReportStatusValue.APPROVED,
          HIDE: ContentReportStatusValue.APPROVED,
          DELETE: ContentReportStatusValue.APPROVED,
          BAN: ContentReportStatusValue.APPROVED,
          DISMISS: ContentReportStatusValue.REJECTED,
        };
        const status: ContentReportStatus = ACTION_TO_STATUS[action];

        // Effective action actually applied.
        // DECISION: when the report's gallery_record is null (record already deleted, SetNull), none of the
        // HIDE/DELETE/BAN side effects below can run (the whole `if (report.gallery_record != null)` block is
        // skipped) and the stale PENDING report is merely closed. Echoing the requested destructive action
        // (e.g. BAN) would tell the admin a ban occurred, so the EFFECTIVE action is reported as WARN ("reviewed,
        // no content action"; WARN has no branch below, so it never mutates). That keeps the response truthful
        // without a kernel change (WARN is an existing ModerationAction, the response shape is unchanged). The
        // call is deliberately not rejected: closing a stale orphan is legitimate. DISMISS is exempt: closing as
        // REJECTED is its full effect, and rewriting it to WARN would lie the other way (WARN implies APPROVED).
        const effectiveAction: ModerationActionType =
          report.gallery_record == null && action !== ModerationAction.DISMISS
            ? ModerationAction.WARN
            : action;

        // 3. Update report
        await tx.contentReport.update({
          where: { id: report_id },
          data: {
            status,
            admin_note: admin_note || null,
            resolved_by_id,
            resolved_at: new Date(),
          },
        });

        // 4. Apply moderation action on gallery record if needed
        if (report.gallery_record != null) {
          const recordId = report.gallery_record.gallery_record_id;
          const accountId = report.gallery_record.created_by_account_id;

          // Helper: resolve all other pending reports for this record
          const resolveRelatedReports = async (scope: 'record' | 'account') => {
            const where =
              scope === 'record'
                ? {
                    gallery_record_id: recordId,
                    id: { not: report_id },
                    status: ContentReportStatusValue.PENDING,
                  }
                : {
                    gallery_record: { created_by_account_id: accountId },
                    id: { not: report_id },
                    status: ContentReportStatusValue.PENDING,
                  };

            await tx.contentReport.updateMany({
              where,
              data: {
                status: ContentReportStatusValue.APPROVED,
                resolved_by_id,
                resolved_at: new Date(),
                admin_note: `Auto-resolved: gallery record actioned (${action}) via report ${report_id}`,
              },
            });
          };

          if (action === ModerationAction.HIDE) {
            // Hide the reported record — keeps data, invisible to public queries.
            // DECISION: HIDE MUST atomically decrement cached_gallery_count (same as DELETE). The public card's
            // photo_count (public-stylists-list) reads the raw cached_gallery_count while the gallery total_count
            // filters is_hidden:false, so without it the card overstated the photo count. The decrement happens
            // only when updateMany WHERE is_hidden:false flipped the record (count===1), so re-running HIDE on an
            // already hidden record (or a BAN bulk-hide) never double-subtracts.
            // Count likes of THIS record BEFORE hiding it (after updateMany the record is
            // hidden, so it would no longer count toward cached_likes_count). FavoriteGalleryRecord
            // has no FK to StylistAccount — likes are keyed by gallery_record_id (created_by_account_id
            // resolved once above).
            const likesHidden = await tx.favoriteGalleryRecord.count({
              where: { gallery_record_id: recordId },
            });
            const hidden = await tx.galleryRecord.updateMany({
              where: { gallery_record_id: recordId, is_hidden: false },
              data: { is_hidden: true },
            });
            if (hidden.count === 1) {
              // Floor-at-zero decrement (finding admin-state-cascade-l2-4): GREATEST(0, …)
              // so a pre-existing understated cache (backfill counts ALL records, this path
              // counts VISIBLE) can never drive the public photo_count below zero.
              await decrementGalleryCountFloored(tx, accountId, 1);
              // cached_likes_count also counts likes on visible records. Hiding a record
              // subtracts its likes. The hidden.count===1 guard stops a second subtract
              // when HIDE runs again on a record that is already hidden.
              if (likesHidden > 0) {
                await decrementLikeCountFloored(tx, accountId, likesHidden);
              }
            }
            await resolveRelatedReports('record');
          }

          if (action === ModerationAction.DELETE) {
            // Capture visibility + like count BEFORE deletion. is_hidden comes from the
            // findUnique fetch above (records become unreachable after delete; the
            // FavoriteGalleryRecord rows cascade away too).
            const wasVisible = report.gallery_record.is_hidden === false;
            const likesDeleted = wasVisible
              ? await tx.favoriteGalleryRecord.count({
                  where: { gallery_record_id: recordId },
                })
              : 0;
            // Resolve related reports before deletion (SetNull will clear gallery_record_id)
            await resolveRelatedReports('record');
            // DECISION: idempotent deleteMany instead of a throwing delete. `report.gallery_record` comes from the
            // findUnique SNAPSHOT (before the StylistAccount lock) and the post-lock re-read refreshes only the status,
            // so a parallel owner deleteGalleryRecord_IO may have won the lock, deleted the record (SetNull on
            // report.gallery_record_id) and committed. `delete` on a missing row threw P2025, the outer catch only
            // handles 40P01, and the admin got an HTTP 500 instead of a clean close. deleteMany returns count 0; the
            // report still closes ("3. Update report") and the cache decrements are skipped because the owner delete
            // already counted them.
            const deleted = await tx.galleryRecord.deleteMany({
              where: { gallery_record_id: recordId },
            });
            if (deleted.count === 1) {
              // DECISION: mirror gallery-delete.operation.ts, decrement cached_gallery_count atomically when moderation
              // hard-deletes a record, but ONLY when it was visible (wasVisible). The counter tracks VISIBLE records;
              // a record already hidden by HIDE/BAN was decremented at hide time, so deleting it subtracts 0, or the
              // public photo_count (raw value in public-stylists-list) would drift below the live visible count. Same
              // gate as cached_likes_count below (likesDeleted=0 when !wasVisible); the GREATEST(0, ...) floor is the
              // last defence.
              if (wasVisible) {
                await decrementGalleryCountFloored(tx, accountId, 1);
              }
              // cached_likes_count counts likes on visible records. Deleting a record
              // subtracts its likes only when it was visible (is_hidden=false). A record
              // already hidden had its likes subtracted at HIDE or BAN, so subtracting
              // again on DELETE would double the decrement (same gate as hidden.count===1).
              if (likesDeleted > 0) {
                await decrementLikeCountFloored(tx, accountId, likesDeleted);
              }
            }
          }

          if (action === ModerationAction.BAN) {
            await tx.stylistAccount.updateMany({
              where: { account_id: accountId },
              data: { account_status: AccountStatusValue.NOT_ACTIVE },
            });

            // DECISION: BAN MUST also disable the User row (is_active=false plus disabled_at), like disableUser_IO.
            // account-state-guard classifies state ONLY by User.is_active / deleted_at / recovery_available (it
            // ignores account_status and disabled_at on purpose). Flipping account_status=NOT_ACTIVE alone blocked
            // only account_status-based gating (e.g. requireStylistAccount), while a banned user kept the whole
            // BASE/LOGGED layer (REPORT_GALLERY_RECORD, favorites, support threads, notification prefs). Flipping
            // is_active in the same $transaction makes the guard classify ADMIN-BAN and block everything except
            // get-current/logout. The owner user id comes from the ownership chain (gallery_record -> created_by_account
            // -> created_by_user_id), the same one returned in the response.
            const ownerUserId =
              report.gallery_record.created_by_account?.created_by_user_id;
            if (ownerUserId != null) {
              // DECISION: the BAN flip of User is IDEMPOTENT: a guarded updateMany WHERE disabled_at:null (same CAS
              // as disableUser_IO / disableSelfUser_IO). BAN on an already disabled user (earlier admin disable, or
              // re-resolve) must not overwrite disabled_at: the first-disable timestamp is the idempotency SSOT, and
              // overwriting it re-evicted sessions on every repeat. The User row is already held FOR UPDATE (lockInOrder
              // at the start of the tx, before the StylistAccount), so there is no new deadlock surface. count===0
              // means already disabled, so sessions are NOT evicted again (follow-ups gated on an actual state change).
              const banned = await tx.user.updateMany({
                where: { id: ownerUserId, disabled_at: null },
                data: { is_active: false, disabled_at: new Date() },
              });
              if (banned.count > 0) {
                // Evict active sessions atomically with the ban (parity with
                // disableUser_IO, which deletes sessions in the same mutation) so the
                // banned user's existing tokens stop working immediately, not after
                // session TTL.
                await tx.session.deleteMany({ where: { userId: ownerUserId } });
              }
            }

            const banLikes = await tx.favoriteGalleryRecord.count({
              where: {
                record: {
                  created_by_account_id: accountId,
                  is_hidden: false,
                },
              },
            });
            const bulkHidden = await tx.galleryRecord.updateMany({
              where: { created_by_account_id: accountId, is_hidden: false },
              data: { is_hidden: true },
            });
            if (bulkHidden.count > 0) {
              // Floor-at-zero decrement (finding admin-state-cascade-l2-4).
              await decrementGalleryCountFloored(
                tx,
                accountId,
                bulkHidden.count
              );
              // cached_likes_count also counts likes of visible records; BAN hides them all, so their likes are
              // subtracted. un-ban does not re-increment (deliberate asymmetry, see the DECISION above).
              if (banLikes > 0) {
                await decrementLikeCountFloored(tx, accountId, banLikes);
              }
            }

            // 3. Resolve all pending reports targeting any record from this stylist
            await resolveRelatedReports('account');
          }
        }

        return success({
          report,
          status,
          effectiveAction,
        });
      },
      { retryOn: isDeadlockError }
    );

    if (!result.success) {
      return result;
    }

    const { report, status, effectiveAction } = result.data;

    if (action === ModerationAction.HIDE && report.gallery_record != null) {
      reportIssueBackend({
        namespace: 'MODERATION_RECORD_HIDDEN',
        message: `Gallery record ${report.gallery_record.gallery_record_id} hidden by admin moderation`,
        payload: { reportId: report_id, action },
        mode: 'info',
      });
    }

    if (action === ModerationAction.DELETE && report.gallery_record != null) {
      reportIssueBackend({
        namespace: 'MODERATION_RECORD_DELETED',
        message: `Gallery record ${report.gallery_record.gallery_record_id} deleted by admin moderation`,
        payload: { reportId: report_id, action },
        mode: 'info',
      });
    }

    if (action === ModerationAction.BAN && report.gallery_record != null) {
      reportIssueBackend({
        namespace: 'MODERATION_ACCOUNT_BANNED',
        message: `Stylist account ${report.gallery_record.created_by_account_id} banned and all records hidden by admin moderation`,
        payload: {
          reportId: report_id,
          action,
          accountId: report.gallery_record.created_by_account_id,
        },
        mode: 'warn',
      });
    }

    reportIssueBackend({
      namespace: 'MODERATION_REPORT_RESOLVED',
      message: `Report ${report_id} resolved with action ${effectiveAction} (requested ${action}) by admin ${resolved_by_id}`,
      payload: { reportId: report_id, action: effectiveAction, status },
      mode: 'info',
    });

    return success({
      report_id,
      status,
      action: effectiveAction,
      gallery_record_id: report.gallery_record_id,
      gallery_record_owner_user_id:
        report.gallery_record?.created_by_account?.created_by_user_id ?? null,
      gallery_record_owner_email:
        report.gallery_record?.created_by_account?.created_by_user?.email ??
        null,
    });
  } catch (error) {
    // DECISION: a deadlock that survives withWriteTx's retries is NOT mapped to CONTENT_REPORT_ALREADY_RESOLVED:
    // 40P01 means "Postgres aborted this attempt", not "someone else resolved it", and saying so would tell an
    // admin a report was handled when nothing was written. It is an opaque DATABASE_ERROR (logged); the admin
    // retries. A genuine concurrent win is detected by the post-lock status re-read inside the transaction.
    return databaseFailure('resolveContentReport', error);
  }
};
