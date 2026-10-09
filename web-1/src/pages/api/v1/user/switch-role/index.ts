import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { switchRole_IO } from '@domain/user/operations/user-onboarding.operations';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// DECISION (nie usuwaj tego komentarza):
// Endpoint reserved for future "user has BOTH stylist AND client accounts" role-switching feature.
// Currently UI uses re-onboard flow for account creation; switch-role would handle existing accounts.
// In permissions matrix (role-permissions.ts) — intentionally maintained.
export default defineHandler<
  USER_DTO_API_V1['USER_SWITCH_ROLE']['REQUEST'],
  USER_DTO_API_V1['USER_SWITCH_ROLE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.USER.USER_SWITCH_ROLE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.userSwitchRole,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await switchRole_IO({
      userId: currentUser.id,
      targetAccountType: body.account_type,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    // Audit the RBAC-decisive transition (role_id + account_type). account_type is
    // a STYLIST/CLIENT enum, not PII — safe to log as the transition target.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.USER.USER_ROLE_SWITCHED,
        user: { id: currentUser.id },
        requestBody: { account_type: body.account_type },
        metadata,
      })
    );

    respondSuccess(res, result.data, APP_EVENTS.INFO.USER.USER_ROLE_SWITCHED);
  },
});
