import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { applyModerationStrike_IO } from '@domain/moderation/operations/moderation-strike.operations';
import type { MODERATION_DTO_API_V1 } from '@kernel/models/moderation/moderation.dto';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['REQUEST'],
  MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_APPLY_STRIKE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminApplyStrike,
  handle: async (body, ctx, metadata, res) => {
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
    // runAfterResponse: na Vercel waitUntil() trzyma lambda do końca tasku.
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

    respondSuccess(
      res,
      {
        user_id: result.data.user_id,
        moderation_strikes: result.data.moderation_strikes,
        ban_recommended: result.data.ban_recommended,
      },
      APP_EVENTS.INFO.ADMIN.STRIKE_APPLIED
    );
  },
});
