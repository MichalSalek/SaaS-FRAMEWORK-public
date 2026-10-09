import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondCreated } from '@app/http/http.responses.utils';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminReplyToThread_IO } from '@domain/support/operations/support-admin.operations';
import { sendSupportReplyNotification } from '@domain/support/support-email.service';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';
export default defineHandler<
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_REPLY']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_REPLY']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SUPPORT.SUPPORT_ADMIN_REPLY,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminSupportReply,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await adminReplyToThread_IO({
      threadId: body.thread_id,
      content: body.content,
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget tasks BEFORE respondCreated so they are queued
    // before the response stream closes (matters on serverless / Vercel lambdas).
    // runAfterResponse: na Vercel waitUntil() trzyma lambda do końca tasku.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_REPLIED,
        user: { id: currentUser.id },
        requestBody: { thread_id: body.thread_id },
        metadata,
      })
    );

    runAfterResponse(() =>
      sendSupportReplyNotification({
        threadId: body.thread_id,
        subject: result.data.subject,
        replyPreview: body.content.slice(0, 200),
        userEmail: result.data.user_email,
      })
    );

    respondCreated(
      res,
      { message_id: result.data.message_id },
      APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_REPLIED
    );
  },
});
