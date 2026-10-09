import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { markSupportThreadRead_IO } from '@domain/support/operations/support-read-marker.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';

// No audit event on purpose: the marker is written every time the owner opens
// a thread (same as MESSAGING_MARK_READ), it changes nothing anyone else sees.
export default defineHandler<
  SUPPORT_DTO_API_V1['SUPPORT_MARK_THREAD_READ']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_MARK_THREAD_READ']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SUPPORT.SUPPORT_MARK_THREAD_READ,
  method: 'post',
  validate: VALIDATION_POLICY.validators.markSupportThreadRead,
  handle: async (body, ctx, _metadata, res) => {
    // The owner is the session user; the body carries only the thread id.
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await markSupportThreadRead_IO({
      userId: currentUser.id,
      threadId: body.thread_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_MARKED_READ
    );
  },
});
