import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondCreated } from '@app/http/http.responses.utils';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { createSupportThread_IO } from '@domain/support/operations/support-thread.operations';
import { sendSupportNewThreadAdminAlert } from '@domain/support/support-email.service';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SUPPORT_DTO_API_V1['SUPPORT_CREATE_THREAD']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_CREATE_THREAD']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SUPPORT.SUPPORT_CREATE_THREAD,
  method: 'post',
  validate: VALIDATION_POLICY.validators.createSupportThread,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await createSupportThread_IO({
      userId: currentUser.id,
      category: body.category,
      firstMessage: body.message,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget tasks BEFORE respondCreated so they are queued
    // before the response stream closes (matters on serverless / Vercel lambdas).
    // runAfterResponse: na Vercel waitUntil() trzyma lambda do końca tasku.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_CREATED,
        user: { id: currentUser.id },
        // The category only: the title is derived from the message, which is
        // user content and stays out of the audit payload.
        requestBody: { category: body.category },
        metadata,
      })
    );

    runAfterResponse(() =>
      sendSupportNewThreadAdminAlert({
        threadId: result.data.thread_id,
        subject: result.data.subject,
        category: body.category,
        firstMessage: body.message,
        userEmail: currentUser.email,
      })
    );

    const responsePayload: SUPPORT_DTO_API_V1['SUPPORT_CREATE_THREAD']['RESPONSE'] =
      {
        thread_id: result.data.thread_id,
      };
    respondCreated(
      res,
      responsePayload,
      APP_EVENTS.INFO.SUPPORT.SUPPORT_THREAD_CREATED
    );
  },
});
