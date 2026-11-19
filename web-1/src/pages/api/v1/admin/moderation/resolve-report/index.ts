import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { resolveContentReport_IO } from '@domain/moderation/operations/moderation-admin.operations';
import { sendModerationActionOwnerEmail } from '@domain/moderation/moderation-email.service';
import { ModerationAction } from '@kernel/models/moderation/moderation.dto';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_RESOLVE_REPORT, {
  handle: async ({ input: body, ctx, meta: metadata, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await resolveContentReport_IO({
      report_id: body.report_id,
      action: body.action,
      admin_note: body.admin_note,
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget tasks BEFORE respondSuccess so they are queued
    // before the response stream closes (matters on serverless / Vercel lambdas).
    // runAfterResponse: on Vercel, waitUntil() keeps the lambda until the task ends.
    // Durable audit must record BOTH the requested and the EFFECTIVE action —
    // they diverge when the gallery record is already gone (operation downgrades
    // destructive actions to WARN); auditing only the request would claim e.g.
    // a BAN happened when nothing was banned.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.ADMIN.REPORT_RESOLVED,
        user: { id: currentUser.id },
        requestBody: {
          report_id: body.report_id,
          action: body.action,
          effective_action: result.data.action,
        },
        metadata,
      })
    );

    // Owner notification (statement of reasons) for every action that touches
    // the owner or their content: HIDE/DELETE (content actioned), BAN (account
    // blocked), WARN (warning, content stays up). DISMISS = report unfounded,
    // nothing happened to the owner → no email. Gate on the EFFECTIVE action:
    // when the record is already gone the operation downgrades to WARN, and the
    // owner email is null anyway (no ownership chain), so no mail goes out.
    if (
      result.data.gallery_record_owner_email &&
      result.data.action !== ModerationAction.DISMISS
    ) {
      const ownerEmail = result.data.gallery_record_owner_email;
      const effectiveAction = result.data.action;
      const galleryRecordId = result.data.gallery_record_id;

      try {
        await sendModerationActionOwnerEmail({
          ownerEmail,
          action: effectiveAction,
          galleryRecordId,
          adminNote: body.admin_note,
        });
      } catch (error) {
        reportIssueBackend({
          namespace: 'MODERATION_OWNER_EMAIL_FAILED',
          message: `Owner notification failed for report ${body.report_id} (action ${effectiveAction})`,
          payload: error,
          mode: 'error',
        });
      }
    }

    ok(
      {
        report_id: result.data.report_id,
        status: result.data.status,
        action: result.data.action,
      },
      APP_EVENTS.INFO.ADMIN.REPORT_RESOLVED
    );
  },
});
