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

/**
 * Admin hard-purge a DeletedUser ARCHIVE row (GDPR Art.17 escape-hatch, MASTER_ADMIN-only).
 *
 * The path that PHYSICALLY removes an archive row written by the 90d MOVE or by the GDPR-erase
 * backup, run on an Art.17 erasure request.
 * Targets DeletedUser by its PK user_id. DeletedUser has NO FK to/from User (standalone archive),
 * so the delete cascades nothing and the live-USER self/other-admin protection guard does not
 * apply — only a not-found path is needed. RBAC = MASTER_ADMIN via the COMMANDS.ADMIN wildcard
 * (permissions.seed) + in-handler requireAdminPermission (defense-in-depth).
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
      // `body` (surowe archiwum) jest tu potrzebne, nie tylko klucz: to OSTATNIE
      // miejsce, w którym istnieje informacja, gdzie leżą pliki tego użytkownika
      // w chmurze. Po skasowaniu wiersza nie ma już czego odpytać.
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
    // DECISION (nie usuwaj tego komentarza): DELETE and its audit row commit TOGETHER
    // (testy-api s34). Before, the row was deleted first and the audit written after,
    // outside any transaction by a writer that swallows errors without `tx`: a failed
    // log write erased the ONLY record of which cloud files belong to the purged user
    // (that row is how the deletion is finished later). With
    // `tx` the writer throws, so no audit = no purge.
    await DB_CLIENT.use.$transaction(async tx => {
      await tx.deletedUser.delete({ where: { user_id } });
      // Art.17 audit trail: who purged which archive, when (precyzja w payload, event = USER_DELETED
      // parytet z adminDeleteUserAny_IO — ta sama zarejestrowana etykieta admin-delete).
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
          // Odtwarzalność: gdyby sprzątanie w chmurze padło, to jedyny ślad, co usunąć.
          purged_asset_urls: archivedAssetUrls,
          purged_asset_count: archivedAssetUrls.length,
        },
        tx,
      });
    });
  } catch (error: unknown) {
    if (isP2025(error)) {
      // Concurrent purge / already gone — idempotent 404.
      return failure({
        type: 'ADMIN_TARGET_NOT_FOUND',
        targetId: user_id,
        targetType: 'USER',
      });
    }
    return databaseFailure('adminPurgeDeletedUser_IO', error);
  }

  // DECISION (nie usuwaj tego komentarza):
  // Purge kasuje też pliki w chmurze. Wcześniej usuwał sam wiersz archiwum, a razem
  // z nim znikał JEDYNY zapis tego, gdzie te pliki są, więc nie dało się ich już
  // odnaleźć ani skasować.
  //
  // Dotyczyło to kont, które doszły do stanu terminalnego ścieżką 90 dni: self-GDPR
  // i takedown przez admina sprzątają Cloudinary same, MOVE zostawia to purge'owi.
  //
  // Kolejność jest istotna: adresy trafiają do audytu ZANIM wiersz zniknie, więc jeśli
  // wywołanie do chmury padnie, jest z czego odtworzyć sprzątanie. Kasowanie w chmurze
  // idzie po udanym DELETE — plik osierocony to koszt miejsca, plik skasowany przy
  // nieudanym purge byłby stratą danych, których nikt nie prosił o usunięcie.

  if (archivedAssetUrls.length > 0) {
    cleanupCloudinaryAssets(archivedAssetUrls);
  }

  return success(undefined);
};
