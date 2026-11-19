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
 * DECISION: single-user admin ops need the same protection bulk ops get from filterAdminUsers
 * (admin-bulk.operations.ts): no targeting yourself (losing the only admin = lockout) and no
 * targeting a MASTER_ADMIN (cross-admin attack). Run it AFTER the permission check. It lives here,
 * not in operations/, because SESSION_DELETE_ALL uses it too (same actor-on-actor class).
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
