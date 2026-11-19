import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import type { IDType } from '@kernel/application/application.types';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { isP2025 } from '@app/db/prisma-error';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AdminInsufficientPermissionsError,
  AdminTargetNotFoundError,
} from '@kernel/domain/admin/admin-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { cleanupCloudinaryAssets } from '@domain/gallery/operations/gallery-cloudinary-cleanup';
import { collectArchivedAssetUrls } from './archived-assets.helper';

/**
 * Admin operations on the DeletedUser ARCHIVE. Kept separate from
 * admin-user-management.operations.ts (which targets live Users) — the archive is a
 * standalone table with no FK to/from User.
 */

export const adminPurgeDeletedUser_IO = async ({
  user_id,
  currentUser,
}: {
  user_id: IDType;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    void,
    AdminInsufficientPermissionsError | AdminTargetNotFoundError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  let archived;
  try {
    archived = await DB_CLIENT.use.deletedUser.findUnique({
      where: { user_id },
      // `body` (the raw archive) is needed here, not only the key: it is the LAST place that
      // records where this user's cloud files live. Once the row is deleted there is nothing
      // left to query.
      select: { user_id: true, body: true },
    });
  } catch (error) {
    return databaseFailure('adminPurgeDeletedUser_IO', error);
  }
  if (!archived) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: user_id,
      targetType: 'USER',
    });
  }

  const archivedAssetUrls = collectArchivedAssetUrls(archived.body);

  try {
    // DECISION: the DELETE and its audit row commit in one transaction. The audit row is the only
    // record of which cloud files belonged to the purged user (needed to redo a failed cleanup);
    // without `tx` the writer swallows errors, so a lost log write would erase it. With `tx` it
    // throws: no audit, no purge.
    await DB_CLIENT.use.$transaction(async tx => {
      await tx.deletedUser.delete({ where: { user_id } });
      // Art.17 audit trail: who purged which archive, when (detail in the payload; event =
      // USER_DELETED, parity with adminDeleteUserAny_IO: the same registered admin-delete label).
      await writeRawEventLog_IO({
        eventName: APP_EVENTS.INFO.USER.USER_DELETED,
        eventLogType: EventLogTypeValue.ADMIN,
        meta: {
          created_by_user_id: currentUser.id,
        },
        eventPayloadToStringify: {
          purged_deleted_user_id: user_id,
          art17_hard_purge: true,
          purged_at: new Date(),
          // Recoverability: if the cloud cleanup fails, this is the only trace of what to delete.
          purged_asset_urls: archivedAssetUrls,
          purged_asset_count: archivedAssetUrls.length,
        },
        tx,
      });
    });
  } catch (error: unknown) {
    if (isP2025(error)) {
      // Concurrent purge / already gone: 404.
      // Test: web-1/src/domain/admin/operations/admin-deleted-user.operations.test.ts (covers P2025 on delete -> 404 and no audit row; not a real concurrent race)
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: user_id,
        targetType: 'USER',
      });
    }
    return databaseFailure('adminPurgeDeletedUser_IO', error);
  }

  // DECISION: the purge also deletes the user's Cloudinary files. Before, it removed only the archive
  // row, and with it the ONLY record of where those files are, so they could no longer be found or
  // deleted. Order matters: the URLs are in the audit row before the archive row goes, and cloud
  // deletion runs only after a successful DELETE (an orphaned file costs storage; a file deleted on a
  // failed purge would be data loss nobody asked for).

  if (archivedAssetUrls.length > 0) {
    cleanupCloudinaryAssets(archivedAssetUrls);
  }

  return success(undefined);
};
