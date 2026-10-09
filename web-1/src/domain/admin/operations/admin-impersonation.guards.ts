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
  // DECISION (nie usuwaj tego komentarza):
  // SELF-BECOME GUARD (QA admin-impersonation-2, part a): an admin must NOT
  // impersonate themselves. Backend guard here (not in the kernel validator,
  // per become-user/index.ts "gate tutaj w handlerze"). Without it, after
  // become-self the impersonated caller.id === backup.admin_user_id, which
  // collides with the redeem caller-binding and leaves the admin unable to
  // switch back (state-trap). The product UI already blocks this
  // (UserDetailsDialog `user.id !== currentUser.id`); this closes the raw-API
  // completeness hole. Rejecting on entry is the safest of the two options
  // (block-on-entry vs always-allow-switch-back) — no half-created session.
  // Reject the self-target via ADMIN_TARGET_NOT_FOUND — the same error
  // become-user already returns for an invalid/unresolvable target (below). It
  // is the only "rejected target" variant in the BecomeUserResponse union, and
  // masking self-impersonation as "not a valid target" also avoids confirming
  // to the caller that the id was their own (no extra info leak).
  if (targetId === callerId) {
    return failure({
      type: 'ADMIN_TARGET_NOT_FOUND',
      targetId,
      targetType: 'USER',
    });
  }

  // DECISION (nie usuwaj tego komentarza):
  // NO NESTED IMPERSONATION (QA admin-impersonation-1, part b). Reject become-user
  // when the CALLER is already on an impersonated session — i.e. the current
  // session token is the `impersonated_session_token` of some live backup row.
  // The admin operates THROUGH the impersonated session (their own token is never
  // returned to the client, D23), so caller id/session token belong to the
  // IMPERSONATED identity, not the real admin. A nested become-user would
  // (1) upsert the backup keyed @unique(admin_user_id = the impersonated admin's id),
  // clobbering THAT admin's own live backup + tearing down their impersonated session
  // (cross-admin DoS via issueImpersonationBackup prior-session teardown), and
  // (2) write the USER_BECAME_SOMEONE_ELSE audit row with created_by_user_id =
  // the impersonated admin, misattributing the real actor. The session must be
  // unwound (switch-back) before starting a new impersonation. Checked against the
  // DB column (server-side), never the header. MUST run before the target fetch so
  // a caller-on-impersonated-session is rejected as PROTECTED, not masked by a
  // later NOT_FOUND. Maps to 403 ADMIN_TARGET_PROTECTED.
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

  // DECISION (nie usuwaj tego komentarza):
  // NO ADMIN-ON-ADMIN IMPERSONATION (QA admin-impersonation-1, part a). An admin
  // must NOT impersonate another admin. The impersonated session inherits the
  // target's RBAC, so impersonating an admin yields a full master-admin session —
  // the very thing that makes the nested become-user (part b) reachable. Blocking
  // it at the source removes that escalation path AND keeps one admin from ever
  // sitting on another admin's account. Mirrors `requireTargetNotProtected` in
  // admin-user-management.operations.ts (disable/delete already reject admin
  // targets via ADMIN_TARGET_PROTECTED/ADMIN_CANNOT_TARGET_ADMIN) — become-user
  // is the same actor-on-actor class and was the one admin op missing the guard.
  // Checked on the already-fetched target (IS_ADMIN reads role_id only) — no
  // extra DB read. Maps to 403 ADMIN_TARGET_PROTECTED.
  if (PERMISSIONS_POLICY.utils.IS_ADMIN({ user: userToBecome })) {
    return failure({
      type: 'ADMIN_TARGET_PROTECTED',
      reason: 'ADMIN_CANNOT_TARGET_ADMIN',
    });
  }

  return success(userToBecome);
};
