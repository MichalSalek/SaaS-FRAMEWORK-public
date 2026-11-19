import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { markRead_IO } from '@domain/messaging/operations/messaging-write.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { markConversationNotificationsRead_IO } from '@domain/notifications/operations/notification-write.operations';
import { MESSAGING_CONTRACTS } from '@kernel/domain/messaging/messaging.contracts';

export default defineEndpoint(MESSAGING_CONTRACTS.MESSAGING_MARK_READ, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await markRead_IO({
      currentUser,
      pairId: input.pair_id,
      ...(input.read_through != null
        ? { readThrough: new Date(input.read_through) }
        : {}),
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Reading the thread closes its „napisała do Ciebie” row.
    runAfterResponse(() =>
      markConversationNotificationsRead_IO({
        userId: currentUser.id,
        pairId: input.pair_id,
        readThrough: new Date(result.data.read_at),
      }).then(() => undefined)
    );

    ok(
      { pair_id: result.data.pair_id, read_at: result.data.read_at },
      APP_EVENTS.INFO.MESSAGING.MESSAGING_MARKED_READ
    );
  },
});
