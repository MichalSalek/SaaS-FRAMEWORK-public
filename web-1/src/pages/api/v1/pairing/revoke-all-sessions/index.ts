import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { revokeAllPairingSessions_IO } from '@domain/pairing/operations/pairing-revoke-all.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

export default defineEndpoint(PAIRING_CONTRACTS.PAIRING_SESSION_REVOKE_ALL, {
  handle: async ({ ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await revokeAllPairingSessions_IO({
      stylist_account_id: accountCheck.data.account_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.PAIRING.ALL_PAIRING_SESSIONS_REVOKED, {
      user: currentUser,
      requestBody: { revoked_count: result.data.revoked_count },
    });

    ok(
      { revoked_count: result.data.revoked_count },
      APP_EVENTS.INFO.PAIRING.ALL_PAIRING_SESSIONS_REVOKED
    );
  },
});
