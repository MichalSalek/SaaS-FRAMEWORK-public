import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondCreated } from '@app/http/http.responses.utils';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { createContentReport_IO } from '@domain/moderation/operations/moderation-report.operation';
import { sendContentReportAdminAlert } from '@domain/moderation/moderation-email.service';
import type { MODERATION_DTO_API_V1 } from '@kernel/models/moderation/moderation.dto';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['REQUEST'],
  MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.GALLERY.REPORT_GALLERY_RECORD,
  method: 'post',
  validate: VALIDATION_POLICY.validators.reportGalleryRecord,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // userId from session, NEVER from body
    const result = await createContentReport_IO({
      gallery_record_id: body.gallery_record_id,
      reporter_id: currentUser.id,
      reason: body.reason,
      description: body.description,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget tasks BEFORE respondCreated so they are queued
    // before the response stream closes (matters on serverless / Vercel lambdas).
    // runAfterResponse: na Vercel waitUntil() trzyma lambda do końca tasku.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.GALLERY.CONTENT_REPORTED,
        user: { id: currentUser.id },
        requestBody: {
          gallery_record_id: body.gallery_record_id,
          reason: body.reason,
        },
        metadata,
      })
    );

    runAfterResponse(() =>
      sendContentReportAdminAlert({
        reportId: result.data.report_id,
        galleryRecordId: body.gallery_record_id,
        reason: body.reason,
        reporterEmail: currentUser.email,
        description: body.description,
      })
    );

    respondCreated(
      res,
      { report_id: result.data.report_id },
      APP_EVENTS.INFO.GALLERY.CONTENT_REPORTED
    );
  },
});
