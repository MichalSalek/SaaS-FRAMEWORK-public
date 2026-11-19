import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { emitInfoEvent } from '@app/events/event-bus';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminReplyToThread_IO } from '@domain/support/operations/support-admin.operations';
import { sendSupportReplyNotification } from '@domain/support/support-email.service';
import { SUPPORT_CONTRACTS } from '@kernel/domain/support/support.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(SUPPORT_CONTRACTS.SUPPORT_ADMIN_REPLY, {
  handle: async ({ input, ctx, res, created, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminReplyToThread_IO({
      threadId: input.thread_id,
      content: input.content,
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_REPLIED, {
      user: { id: currentUser.id },
      requestBody: { thread_id: input.thread_id },
    });

    runAfterResponse(() =>
      sendSupportReplyNotification({
        threadId: input.thread_id,
        subject: result.data.subject,
        replyPreview: input.content.slice(0, 200),
        userEmail: result.data.user_email,
      })
    );

    const ownerUserId = result.data.owner_user_id;
    if (ownerUserId !== null) {
      emitInfoEvent(APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_REPLIED, {
        threadId: input.thread_id,
        ownerUserId,
      });
    }

    created(
      { message_id: result.data.message_id },
      APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_REPLIED
    );
  },
});
