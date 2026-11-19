import { defineEndpoint } from '@app/http/define-endpoint';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { endContact_IO } from '@domain/messaging/operations/messaging-contact.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { MESSAGING_CONTRACTS } from '@kernel/domain/messaging/messaging.contracts';

export default defineEndpoint(MESSAGING_CONTRACTS.MESSAGING_END_CONTACT, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await endContact_IO({ currentUser, pairId: input.pair_id });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    audit(APP_EVENTS.INFO.MESSAGING.MESSAGING_CONTACT_ENDED, {
      user: currentUser,
      requestBody: input,
      responseBody: result.data,
    });
    ok(result.data, APP_EVENTS.INFO.MESSAGING.MESSAGING_CONTACT_ENDED);
  },
});
