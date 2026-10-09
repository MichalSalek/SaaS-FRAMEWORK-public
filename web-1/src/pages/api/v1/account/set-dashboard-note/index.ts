import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { setDashboardNote_IO } from '@domain/account/operations/account-settings.operations';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  ACCOUNT_DTO_API_V1['ACCOUNT_SET_DASHBOARD_NOTE']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_SET_DASHBOARD_NOTE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_SET_DASHBOARD_NOTE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.accountSetDashboardNote,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await setDashboardNote_IO({
      user_id: currentUser.id,
      account_type: body.account_type,
      note: body.note,
      stylist_account_id: currentUser.stylist_account?.account_id,
      client_account_id: currentUser.client_account?.client_account_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    // PII redaction: `note` is free-text PII. Log account_type + has_note flag only.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.ACCOUNT.DASHBOARD_NOTE_SET,
        user: { id: currentUser.id },
        requestBody: {
          account_type: body.account_type,
          has_note: Boolean(body.note),
        },
        metadata,
      })
    );

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ACCOUNT.DASHBOARD_NOTE_SET
    );
  },
});
