import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { EMAIL_DTO_API_V1 } from '@kernel/models/email/email.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { updateEmailPreferences_IO } from '@domain/email/operations/email-preferences.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['REQUEST'],
  EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.EMAIL.EMAIL_UPDATE_PREFERENCES,
  method: 'post',
  validate: VALIDATION_POLICY.validators.emailUpdatePreferences,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await updateEmailPreferences_IO(currentUser.id, {
      trial_sequence: body.trial_sequence,
      marketing: body.marketing,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const responsePayload: EMAIL_DTO_API_V1['EMAIL_UPDATE_PREFERENCES']['RESPONSE'] =
      result.data;

    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.EMAIL.EMAIL_PREFERENCES_UPDATED
    );
  },
});
