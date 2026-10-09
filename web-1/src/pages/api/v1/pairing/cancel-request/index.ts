import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineHandler } from '@app/http/define-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { cancelPairRequest_IO } from '@domain/pairing/operations/pair-request.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

// O1: klientka wycofuje WŁASNĄ prośbę PENDING o połączenie (para -> REVOKED).
// Idempotentne (brak prośby -> success:false, bez błędu).
export default defineHandler<
  PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['REQUEST'],
  PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.PAIRING.PAIR_REQUEST_CANCEL,
  method: 'post',
  validate: VALIDATION_POLICY.validators.pairRequestCancel,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    const result = await cancelPairRequest_IO({
      client_user_id: currentUser.id,
      stylist_account_id: body.stylist_account_id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Audyt tylko przy REALNYM wycofaniu (idempotentny re-POST bez prośby nie
    // zapisuje eventu).
    if (result.data.success) {
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_CANCELLED,
          user: currentUser,
          requestBody: { stylist_account_id: body.stylist_account_id },
          metadata,
        })
      );
    }

    const payload: PAIRING_DTO_API_V1['PAIR_REQUEST_CANCEL']['RESPONSE'] = {
      success: result.data.success,
    };
    respondSuccess(
      res,
      payload,
      APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_CANCELLED
    );
  },
});
