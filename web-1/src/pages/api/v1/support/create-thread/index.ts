import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { createSupportThread_IO } from '@domain/support/operations/support-thread.operations';
import { sendSupportNewThreadAdminAlert } from '@domain/support/support-email.service';
import { SUPPORT_CONTRACTS } from '@kernel/domain/support/support.contracts';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(SUPPORT_CONTRACTS.SUPPORT_CREATE_THREAD, {
  handle: async ({ input, ctx, res, created, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await createSupportThread_IO({
      userId: currentUser.id,
      category: input.category,
      firstMessage: input.message,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // The category only: the title is derived from the message, which stays out of the audit.
    audit(APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_CREATED, {
      user: { id: currentUser.id },
      requestBody: { category: input.category },
    });

    runAfterResponse(() =>
      sendSupportNewThreadAdminAlert({
        threadId: result.data.thread_id,
        subject: result.data.subject,
        category: input.category,
        firstMessage: input.message,
        userEmail: currentUser.email,
      })
    );

    created(
      { thread_id: result.data.thread_id },
      APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_CREATED
    );
  },
});
