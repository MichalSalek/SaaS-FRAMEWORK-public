import { defineEndpoint } from '@app/http/define-endpoint';
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { respondSuccess } from '@app/http/http.responses.utils';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { setSalonLogo_IO } from '@domain/salon-profile/salon-logo.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SALON_PROFILE_CONTRACTS } from '@kernel/domain/salon-profile/salon-profile.contracts';

export default defineEndpoint(SALON_PROFILE_CONTRACTS.SALON_PROFILE_SET_LOGO, {
  handle: async ({ input, ctx, meta: metadata, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const account = requireStylistAccount(currentUser);
    if (!account.success) {
      return mapErrorToResponse(res, account.error);
    }
    const result = await setSalonLogo_IO({
      accountId: account.data.account_id,
      userId: currentUser.id,
      logo_url: input.logo_url,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    const event = APP_EVENTS.INFO.SALON_PROFILE.SALON_PROFILE_UPDATED;
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: event,
        user: currentUser,
        requestBody: redactAuditPayload(input, ['logo_url']),
        responseBody: { account_id: result.data.account_id },
        metadata,
      })
    );
    respondSuccess(res, result.data, event);
  },
});
