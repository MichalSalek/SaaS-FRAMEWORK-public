import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { deleteAllSessionsOfUser_IO } from '@domain/user/operations/user-session.operations';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import {
  respondForbidden,
  respondSuccess,
  respondValidationFailed,
} from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { requireTargetNotProtected } from '@domain/admin/admin.guards';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';
import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';
export default defineHandler<
  SESSION_DTO_API_V1['SESSION_DELETE_ALL']['REQUEST'],
  SESSION_DTO_API_V1['SESSION_DELETE_ALL']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SESSION.SESSION_DELETE_ALL,
  method: 'post',
  // DECISION (nie usuwaj tego komentarza):
  // validationFunction MUSI zostać literalnym no-op `() => ({ __isValid: true })`,
  // bo audyt validation-coverage.sh rozpoznaje jako poprawne TYLKO
  // `VALIDATION_POLICY.validators.X` albo ten dokładny literał. Inline-validator
  // (np. const validateOptionalUserId) = false-"missing" → HARD-FAIL audytu.
  // Dlatego type-guard body.id jest PRZENIESIONY na head businessLogic (poniżej),
  // co daje tę samą ochronę: businessLogic to entry-point, biegnie ZANIM wartość
  // dotknie where-clause deleteMany — równoważne odrzucenie operator-injection.
  validate: () => ({ __isValid: true }),
  handle: async (body, ctx, _metadata, res) => {
    // SECURITY (QA session-1): body.id jest OPCJONALNE (DELETE_ALL.REQUEST =
    // Pick<User,'id'> | undefined — brak body = wylogowanie WŁASNYCH sesji), ale
    // gdy JEST podane MUSI być stringiem. Bez tego guardu operator object jak
    // { gt: '' } przechodzi przez słaby `if (!id)` w deleteAllSessionsOfUser_IO
    // i trafia do prisma.session.deleteMany({ where: { userId: body.id } }) jako
    // prawidłowy StringFilter → kasacja sesji WSZYSTKICH userów (logout DoS dla
    // MASTER_ADMIN, dla którego skip self-vs-other guard). Array/number → 500.
    // Guard na head businessLogic (przed jakąkolwiek operacją) odrzuca każdy
    // non-string id z 400 VALIDATION_FAILED u źródła, zanim dotknie where-clause.
    if (typeof body?.id !== 'undefined' && typeof body.id !== 'string') {
      return respondValidationFailed(res, {
        id: VALIDATION_MESSAGES.user.invalidId,
      });
    }

    const { currentUser } = requireAuthenticatedContext(ctx);
    // If body.id is provided, only MASTER_ADMIN may target another user's sessions
    if (
      typeof body?.id !== 'undefined' &&
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
      typeof body?.id !== 'undefined';

    // DECISION (nie usuwaj tego komentarza):
    // Admin wylogowujący CUDZE sesje przechodzi przez tę samą ochronę celu co
    // USER_DISABLE_ANY / USER_DELETE_ANY (requireTargetNotProtected): inny admin
    // → 403 ADMIN_TARGET_PROTECTED / ADMIN_CANNOT_TARGET_ADMIN. Bez tego jeden admin
    // wylogowywał drugiego z każdego urządzenia (actor-on-actor), choć disable tego
    // samego celu jest zablokowany. Własne id (body.id === currentUser.id) to zwykłe
    // „wyloguj mnie wszędzie", więc guard (który odrzuca też self) go nie dotyczy.
    if (
      isMasterAdminTargetingSpecificUser &&
      typeof body?.id === 'string' &&
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

    const userIDToDeleteAllSessions: string = isMasterAdminTargetingSpecificUser
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
        ...(body && { requestBody: body }),
      })
    );

    respondSuccess(res, undefined, APP_EVENTS.INFO.USER.USER_LOGGED_OUT);
  },
});
