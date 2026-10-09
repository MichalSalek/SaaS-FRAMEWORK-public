import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { markRead_IO } from '@domain/messaging/operations/messaging-write.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { MESSAGING_DTO_API_V1 } from '@kernel/models/messaging/messaging.dto';

export default defineHandler<
  MESSAGING_DTO_API_V1['MESSAGING_MARK_READ']['REQUEST'],
  MESSAGING_DTO_API_V1['MESSAGING_MARK_READ']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.MESSAGING.MESSAGING_MARK_READ,
  method: 'post',
  validate: VALIDATION_POLICY.validators.messagingMarkRead,
  handle: async (body, ctx, _metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await markRead_IO({ currentUser, pairId: body.pair_id });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      { pair_id: result.data.pair_id, read_at: result.data.read_at },
      APP_EVENTS.INFO.MESSAGING.MESSAGING_MARKED_READ
    );
  },
});
