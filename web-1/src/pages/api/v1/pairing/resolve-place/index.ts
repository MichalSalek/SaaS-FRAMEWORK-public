import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineEndpoint } from '@app/http/define-endpoint';
import { reverseNominatimPlace } from '@app/maps/nominatim.client';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

// DECISION: POST, not GET. Approximate coordinates must not land in the URL or
// in access logs. The handler does not persist them and does not log them.
// A failure returns an empty place so the client types the field by hand.
export default defineEndpoint(PAIRING_CONTRACTS.PAIRING_RESOLVE_PLACE, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const client = requireClientAccount(currentUser);
    if (!client.success) {
      return mapErrorToResponse(res, client.error);
    }

    const place = await reverseNominatimPlace(input.latitude, input.longitude);
    ok({ place }, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
