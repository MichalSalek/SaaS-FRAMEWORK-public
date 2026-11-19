import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineEndpoint } from '@app/http/define-endpoint';
import { emitInfoEvent } from '@app/events/event-bus';
import { createPairRequest_IO } from '@domain/pairing/operations/pair-request.operations';
import { resolvePairRequestPlace } from '@domain/pairing/pair-request-place';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

// A client asks to connect from the stylist's public profile. The pair stays
// PENDING until the stylist accepts. The route is on the strict limiter.
export default defineEndpoint(PAIRING_CONTRACTS.PAIR_REQUEST_CREATE, {
  handle: async ({ input, ctx, req, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const place = resolvePairRequestPlace(input.place, req.headers);

    const result = await createPairRequest_IO({
      client_user_id: currentUser.id,
      stylist_account_id: input.stylist_account_id,
      ...(place !== undefined ? { place } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Audit only when a request was actually created. A repeat POST that is
    // already paired, or already waiting, writes no audit row and no funnel
    // event (result.data.created is false).
    if (result.data.created) {
      audit(APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT, {
        user: currentUser,
        requestBody: redactAuditPayload(input, ['stylist_account_id']),
      });

      // Mail lives in the pair-request-sent listener. The handler only emits.
      // pair_id is set on every branch that sets notify.
      if (result.data.notify && result.data.pair_id) {
        emitInfoEvent(APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT, {
          stylistUserId: result.data.notify.stylist_user_id,
          stylistEmail: result.data.notify.stylist_email,
          stylistName: result.data.notify.stylist_name,
          clientName: currentUser.name || null,
          pairId: result.data.pair_id,
          clientUserId: currentUser.id,
        });
      }
    }

    ok(
      {
        status: result.data.status,
        display_name: result.data.display_name,
        created: result.data.created,
        pair_id: result.data.pair_id,
      },
      APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT
    );
  },
});
