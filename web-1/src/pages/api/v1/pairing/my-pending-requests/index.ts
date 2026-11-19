import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineEndpoint } from '@app/http/define-endpoint';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { getMyPendingPairRequests_IO } from '@domain/pairing/operations/pairing-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

// The client's own PENDING requests, so the dashboard can name whom she waits for.
export default defineEndpoint(
  PAIRING_CONTRACTS.PAIRING_GET_MY_PENDING_REQUESTS,
  {
    handle: async ({ ctx, res, ok }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const accountCheck = requireClientAccount(currentUser);
      if (!accountCheck.success) {
        return mapErrorToResponse(res, accountCheck.error);
      }

      const result = await getMyPendingPairRequests_IO({
        client_user_id: currentUser.id,
      });
      if (!result.success) {
        return mapErrorToResponse(res, result.error);
      }

      ok(
        {
          requests: result.data.requests.map(r => ({
            pair_id: r.pair_id,
            stylist_account_id: r.stylist_account_id,
            display_name: r.display_name,
            avatar_url: r.avatar_url,
            requested_at: r.requested_at.toISOString(),
          })),
        },
        APP_EVENTS.INFO.PAIRING.PENDING_REQUESTS_FETCHED
      );
    },
  }
);
