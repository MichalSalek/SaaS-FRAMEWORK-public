import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineEndpoint } from '@app/http/define-endpoint';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { getPendingPairRequests_IO } from '@domain/pairing/operations/pairing-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

// PENDING requests for the stylist's pairing screen. No query fields.
export default defineEndpoint(PAIRING_CONTRACTS.PAIRING_GET_PENDING_REQUESTS, {
  handle: async ({ ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await getPendingPairRequests_IO({
      stylist_account_id: accountCheck.data.account_id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(
      {
        requests: result.data.requests.map(r => ({
          pair_id: r.pair_id,
          name: r.name,
          requested_at: r.requested_at.toISOString(),
          avatar_url: r.avatar_url,
          place: r.place,
          note: r.note,
        })),
      },
      APP_EVENTS.INFO.PAIRING.PENDING_REQUESTS_FETCHED
    );
  },
});
