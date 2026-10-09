import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondCreated } from '@app/http/http.responses.utils';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { addSupportMessage_IO } from '@domain/support/operations/support-thread.operations';
import { sendSupportNewMessageAdminAlert } from '@domain/support/support-email.service';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';
export default defineHandler<
  SUPPORT_DTO_API_V1['SUPPORT_ADD_MESSAGE']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_ADD_MESSAGE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SUPPORT.SUPPORT_ADD_MESSAGE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.addSupportMessage,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await addSupportMessage_IO({
      userId: currentUser.id,
      threadId: body.thread_id,
      content: body.content,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget tasks BEFORE respondCreated so they are queued
    // before the response stream closes (matters on serverless / Vercel lambdas).
    // runAfterResponse: na Vercel waitUntil() trzyma lambda do końca tasku.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.SUPPORT.SUPPORT_MESSAGE_SENT,
        user: { id: currentUser.id },
        requestBody: { thread_id: body.thread_id },
        metadata,
      })
    );

    runAfterResponse(() =>
      sendSupportNewMessageAdminAlert({
        threadId: body.thread_id,
        subject: result.data.subject,
        message: body.content,
        userEmail: currentUser.email,
      })
    );

    const responsePayload: SUPPORT_DTO_API_V1['SUPPORT_ADD_MESSAGE']['RESPONSE'] =
      {
        message_id: result.data.message_id,
      };
    respondCreated(
      res,
      responsePayload,
      APP_EVENTS.INFO.SUPPORT.SUPPORT_MESSAGE_SENT
    );
  },
});
