import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineHandler } from '@app/http/define-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { deleteManualVisit_IO } from '@domain/visit/operations/visit-record.operations';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { VISIT_DTO_API_V1 } from '@kernel/models/visit/visit.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

export default defineHandler<
  VISIT_DTO_API_V1['DELETE_MANUAL_VISIT']['REQUEST'],
  VISIT_DTO_API_V1['DELETE_MANUAL_VISIT']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.VISIT.DELETE_MANUAL_VISIT,
  method: 'post',
  validate: VALIDATION_POLICY.validators.deleteManualVisit,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await deleteManualVisit_IO({
      stylist_account_id: accountCheck.data.account_id,
      stylist_pricing_plan: accountCheck.data.pricing_plan,
      visit_id: body.visit_id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.VISIT.VISIT_DELETED,
        user: { id: currentUser.id },
        requestBody: redactAuditPayload(body, ['visit_id']),
        responseBody: { success: true },
        metadata,
      })
    );

    respondSuccess(res, { success: true }, APP_EVENTS.INFO.VISIT.VISIT_DELETED);
  },
});
