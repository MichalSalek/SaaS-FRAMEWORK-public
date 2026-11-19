import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { createContentReport_IO } from '@domain/moderation/operations/moderation-report.operation';
import { sendContentReportAdminAlert } from '@domain/moderation/moderation-email.service';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { GALLERY_CONTRACTS } from '@kernel/domain/gallery/gallery.contracts';

export default defineEndpoint(GALLERY_CONTRACTS.REPORT_GALLERY_RECORD, {
  handle: async ({ input, ctx, res, created, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // userId from session, NEVER from body
    const result = await createContentReport_IO({
      gallery_record_id: input.gallery_record_id,
      reporter_id: currentUser.id,
      reason: input.reason,
      description: input.description,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget tasks BEFORE respondCreated so they are queued
    // before the response stream closes (matters on serverless / Vercel lambdas).
    audit(APP_EVENTS.INFO.GALLERY.CONTENT_REPORTED, {
      user: { id: currentUser.id },
      requestBody: {
        gallery_record_id: input.gallery_record_id,
        reason: input.reason,
      },
    });

    runAfterResponse(() =>
      sendContentReportAdminAlert({
        reportId: result.data.report_id,
        galleryRecordId: input.gallery_record_id,
        reason: input.reason,
        reporterEmail: currentUser.email,
        description: input.description,
      })
    );

    created(
      { report_id: result.data.report_id },
      APP_EVENTS.INFO.GALLERY.CONTENT_REPORTED
    );
  },
});
