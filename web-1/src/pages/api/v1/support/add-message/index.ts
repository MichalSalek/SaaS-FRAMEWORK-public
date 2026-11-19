import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { addSupportMessage_IO } from '@domain/support/operations/support-thread.operations';
import { sendSupportNewMessageAdminAlert } from '@domain/support/support-email.service';
import { SUPPORT_CONTRACTS } from '@kernel/domain/support/support.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(SUPPORT_CONTRACTS.SUPPORT_ADD_MESSAGE, {
  handle: async ({ input, ctx, res, created, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await addSupportMessage_IO({
      userId: currentUser.id,
      threadId: input.thread_id,
      content: input.content,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.SUPPORT.SUPPORT_MESSAGE_SENT, {
      user: { id: currentUser.id },
      requestBody: { thread_id: input.thread_id },
    });

    runAfterResponse(() =>
      sendSupportNewMessageAdminAlert({
        threadId: input.thread_id,
        subject: result.data.subject,
        message: input.content,
        userEmail: currentUser.email,
      })
    );

    created(
      { message_id: result.data.message_id },
      APP_EVENTS.INFO.SUPPORT.SUPPORT_MESSAGE_SENT
    );
  },
});
