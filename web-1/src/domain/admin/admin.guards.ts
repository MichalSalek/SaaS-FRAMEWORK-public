import type {
  AdminInsufficientPermissionsError,
  AdminTargetProtectedError,
} from '@kernel/domain/admin/admin-errors.types';
import type { IDType } from '@kernel/application/application.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import { PERMISSIONS_POLICY } from '@kernel/policies/permissions.policy';
import {
  SystemRoleId,
  type SystemRoleIdType,
} from '@kernel/models/db_models.manual.dto';
import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';

export const requireAdminPermission = (
  user: { role_id: SystemRoleIdType } | null | undefined
): OperationResult<void, AdminInsufficientPermissionsError> => {
  if (!user || !PERMISSIONS_POLICY.utils.IS_ADMIN({ user })) {
    return failure({
      type: 'ADMIN_INSUFFICIENT_PERMISSIONS',
      requiredRole: 'ADMIN',
      currentRole: 'NON_ADMIN',
    });
  }
  return success(undefined);
};

/**
 * Self / cross-admin guard for single-user admin operations.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Bulk operations używają `filterAdminUsers` w admin-bulk.operations.ts — single-user
 * ops potrzebują równoważnej ochrony, inaczej admin może:
 *   1) Self-delete / self-disable → utrata jedynego admina = lockout
 *   2) Eskalacja konfliktu: admin A może wyłączyć / usunąć admina B (cross-admin attack)
 * Sprawdzamy targetId === currentUser.id ORAZ targetUser.role_id === MASTER_ADMIN.
 * Permission check (requireAdminPermission) MUSI być wcześniej — pattern parity z
 * filterAdminUsers, który pomija ochronę tylko gdy caller jest admin (już sprawdzony).
 * Mieszka tu (nie w operations/), bo korzysta z niego też SESSION_DELETE_ALL: admin
 * wylogowujący cudze sesje to ta sama klasa actor-on-actor co disable/delete.
 */
export const requireTargetNotProtected = async ({
  targetUserId,
  currentUserId,
}: {
  targetUserId: IDType;
  currentUserId: IDType;
}): Promise<
  OperationResult<void, AdminTargetProtectedError | DatabaseError>
> => {
  if (targetUserId === currentUserId) {
    return failure({
      type: 'ADMIN_TARGET_PROTECTED',
      reason: 'ADMIN_CANNOT_TARGET_SELF',
    });
  }
  let targetUser;
  try {
    targetUser = await DB_CLIENT.use.user.findUnique({
      where: { id: targetUserId },
      select: { role_id: true },
    });
  } catch (error) {
    return databaseFailure('requireTargetNotProtected', error);
  }
  if (targetUser?.role_id === SystemRoleId.MASTER_ADMIN) {
    return failure({
      type: 'ADMIN_TARGET_PROTECTED',
      reason: 'ADMIN_CANNOT_TARGET_ADMIN',
    });
  }
  return success(undefined);
};
