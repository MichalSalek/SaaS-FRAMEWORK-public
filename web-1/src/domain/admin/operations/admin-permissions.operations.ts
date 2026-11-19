import { DB_CLIENT } from '@app/db/db.client';
import { QUERY_LIMITS } from '@kernel/domain/admin/admin.config';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AdminInsufficientPermissionsError,
  AdminSystemRoleImmutableError,
  AdminTargetNotFoundError,
} from '@kernel/domain/admin/admin-errors.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { hasCode } from '@kernel/models/type_narrowing';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';

/**
 * Get all roles with their permissions + all available permissions
 */
export const getAllPermissions_IO = async ({
  currentUser,
}: {
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    { roles: unknown[]; allPermissions: unknown[] },
    AdminInsufficientPermissionsError | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }
  try {
    // DD3-F2: include → select to drop unused columns (created_at, etc.) from RolePermission join + Permission rows.
    // Shape matches ADMIN_DTO_API_V1['ADMIN_GET_PERMISSIONS']['RESPONSE'] exactly.
    const roles = await DB_CLIENT.use.role.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        is_system: true,
        permissions: {
          select: {
            permission_id: true,
            permission: {
              select: {
                id: true,
                event_name: true,
                category: true,
              },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
      take: 200,
    });

    // The event registry exceeds a single admin page. Read bounded batches rather
    // than silently truncating the matrix; every permission remains searchable.
    const allPermissions: Array<{
      id: string;
      event_name: string;
      category: string;
      description: string | null;
      is_system: boolean;
    }> = [];
    let cursor: string | undefined;
    while (true) {
      const batch = await DB_CLIENT.use.permission.findMany({
        select: {
          id: true,
          event_name: true,
          category: true,
          description: true,
          is_system: true,
        },
        orderBy: { id: 'asc' },
        take: QUERY_LIMITS.ADMIN_LIST_DEFAULT,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      allPermissions.push(...batch);
      if (batch.length < QUERY_LIMITS.ADMIN_LIST_DEFAULT) {
        break;
      }
      cursor = batch.at(-1)?.id;
    }
    allPermissions.sort(
      (a, b) =>
        a.category.localeCompare(b.category) ||
        a.event_name.localeCompare(b.event_name)
    );

    return success({ roles, allPermissions });
  } catch (error) {
    return databaseFailure('getAllPermissions', error);
  }
};

/**
 * Update role permissions (transactional: delete all + recreate)
 */
export const updateRolePermissions_IO = async ({
  roleId,
  permissionIds,
  currentUser,
}: {
  roleId: string;
  permissionIds: string[];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    undefined,
    | AdminInsufficientPermissionsError
    | AdminSystemRoleImmutableError
    | AdminTargetNotFoundError
    | ValidationError
    | DatabaseError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  // DECISION: every system role (is_system=true: MASTER_ADMIN, STYLIST_ROLE, CLIENT_ROLE,
  // NOT_LOGGED_IN) is immutable from the admin panel. permissions.cache.ts resolves their sets from
  // config (PERMISSION_SETS_BY_ROLE) and ignores DB rows, so an edit would be a runtime no-op with a
  // misleading audit diff, and a lockout trap if the cache ever fell back to the DB. The guard keys on
  // is_system (not on one roleId) and runs after the existence check so a missing role stays a 404.

  // Capture before-state for audit (role + is_system + previous permissions)
  let beforeRole;
  try {
    beforeRole = await DB_CLIENT.use.role.findUnique({
      where: { id: roleId },
      select: {
        id: true,
        name: true,
        is_system: true,
        permissions: { select: { permission_id: true } },
      },
    });
  } catch (error) {
    return databaseFailure('updateRolePermissions', error);
  }

  // Non-existent role_id: the createMany below would throw a P2003 FK error
  // (role_id → Role) and surface as a generic 500. Detect it up front and return
  // a precise 404 instead. (deleteMany on a missing role is a silent no-op, so
  // without this guard a bad role_id with an empty permission set would even
  // "succeed".)
  if (!beforeRole) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId: roleId,
      targetType: 'RECORD',
    });
  }

  // System roles are config-defined and immutable from the DB — see DECISION above.
  // Reject the write before any deleteMany/createMany so the DB never diverges from
  // the config SSOT and no misleading audit diff is recorded.
  if (beforeRole.is_system) {
    return failure({
      type: 'ADMIN_SYSTEM_ROLE_IMMUTABLE',
      roleId,
    });
  }

  const beforePermissionIds = beforeRole.permissions.map(p => p.permission_id);

  // DECISION: role permissions are a set. Duplicate ids in the payload are collapsed instead of
  // rejected; created verbatim they hit @@unique([role_id, permission_id]) (P2002) and became a 500.
  const uniquePermissionIds = Array.from(new Set(permissionIds));

  try {
    await DB_CLIENT.use.$transaction(async tx => {
      await tx.rolePermission.deleteMany({ where: { role_id: roleId } });
      if (uniquePermissionIds.length > 0) {
        await tx.rolePermission.createMany({
          data: uniquePermissionIds.map(permission_id => ({
            role_id: roleId,
            permission_id,
          })),
        });
      }
    });
  } catch (error) {
    // P2003 here = a permission_id in the payload references a non-existent
    // Permission row (role_id existence already verified above). That is bad
    // caller input, not a server fault → 400, not 500.
    if (hasCode(error) && error.code === 'P2003') {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'permission_ids',
        message: 'One or more permission ids do not exist',
      });
    }
    return databaseFailure('updateRolePermissions', error);
  }

  // RBAC change is the highest-stake admin op: the audit row keeps full before/after id arrays plus
  // the diff so a wrong grant can be reconstructed and rolled back.
  const beforeSet = new Set(beforePermissionIds);
  const afterSet = new Set(uniquePermissionIds);
  const added = uniquePermissionIds.filter(id => !beforeSet.has(id));
  const removed = beforePermissionIds.filter(id => !afterSet.has(id));

  await writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.ADMIN.ADMIN_PERMISSIONS_UPDATED,
    eventLogType: EventLogTypeValue.ADMIN,
    meta: {
      created_by_user_id: currentUser.id,
    },
    eventPayloadToStringify: {
      role_id: roleId,
      role_name: beforeRole?.name ?? null,
      before_permission_ids: beforePermissionIds,
      after_permission_ids: uniquePermissionIds,
      added_permission_ids: added,
      removed_permission_ids: removed,
    },
  });

  return success(undefined);
};
