import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { defineEndpoint } from '@app/http/define-endpoint';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { updateEmailPreferences_IO } from '@domain/email/operations/email-preferences.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { EMAIL_CONTRACTS } from '@kernel/domain/email/email.contracts';

export default defineEndpoint(EMAIL_CONTRACTS.EMAIL_UPDATE_PREFERENCES, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await updateEmailPreferences_IO(
      currentUser.id,
      {
        trial_sequence: input.trial_sequence,
        marketing: input.marketing,
      },
      input.source
    );
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    ok(result.data, APP_EVENTS.INFO.EMAIL.EMAIL_PREFERENCES_UPDATED);
  },
});
