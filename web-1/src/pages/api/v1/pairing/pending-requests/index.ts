import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineHandler } from '@app/http/define-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { getPendingPairRequests_IO } from '@domain/pairing/operations/pairing-query.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';

// Stały kod QR (2026-07-11): lista próśb PENDING dla ekranu Parowanie
// stylistki (badge + akceptacja 1 tapem). Read-only, bez walidatora (GET
// bez parametrów — parytet z get-my-pairs bez cursora).
export default defineHandler<
  PAIRING_DTO_API_V1['PAIRING_GET_PENDING_REQUESTS']['REQUEST'],
  PAIRING_DTO_API_V1['PAIRING_GET_PENDING_REQUESTS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.PAIRING.PAIRING_GET_PENDING_REQUESTS,
  method: 'get',
  // GET bez parametrów — jawny noop-validator (wzorzec get-my-pairs).
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res) => {
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

    const payload: PAIRING_DTO_API_V1['PAIRING_GET_PENDING_REQUESTS']['RESPONSE'] =
      {
        requests: result.data.requests.map(r => ({
          pair_id: r.pair_id,
          name: r.name,
          requested_at: r.requested_at.toISOString(),
        })),
      };
    respondSuccess(
      res,
      payload,
      APP_EVENTS.INFO.PAIRING.PENDING_REQUESTS_FETCHED
    );
  },
});
