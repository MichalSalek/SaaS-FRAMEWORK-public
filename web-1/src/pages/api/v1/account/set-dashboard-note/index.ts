import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { setDashboardNote_IO } from '@domain/account/operations/account-settings.operations';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_SET_DASHBOARD_NOTE, {
  handle: async ({ input: body, ctx, meta: metadata, res }) => {
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
