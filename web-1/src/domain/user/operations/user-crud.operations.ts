import { failedEmailRecipientForUser } from '@app/email-handler/outbox/email-outbox.policy';
import { DB_CLIENT } from '@app/db/db.client';
import { withWriteTx } from '@app/db/with-write-tx';
import { lockUserRow } from '@app/db/lock-rows';
import { isDeadlock, isP2025 } from '@app/db/prisma-error';
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
  // DECISION: BOUNDED TOCTOU, deliberately deferred (pre-launch). The snapshot is read HERE, outside the
  // transaction, and user.delete runs below IN the tx. A concurrent writer in that window (a new
  // VisitRecord/VisitResultPhoto/pair on the account being deleted) could add rows the cascade deletes but
  // the snapshot lacks. Closing it = snapshot + upsert + delete in ONE tx with a pessimistic lock on the
  // parents on both sides, or Serializable + retry. Deferred because a terminal delete with a simultaneous
  // write to the same account is practically impossible pre-launch, and moveExpiredUserToArchive_IO shares
  // the pattern (changing both risks regression). Revisit when volume grows.
  const userForBackup = await DB_CLIENT.use.user.findUnique({
    where: { id },
    include: userRelationsArchiveEnabler,
  });
  if (!userForBackup) {
    return failure({ type: 'USER_NOT_FOUND', userId: id });
  }

  let deletedUserResult;
  try {
    deletedUserResult = await withWriteTx(
      async tx => {
        await lockUserRow(tx, id);
        // Normalize via JSON round-trip so Prisma 7 TaggedDateTime ({$type, value}) becomes plain ISO string
        const normalizedBody = JSON.parse(
          JSON.stringify(userForBackup)
        ) as object;

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

        await tx.impersonationBackup.deleteMany({
          where: { impersonated_user_id: id },
        });

        // Dead-lettered mail has no User FK: rows keyed by this address (direct sends) or by the user
        // id (email outbox) would keep the person's data after the erasure.
        await tx.failedEmail.deleteMany({
          where: {
            recipient: {
              in: [userForBackup.email, failedEmailRecipientForUser(id)],
            },
          },
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
      },
      { retryOn: isDeadlock }
    );
  } catch (error: unknown) {
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId: id });
    }
    // DECISION: defensive P2003 map. Any FK with onDelete: Restrict still pointing at User makes
    // tx.user.delete throw P2003. The proper fix is at the DB layer (SetNull in schema.prisma); until every
    // such FK is flipped, map P2003 -> DATABASE_ERROR (opaque 500, cause logged via databaseFailure)
    // instead of an unmapped GENERAL_ERROR. Rows are not reassigned here.
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
