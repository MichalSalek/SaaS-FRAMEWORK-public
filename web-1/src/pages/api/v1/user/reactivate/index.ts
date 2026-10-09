import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { reactivateAccount_IO } from '@domain/user/operations/user-soft-delete.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
export default defineHandler<
  USER_DTO_API_V1['USER_REACTIVATE_ACCOUNT']['REQUEST'],
  USER_DTO_API_V1['USER_REACTIVATE_ACCOUNT']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.USER.USER_REACTIVATE_ACCOUNT,
  method: 'post',
  validate: VALIDATION_POLICY.validators.userReactivateAccount,
  handle: async (_body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // ADRR Model A: reactivate the caller's OWN soft-deleted account in-place.
    // userId comes from the authenticated session, never the body. The operation's
    // `recovery_available=true` guard rejects EXPIRED/ban/active → ACCOUNT_NOT_RECOVERABLE.
    const result = await reactivateAccount_IO({ id: currentUser.id });

    if (!result.success) {
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.USER.ACCOUNT_REACTIVATION_FAILED,
          user: { id: currentUser.id },
          metadata,
        })
      );
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.ACCOUNT_REACTIVATED,
        user: { id: currentUser.id },
        metadata,
      })
    );

    const responsePayload: USER_DTO_API_V1['USER_REACTIVATE_ACCOUNT']['RESPONSE'] =
      {
        reactivated: true,
      };
    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.USER.ACCOUNT_REACTIVATED
    );
  },
});
