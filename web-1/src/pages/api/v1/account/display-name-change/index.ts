import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { accountUpdateDisplayName_IO } from '@domain/account/operations/account-settings.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// Updates stylist_account.display_name (the PUBLIC brand name, e.g. "Studio Nails Warsaw"), unlike
// USER_CHANGE_NAME, which updates user.name (the account holder's personal name).
// Used by useCompleteOnboarding for stylist onboarding.
export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_DISPLAY_NAME_CHANGE, {
  handle: async ({ input: body, ctx, meta: metadata, res, ok }) => {
    const { session, currentUser } = requireAuthenticatedContext(ctx);
    // display_name is validated as non-empty string by validationFunction
    const result = await accountUpdateDisplayName_IO({
      id: session.userId,
      display_name: body.display_name ?? '',
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.ACCOUNT.DISPLAY_NAME_CHANGED,
        user: currentUser,
        requestBody: redactAuditPayload(body, []),
        metadata,
      })
    );

    ok(result.data, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
