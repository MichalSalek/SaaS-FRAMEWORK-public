import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineHandler } from '@app/http/define-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { respondPairRequest_IO } from '@domain/pairing/operations/pair-request.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

// Stały kod QR (2026-07-11): stylistka akceptuje (PENDING→ACTIVE pod pełnymi
// checkami capów, tx Serializable) albo odrzuca prośbę o połączenie.
export default defineHandler<
  PAIRING_DTO_API_V1['PAIR_REQUEST_RESPOND']['REQUEST'],
  PAIRING_DTO_API_V1['PAIR_REQUEST_RESPOND']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.PAIRING.PAIR_REQUEST_RESPOND,
  method: 'post',
  validate: VALIDATION_POLICY.validators.pairRequestRespond,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await respondPairRequest_IO({
      stylist_account_id: accountCheck.data.account_id,
      stylist_pricing_plan: accountCheck.data.pricing_plan,
      pair_id: body.pair_id,
      action: body.action,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const auditEvent =
      result.data.status === 'ACTIVE'
        ? APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_ACCEPTED
        : APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_DECLINED;
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: auditEvent,
        user: currentUser,
        requestBody: redactAuditPayload(body, ['pair_id']),
        metadata,
      })
    );

    const payload: PAIRING_DTO_API_V1['PAIR_REQUEST_RESPOND']['RESPONSE'] = {
      success: true,
      status: result.data.status,
    };
    respondSuccess(res, payload, auditEvent);
  },
});
