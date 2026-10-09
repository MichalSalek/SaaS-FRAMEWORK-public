import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { revokeAllPairingSessions_IO } from '@domain/pairing/operations/pairing-revoke-all.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE_ALL']['REQUEST'],
  PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE_ALL']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.PAIRING.PAIRING_SESSION_REVOKE_ALL,
  method: 'post',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await revokeAllPairingSessions_IO({
      stylist_account_id: accountCheck.data.account_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.PAIRING.ALL_PAIRING_SESSIONS_REVOKED,
        user: currentUser,
        requestBody: { revoked_count: result.data.revoked_count },
        metadata,
      })
    );

    respondSuccess(
      res,
      { revoked_count: result.data.revoked_count },
      APP_EVENTS.INFO.PAIRING.ALL_PAIRING_SESSIONS_REVOKED
    );
  },
});
