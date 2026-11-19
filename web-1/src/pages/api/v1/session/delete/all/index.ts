import { defineEndpoint } from '@app/http/define-endpoint';
import { SESSION_CONTRACTS } from '@kernel/domain/session/session.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { deleteAllSessionsOfUser_IO } from '@domain/user/operations/user-session.operations';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import {
  respondForbidden,
  respondSuccess,
} from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { requireTargetNotProtected } from '@domain/admin/admin.guards';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
export default defineEndpoint(SESSION_CONTRACTS.SESSION_DELETE_ALL, {
  handle: async ({ input: body, ctx, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // If body.id is provided, only MASTER_ADMIN may target another user's sessions
    if (
      typeof body.id !== 'undefined' &&
      body.id !== currentUser.id &&
      currentUser.role_id !== SystemRoleId.MASTER_ADMIN
    ) {
      reportIssueBackend({
        namespace: 'SESSION_DELETE_ALL',
        message: `Non-admin attempted to delete sessions for another user: ${body.id}`,
        payload: { requester: currentUser.id, target: body.id },
        mode: 'error',
      });
      return respondForbidden(
        res,
        { requiredRole: 'MASTER_ADMIN', currentRole: currentUser.role_id },
        APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED
      );
    }

    const isMasterAdminTargetingSpecificUser =
      currentUser.role_id === SystemRoleId.MASTER_ADMIN &&
      typeof body.id !== 'undefined';

    // DECISION: an admin logging out ANOTHER user's sessions goes through the same target protection as
    // USER_DISABLE_ANY / USER_DELETE_ANY (requireTargetNotProtected): another admin => 403
    // ADMIN_TARGET_PROTECTED / ADMIN_CANNOT_TARGET_ADMIN. Without it one admin could log another out of
    // every device although disabling that same target is blocked. The caller's own id
    // (body.id === currentUser.id) is a plain "log me out everywhere", so the guard (which also rejects
    // self) does not apply to it.
    if (
      isMasterAdminTargetingSpecificUser &&
      typeof body.id === 'string' &&
      body.id !== currentUser.id
    ) {
      const protectionCheck = await requireTargetNotProtected({
        targetUserId: body.id,
        currentUserId: currentUser.id,
      });
      if (!protectionCheck.success) {
        return mapErrorToResponse(res, protectionCheck.error);
      }
    }

    const userIDToDeleteAllSessions: string =
      isMasterAdminTargetingSpecificUser && typeof body.id === 'string'
        ? body.id
        : currentUser.id;

    const deleteResult = await deleteAllSessionsOfUser_IO({
      id: userIDToDeleteAllSessions,
    });

    if (!deleteResult.success) {
      return mapErrorToResponse(res, deleteResult.error);
    }

    reportIssueBackend({
      namespace: 'SESSION_DELETE_ALL',
      message: `Deleted all sessions for user ${userIDToDeleteAllSessions}`,
      payload: {
        id: userIDToDeleteAllSessions,
        is_master_admin: isMasterAdminTargetingSpecificUser,
        deletedCount: deleteResult.data.deletedCount,
      },
      mode: 'info',
    });

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_LOGGED_OUT,
        user: currentUser,
        requestBody: body,
      })
    );

    // DECISION: see .shared-kernel/domain/events/app-events.const.ts (ADMIN_USER_SESSIONS_REVOKED).
    // Only "log ME out everywhere" answers USER_LOGGED_OUT, which ends the caller's own session.
    if (userIDToDeleteAllSessions !== currentUser.id) {
      return respondSuccess(
        res,
        undefined,
        APP_EVENTS.INFO.ADMIN.ADMIN_USER_SESSIONS_REVOKED
      );
    }
    respondSuccess(res, undefined, APP_EVENTS.INFO.USER.USER_LOGGED_OUT);
  },
});
