import { defineEndpoint } from '@app/http/define-endpoint';
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { respondSuccess } from '@app/http/http.responses.utils';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { userSetAvatar_IO } from '@domain/user/operations/user-avatar.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';

export default defineEndpoint(USER_CONTRACTS.USER_SET_AVATAR, {
  handle: async ({ input, ctx, meta: metadata, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await userSetAvatar_IO({
      userId: currentUser.id,
      avatar_url: input.avatar_url,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    const event =
      input.avatar_url === null
        ? APP_EVENTS.INFO.ACCOUNT.AVATAR_CLEARED
        : APP_EVENTS.INFO.ACCOUNT.AVATAR_SET;
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: event,
        user: currentUser,
        requestBody: redactAuditPayload(input, ['avatar_url']),
        responseBody: { user_id: currentUser.id },
        metadata,
      })
    );
    respondSuccess(res, result.data, event);
  },
});
