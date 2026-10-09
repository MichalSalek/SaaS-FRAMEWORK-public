import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { adminSetLogIssueStatus_IO } from '@domain/admin/operations/admin-log-groups.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_SET_LOG_ISSUE_STATUS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_SET_LOG_ISSUE_STATUS']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.ADMIN_SET_LOG_ISSUE_STATUS,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminSetLogIssueStatus,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    const result = await adminSetLogIssueStatus_IO({ body, currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Notatka admina może nieść dowolny tekst — do audytu idą tylko odcisk palca
    // i status, czyli to, co realnie opisuje decyzję.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.ADMIN.LOG_ISSUE_STATUS_SET,
        user: { id: currentUser.id },
        requestBody: redactAuditPayload(body, ['fingerprint', 'status']),
        responseBody: result.data,
        metadata,
      })
    );

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.LOG_ISSUE_STATUS_SET
    );
  },
});
