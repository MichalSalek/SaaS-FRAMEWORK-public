import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { applyModerationStrike_IO } from '@domain/moderation/operations/moderation-strike.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_APPLY_STRIKE, {
  handle: async ({ input: body, ctx, meta: metadata, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await applyModerationStrike_IO({
      user_id: body.user_id,
      reason: body.reason,
      report_id: body.report_id,
      admin_id: currentUser.id,
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respondSuccess so the task is queued
    // before the response stream closes (matters on serverless / Vercel lambdas).
    // runAfterResponse: on Vercel, waitUntil() keeps the lambda until the task ends.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.ADMIN.STRIKE_APPLIED,
        user: { id: currentUser.id },
        requestBody: {
          target_user_id: body.user_id,
          reason: body.reason,
          report_id: body.report_id,
          strikes: result.data.moderation_strikes,
          ban_recommended: result.data.ban_recommended,
        },
        metadata,
      })
    );

    ok(
      {
        user_id: result.data.user_id,
        moderation_strikes: result.data.moderation_strikes,
        ban_recommended: result.data.ban_recommended,
      },
      APP_EVENTS.INFO.ADMIN.STRIKE_APPLIED
    );
  },
});
