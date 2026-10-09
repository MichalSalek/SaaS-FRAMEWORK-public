import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { accountUpdateDisplayName_IO } from '@domain/account/operations/account-settings.operations';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// DECISION (nie usuwaj tego komentarza):
// Updates stylist_account.display_name (PUBLIC brand display name, e.g. "Studio Nails Warsaw").
// DIFFERENT from USER_CHANGE_NAME which updates user.name (account holder personal name).
// Used by useCompleteOnboarding for stylist onboarding flow.
export default defineHandler<
  ACCOUNT_DTO_API_V1['ACCOUNT_DISPLAY_NAME_CHANGE']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_DISPLAY_NAME_CHANGE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_DISPLAY_NAME_CHANGE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.accountDisplayNameChange,
  handle: async (body, ctx, metadata, res) => {
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

    respondSuccess(res, result.data);
  },
});
