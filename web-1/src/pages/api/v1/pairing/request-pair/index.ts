import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineHandler } from '@app/http/define-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { emitInfoEvent } from '@app/events/event-bus';
import { createPairRequest_IO } from '@domain/pairing/operations/pair-request.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

// Stały kod QR (2026-07-11): klientka z publicznego profilu stylistki prosi
// o połączenie → para PENDING (zero dostępu do czasu akceptacji). Endpoint
// w STRICT rate-limit (anty-spam prośbami po sfotografowanym plakacie).
export default defineHandler<
  PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['REQUEST'],
  PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.PAIRING.PAIR_REQUEST_CREATE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.pairRequestCreate,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    const result = await createPairRequest_IO({
      client_user_id: currentUser.id,
      stylist_account_id: body.stylist_account_id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Audyt tylko przy REALNYM utworzeniu prośby — idempotentny re-POST
    // (ALREADY_PAIRED / prośba już czeka) nie pompuje audit-trailu ani lejka.
    if (result.data.created) {
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT,
          user: currentUser,
          requestBody: redactAuditPayload(body, ['stylist_account_id']),
          metadata,
        })
      );

      // Mail „prośba czeka" do stylistki (stały-only 2026-07-12): side-effect
      // żyje w event-listenerze (pair-request-sent.listener), handler tylko
      // emituje — parytet ze ścieżką claim (PAIRING_SESSION_CLAIMED).
      if (result.data.notify) {
        emitInfoEvent(APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT, {
          stylistUserId: result.data.notify.stylist_user_id,
          stylistEmail: result.data.notify.stylist_email,
          stylistName: result.data.notify.stylist_name,
          clientName: currentUser.name || null,
        });
      }
    }

    const payload: PAIRING_DTO_API_V1['PAIR_REQUEST_CREATE']['RESPONSE'] = {
      status: result.data.status,
      display_name: result.data.display_name,
      created: result.data.created,
      pair_id: result.data.pair_id,
    };
    respondSuccess(res, payload, APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT);
  },
});
