import { defineEndpoint } from '@app/http/define-endpoint';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { getClientImportantNote_IO } from '@domain/client/operations/client-important-note.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { CLIENT_CONTRACTS } from '@kernel/domain/client/client.contracts';

// No plan gate: see the DECISION in client-important-note.operations.ts.
// Missing, empty or repeated client_user_id: `{ client_user_id: 'Required' }` (CLIENT_CONTRACTS).
export default defineEndpoint(CLIENT_CONTRACTS.CLIENT_GET_IMPORTANT_NOTE, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const client_user_id = input.client_user_id;
    if (client_user_id === undefined) {
      respondValidationFailed(res, { client_user_id: 'Required' });
      return;
    }

    const result = await getClientImportantNote_IO({
      stylist_account_id: accountCheck.data.account_id,
      client_user_id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.CLIENT.CLIENT_IMPORTANT_NOTE_FETCHED);
  },
});
