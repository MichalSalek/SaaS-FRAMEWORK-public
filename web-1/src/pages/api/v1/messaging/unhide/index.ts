import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { setConversationHidden_IO } from '@domain/messaging/operations/messaging-write.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { MESSAGING_CONTRACTS } from '@kernel/domain/messaging/messaging.contracts';

// Restores the conversation on the caller's side
// (hide = mute; see the DECISION at setConversationHidden_IO).
export default defineEndpoint(
  MESSAGING_CONTRACTS.MESSAGING_UNHIDE_CONVERSATION,
  {
    handle: async ({ input, ctx, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const result = await setConversationHidden_IO({
        currentUser,
        pairId: input.pair_id,
        hidden: false,
      });

      if (!result.success) {
        return mapErrorToResponse(res, result.error);
      }

      audit(APP_EVENTS.INFO.MESSAGING.MESSAGING_CONVERSATION_UNHIDDEN, {
        user: { id: currentUser.id },
        requestBody: { pair_id: input.pair_id },
      });

      ok(
        { pair_id: result.data.pair_id },
        APP_EVENTS.INFO.MESSAGING.MESSAGING_CONVERSATION_UNHIDDEN
      );
    },
  }
);
