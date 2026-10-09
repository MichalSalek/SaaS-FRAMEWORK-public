import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import {
  respondNotFound,
  respondSuccess,
} from '@app/http/http.responses.utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { restoreAccountFromBackup } from '@domain/user/operations/recovery/recovery.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  USER_DTO_API_V1['USER_RESTORE_ACCOUNT']['REQUEST'],
  USER_DTO_API_V1['USER_RESTORE_ACCOUNT']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.USER.USER_RESTORE_ACCOUNT,
  method: 'post',
  validate: VALIDATION_POLICY.validators.userRestoreAccount,
  handle: async (_body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    if (!currentUser.email) {
      respondNotFound(res, APP_EVENTS.INFO.USER.RECOVERY_NOT_FOUND, undefined);
      return;
    }

    const result = await restoreAccountFromBackup({
      userId: currentUser.id,
      userEmail: currentUser.email,
    });

    if (!result.success) {
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.USER.ACCOUNT_RECOVERY_FAILED,
          user: currentUser,
          requestBody: { error: 'Recovery not available' },
          metadata,
        })
      );

      respondNotFound(res, APP_EVENTS.INFO.USER.RECOVERY_NOT_FOUND, undefined);
      return;
    }

    const responsePayload: USER_DTO_API_V1['USER_RESTORE_ACCOUNT']['RESPONSE'] =
      result;
    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.ACCOUNT_RECOVERED,
        user: currentUser,
        requestBody: {
          restored_account_type: result.restored_account_type,
          gallery_records_restored: result.gallery_records_restored,
        },
        metadata,
      })
    );

    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.USER.ACCOUNT_RECOVERED
    );
  },
});
