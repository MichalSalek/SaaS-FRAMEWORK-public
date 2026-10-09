import { DB_CLIENT } from '@app/db/db.client';
import { isP2025 } from '@app/db/prisma-error';
import type { User } from '@kernel/models/db_models.generated.dto';
import { hasCode, narrowUser } from '@kernel/models/type_narrowing';
import type { UserWithRelations } from '@kernel/models/user/user.types';
import {
  userRelationsEnabler,
  userRelationsMinimal,
  userRelationsArchiveEnabler,
} from '@domain/user/user.config';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { UserNotFoundError } from '@kernel/domain/user-and-account/user-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { revokeImpersonationOnEviction } from '@domain/admin/impersonation-eviction';
import { decrementLikesForDeletedClient } from '@domain/favorites/operations/favorite-count.helper';
import { decrementBookmarksForDeletedClient } from '@domain/favorites/operations/bookmark-count.helper';
import { databaseFailure } from '@app/errors/error-result.helpers';

/**
 * CRUD Operations for User entity
 */

type GetUserProps = Partial<Pick<User, 'id'>> & Partial<Pick<User, 'email'>>;

export async function getUser_IO({
  props,
  withRelations,
}: {
  props: GetUserProps;
  withRelations: true;
}): Promise<null | UserWithRelations>;
export async function getUser_IO({
  props,
  withRelations,
}: {
  props: GetUserProps;
  withRelations: 'minimal';
}): Promise<null | UserWithRelations>;
export async function getUser_IO({
  props,
  withRelations,
}: {
  props: GetUserProps;
  withRelations?: false;
}): Promise<null | User>;
export async function getUser_IO({
  props,
  withRelations = false,
}: {
  props: GetUserProps;
  withRelations?: boolean | 'minimal';
}): Promise<null | User | UserWithRelations> {
  const include =
    withRelations === 'minimal'
      ? userRelationsMinimal
      : withRelations === true
        ? userRelationsEnabler
        : undefined;

  // Construct where clause with proper typing for Prisma
  const whereClause =
    props.id !== undefined
      ? { id: props.id }
      : props.email !== undefined
        ? { email: props.email }
        : { id: '' }; // Fallback that will return null

  const userRaw = await DB_CLIENT.use.user.findUnique({
    where: whereClause,
    ...(include && { include }),
  });

  if (!userRaw) {
    return null;
  }

  const context = `getUser_IO(id: ${props.id}, email: ${props.email})`;
  if (withRelations !== false) {
    return narrowUser<UserWithRelations>(userRaw, context);
  }

  return narrowUser<User>(userRaw, context);
}

/**
 * Delete user (with backup to deleted_user table)
 */
export const deleteUser_IO = async ({
  id,
}: {
  id: User['id'];
}): Promise<
  OperationResult<UserWithRelations, UserNotFoundError | DatabaseError>
