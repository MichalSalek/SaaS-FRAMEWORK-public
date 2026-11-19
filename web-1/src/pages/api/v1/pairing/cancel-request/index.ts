import { defineEndpoint } from '@app/http/define-endpoint';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { cancelPairRequest_IO } from '@domain/pairing/operations/pair-request.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

// The client withdraws her own PENDING request (the pair becomes REVOKED).
// Idempotent: no pending request returns success false and writes no audit row.
export default defineEndpoint(PAIRING_CONTRACTS.PAIR_REQUEST_CANCEL, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    const result = await cancelPairRequest_IO({
      client_user_id: currentUser.id,
      stylist_account_id: input.stylist_account_id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    if (result.data.success) {
      audit(APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_CANCELLED, {
        user: currentUser,
        requestBody: { stylist_account_id: input.stylist_account_id },
      });
    }

    ok(
      { success: result.data.success },
      APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_CANCELLED
    );
  },
});
