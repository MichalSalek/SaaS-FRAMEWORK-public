import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { getUser_IO } from '@domain/user/operations/user-crud.operations';
import type { IDType } from '@kernel/application/application.types';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import { PERMISSIONS_POLICY } from '@kernel/policies/permissions.policy';
import type {
  AdminTargetNotFoundError,
  AdminTargetProtectedError,
} from '@kernel/domain/admin/admin-errors.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type { UserWithRelations } from '@kernel/models/user/user.types';
import type { Session } from '@kernel/models/db_models.generated.dto';

/**
 * Reject an expired admin return-session (backup_session_token). Shared by
 * adminRefreshImpersonation_IO and adminSwitchBackToSelf_IO so the "don't prolong /
 * don't return an unreturnable impersonation" rule + its client-facing message live
 * in one place (DD2-M5 r28). Callers that must also tear down state (switch-back's
 * cleanup) run it around this check.
 */
export const requireAdminSessionNotExpired = (
  session: Session
): OperationResult<void, ValidationError> =>
  session.expires.getTime() < Date.now()
    ? failure({
        type: 'VALIDATION_ERROR',
        field: 'backupHeader',
        message: 'Original admin session expired during impersonation',
      })
    : success(undefined);

/**
 * Cohesive pre-session resolution + guards for adminBecomeUser_IO. Keeps the
 * (heavily commented) rejection rationale out of the operation flow while
 * preserving the EXACT order, conditions and returned errors:
 *   (1) self-become reject (QA admin-impersonation-2, part a),
 *   (2) no nested impersonation — caller already on an impersonated session
 *       (QA admin-impersonation-1, part b),
 *   (3) resolve the target user (ADMIN_TARGET_NOT_FOUND if absent),
 *   (4) no admin-on-admin impersonation (QA admin-impersonation-1, part a).
 * On success returns the validated target (UserWithRelations), so the operation
 * can proceed straight to minting the impersonated session.
 */
export const resolveBecomeUserTarget_IO = async ({
  callerId,
  targetId,
  sessionToken,
}: {
  callerId: IDType;
  targetId: IDType;
  sessionToken: string;
}): Promise<
  OperationResult<
    UserWithRelations,
    AdminTargetNotFoundError | AdminTargetProtectedError | DatabaseError
  >
> => {
  // DECISION: an admin must not impersonate themselves. After become-self the impersonated
  // caller id equals backup.admin_user_id, which collides with the redeem caller binding and
  // leaves the admin unable to switch back. Rejected on entry (no half-created session) with
  // ADMIN_TARGET_NOT_FOUND, the union's only "rejected target" error, which also does not
  // confirm the id was the caller's own. The UI already hides this; this closes the raw API.
  if (targetId === callerId) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId,
      targetType: 'USER',
    });
  }

  // DECISION: no nested impersonation. When the caller's session token is some backup row's
  // `impersonated_session_token`, the caller identity is the impersonated one, so a nested
  // become-user would upsert the backup keyed by that impersonated admin's id (tearing down
  // their own live impersonation) and misattribute the audit row. Checked against the DB column,
  // never the header, and BEFORE the target fetch so it surfaces as 403 ADMIN_TARGET_PROTECTED.
  let callerOnImpersonatedSession;
  try {
    callerOnImpersonatedSession =
      await DB_CLIENT.use.impersonationBackup.findFirst({
        where: { impersonated_session_token: sessionToken },
        select: { ref_id: true },
      });
  } catch (error) {
    return databaseFailure('resolveBecomeUserTarget:nestedCheck', error);
  }
  if (callerOnImpersonatedSession) {
    return failure({
      type: 'ADMIN_TARGET_PROTECTED',
      reason: 'ADMIN_CANNOT_TARGET_ADMIN',
    });
  }

  // Get user to become
  let userToBecome;
  try {
    userToBecome = await getUser_IO({
      props: { id: targetId },
      withRelations: true,
    });
  } catch (error) {
    return databaseFailure('resolveBecomeUserTarget:targetFetch', error);
  }
  if (!userToBecome) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId,
      targetType: 'USER',
    });
  }

  // DECISION: no admin-on-admin impersonation. The impersonated session inherits the target's
  // RBAC, so impersonating an admin yields a full master-admin session (the path that makes nested
  // become-user reachable). Same actor-on-actor rule as requireTargetNotProtected
  // (admin.guards.ts) for disable/delete; maps to 403 ADMIN_TARGET_PROTECTED.
  if (PERMISSIONS_POLICY.utils.IS_ADMIN({ user: userToBecome })) {
    return failure({
      type: 'ADMIN_TARGET_PROTECTED',
      reason: 'ADMIN_CANNOT_TARGET_ADMIN',
    });
  }

  return success(userToBecome);
};
