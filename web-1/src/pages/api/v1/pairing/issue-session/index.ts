import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondCreated } from '@app/http/http.responses.utils';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { issuePairingSession_IO } from '@domain/pairing/operations/pairing-session.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { mapErrorToResponse } from '@app/http/error-mapper';
export default defineHandler<
  PAIRING_DTO_API_V1['PAIRING_SESSION_ISSUE']['REQUEST'],
  PAIRING_DTO_API_V1['PAIRING_SESSION_ISSUE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.PAIRING.PAIRING_SESSION_ISSUE,
  method: 'post',
  validate: () => ({ __isValid: true }), // No payload validation
  handle: async (_body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    reportIssueBackend({
      namespace: 'PAIRING_SESSION_ISSUE',
      message: `Issuing pairing session for stylist: ${accountCheck.data.account_id}`,
      payload: {
        user_id: currentUser.id,
        stylist_account_id: accountCheck.data.account_id,
        pricing_plan: accountCheck.data.pricing_plan,
      },
      mode: 'info',
    });

    const result = await issuePairingSession_IO({
      stylist_account_id: accountCheck.data.account_id,
      issued_by_user_id: currentUser.id,
      pricing_plan: accountCheck.data.pricing_plan,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    reportIssueBackend({
      namespace: 'PAIRING_SESSION_ISSUE',
      message: `Pairing session issued successfully`,
      payload: {
        stylist_account_id: result.data.stylist_account_id,
        expires_at: result.data.expires_at,
      },
      mode: 'info',
    });

    const responsePayload: PAIRING_DTO_API_V1['PAIRING_SESSION_ISSUE']['RESPONSE'] =
      {
        token: result.data.token,
        expires_at: result.data.expires_at.toISOString(),
        stylist_account_id: result.data.stylist_account_id,
      };

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED,
        user: currentUser,
        requestBody: {},
        metadata,
      })
    );

    respondCreated(
      res,
      responsePayload,
      APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED
    );
  },
});
