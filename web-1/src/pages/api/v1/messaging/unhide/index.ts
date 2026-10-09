import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { setConversationHidden_IO } from '@domain/messaging/operations/messaging-write.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { MESSAGING_DTO_API_V1 } from '@kernel/models/messaging/messaging.dto';

// D2 (2026-09-05): przywrócenie rozmowy po stronie wołającego
// (hide = mute; DECISION przy setConversationHidden_IO).
export default defineHandler<
  MESSAGING_DTO_API_V1['MESSAGING_UNHIDE_CONVERSATION']['REQUEST'],
  MESSAGING_DTO_API_V1['MESSAGING_UNHIDE_CONVERSATION']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.MESSAGING.MESSAGING_UNHIDE_CONVERSATION,
  method: 'post',
  validate: VALIDATION_POLICY.validators.messagingUnhideConversation,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await setConversationHidden_IO({
      currentUser,
      pairId: body.pair_id,
      hidden: false,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.MESSAGING.MESSAGING_CONVERSATION_UNHIDDEN,
        user: { id: currentUser.id },
        requestBody: { pair_id: body.pair_id },
        metadata,
      })
    );

    respondSuccess(
      res,
      { pair_id: result.data.pair_id },
      APP_EVENTS.INFO.MESSAGING.MESSAGING_CONVERSATION_UNHIDDEN
    );
  },
});