> => {
  if (!id) {
    return failure({ type: 'USER_NOT_FOUND', userId: id });
  }

  // Deep query for backup — COMPLETE raw snapshot (userRelationsArchiveEnabler: konto + karta
  // klientki + wszystkie cascade satelity), by DeletedUser.body było samowystarczalne przed cascade.
  // DECISION (nie usuwaj tego komentarza):
  // BOUNDED TOCTOU (świadomie odłożone, pre-launch): snapshot jest czytany TU, poza transakcją, a
  // user.delete zachodzi niżej W tx. W wąskim oknie między snapshotem a delete współbieżny writer
  // (np. dodanie VisitRecord/VisitResultPhoto/pary do usuwanego konta) mógłby dodać wiersze, które
  // cascade skasuje, a których snapshot już nie ma → luka w archiwum. Pełne domknięcie = snapshot +
  // upsert + delete w JEDNEJ tx z pesymistycznym lockiem parentów (users/StylistAccount/ClientAccount)
  // po OBU stronach (writer karty też musiałby lockować) LUB Serializable+retry. Świadomie DEFERRED:
  // (a) terminal-delete + równoczesny zapis do TEGO konta jest praktycznie niemożliwy pre-launch
  // (usuwasz konto, którego nikt jednocześnie nie edytuje), (b) wzorzec współdzielony z
  // moveExpiredUserToArchive_IO — zmiana obu w delete-path = ryzyko regresji > wartość teraz.
  // Follow-up gdy wolumen wzrośnie: przenieść snapshot do tx + lock/Serializable.
  const userForBackup = await DB_CLIENT.use.user.findUnique({
    where: { id },
    include: userRelationsArchiveEnabler,
  });
  if (!userForBackup) {
    return failure({ type: 'USER_NOT_FOUND', userId: id });
  }

  // Backup + delete in a transaction for atomicity.
  // DECISION (nie usuwaj tego komentarza):
  // findUnique-then-delete jest check-then-act (TOCTOU) — przegrany wyścig dwóch
  // równoległych delete'ów tego samego usera (np. dwie sesje wołające GDPR-erase)
  // trafia na P2025 z tx.user.delete (rekord już skasowany przez zwycięzcę).
  // Mapujemy P2025 → USER_NOT_FOUND (spójnie z softDeleteAccount_IO L128-129 i
  // updateNotificationPreferences_IO) zamiast pozwolić mu przejść jako unmapped
  // throw → 500 GENERAL_ERROR. To prymityw hard-delete współdzielony przez self /
  // other / admin path, więc fix tutaj hartuje WSZYSTKIE ścieżki naraz. Z punktu
  // widzenia przegranego rekord faktycznie już nie istnieje → 404 to prawdziwa,
  // idempotentna semantyka usuwania (zwycięzca zrobił erasure; DB end-state poprawny:
  // 1 backup, user-row usunięty). LEGIT pojedynczy delete: niezmieniony (success).
  let deletedUserResult;
  try {
    deletedUserResult = await DB_CLIENT.use.$transaction(async tx => {
      // Normalize via JSON round-trip so Prisma 7 TaggedDateTime ({$type, value}) becomes plain ISO string
      const normalizedBody = JSON.parse(
        JSON.stringify(userForBackup)
      ) as object;

      // DECISION (nie usuwaj tego komentarza):
      // SELF-PROTECTING TERMINAL ARCHIVE. Ten prymityw obsługuje
      // WYŁĄCZNIE terminal hard-delete na żądanie (self-GDPR + admin-takedown) — oba są nieodwracalne.
      // Zapisujemy pełne body konta do DeletedUser i USTAWIAMY
      // is_gdpr_erased=true W TEJ SAMEJ tx co user.delete. To czyni backup non-restorable OD RAZU
      // (loadRecentRecoverableBackups filtruje is_gdpr_erased:{not:true}), zamykając dawną dziurę:
      // wcześniej prymityw zostawiał RESTORABLE backup i liczył na to, że KAŻDY caller ręcznie zawoła
      // finalizeGdprErasureBackup_IO — nowy caller, który zapomniał, produkował cicho odwracalną
      // "erasure" (QA user-lifecycle-3). Teraz bezpieczeństwo jest w prymitywie, nie w callerze.
      // is_gdpr_erased = marker "terminal-delete na żądanie" (non-restorable); is_move_archive =
      // "terminal po 90d MOVE". Oba non-restorable, różni je tylko trigger (audit). Wiersz archiwum
      // usuwa admin hard-purge DeletedUser (Art.17).
      // Ten prymityw sam nie czyści plików u vendora (asset_url zostaje w body): robią to jego
      // callerzy oraz purge (patrz moveExpiredUserToArchive_IO).
      // user.delete zwalnia email (re-rejestracja czysta = anti-enumeracja).
      await tx.deletedUser.upsert({
        where: { user_id: id },
        update: {
          body: normalizedBody,
          email: userForBackup.email,
          is_gdpr_erased: true,
        },
        create: {
          user_id: id,
          body: normalizedBody,
          email: userForBackup.email,
          is_gdpr_erased: true,
        },
      });

      // DECISION (nie usuwaj tego komentarza):
      // TARGET-SIDE IMPERSONATION-BACKUP CLEANUP (connected-dots of softdelete-gdpr-cascade-2).
      // ImpersonationBackup has NO User FK, so neither the User-FK cascade nor
      // revokeImpersonationOnEviction(id) — keyed on admin_user_id (the ADMIN side) — reaches
      // backup rows where this user was the IMPERSONATED target. Hard-deleting a target would
      // otherwise orphan its backup rows (impersonated_user_id = a now-nonexistent user) forever.
      // We clear them in the SAME tx as user.delete for atomicity (the user-row and its dangling
      // target-backups vanish together). deleteMany is idempotent (count 0 when none). Admin-side
      // teardown of the orphaned impersonated Session stays in revokeImpersonationOnEviction below
      // (it needs the backup's session token, which lives on the admin_user_id-keyed row).
      await tx.impersonationBackup.deleteMany({
        where: { impersonated_user_id: id },
      });

      // CLIENT HARD-DELETE CASCADE drift fix (finding spar/user-cascade): FavoriteGalleryRecord
      // .client_user_id has onDelete:Cascade, so the tx.user.delete below removes this client's
      // likes at the DB level WITHOUT routing through the cached_likes_count write-path. Decrement
      // every affected stylist's counter (visible likes only) in the SAME tx, BEFORE the delete —
      // afterwards the FavoriteGalleryRecord rows are already gone. Dual-role safe (floor + WHERE).
      await decrementLikesForDeletedClient(tx, id);
      // Bookmark sibling (CWT-1): FavoriteStylist.client_user_id onDelete:Cascade ALSO bypasses the
      // cached_bookmark_count write-path — decrement affected stylists in the SAME tx, BEFORE delete
      // (likes had this fix, bookmark was missed). Raw row count (no is_hidden predicate for bookmarks).
      await decrementBookmarksForDeletedClient(tx, id);

      return tx.user.delete({
        where: { id },
        include: userRelationsEnabler,
      });
    });
  } catch (error: unknown) {
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId: id });
    }
    // DECISION (nie usuwaj tego komentarza):
    // P2003 DEFENSIVE MAP (belt-and-suspenders for softdelete-gdpr-cascade-1 / fk-ondelete-policies-1).
    // A FK with onDelete: Restrict still pointing at User (e.g. RuntimeConfig.updated_by_user_id)
    // makes tx.user.delete throw P2003 (foreign key constraint). The PROPER fix is at the DB layer
    // (flip those FKs to SetNull in schema.prisma — owned by a separate change); once that lands this
    // branch becomes unreachable for those columns. Until then we map P2003 → DATABASE_ERROR (opaque
    // 500 to the client, full operation+cause logged server-side via databaseFailure) instead of
    // rethrowing into an unmapped 500 GENERAL_ERROR. We do NOT reassign RuntimeConfig rows here —
    // SetNull resolves that at the DB and reassignment is out of this primitive's scope.
    if (hasCode(error) && error.code === 'P2003') {
      return databaseFailure('deleteUser_IO', error);
    }
    throw error;
  }

  const narrowed = narrowUser<UserWithRelations>(
    deletedUserResult,
    `deleteUser_IO(id: ${id})`
  );

  if (!narrowed) {
    return failure({ type: 'USER_NOT_FOUND', userId: id });
  }

  // Eviction cleanup: if the (now hard-deleted) user was a mid-impersonation admin,
  // tear down the orphaned impersonated session + backup (connected-dots of impersonation-l2-7).
  await revokeImpersonationOnEviction(id);

  return success(narrowed);
};
