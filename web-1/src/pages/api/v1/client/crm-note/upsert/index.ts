import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineHandler } from '@app/http/define-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { upsertClientCrmNote_IO } from '@domain/client/operations/client-crm-note.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { VISIT_DTO_API_V1 } from '@kernel/models/visit/visit.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

export default defineHandler<
  VISIT_DTO_API_V1['CLIENT_UPSERT_CRM_NOTE']['REQUEST'],
  VISIT_DTO_API_V1['CLIENT_UPSERT_CRM_NOTE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.CLIENT.CLIENT_UPSERT_CRM_NOTE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.clientUpsertCrmNote,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await upsertClientCrmNote_IO({
      stylist_account_id: accountCheck.data.account_id,
      client_user_id: body.client_user_id,
      stylist_pricing_plan: accountCheck.data.pricing_plan,
      note: body.note,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.CLIENT.CLIENT_CRM_NOTE_UPSERTED,
        user: { id: currentUser.id },
        requestBody: redactAuditPayload(body, ['client_user_id']),
        responseBody: { updatedAt: result.data.updatedAt },
        metadata,
      })
    );

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.CLIENT.CLIENT_CRM_NOTE_UPSERTED
    );
  },
});
