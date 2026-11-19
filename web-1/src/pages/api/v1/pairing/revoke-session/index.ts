import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { revokePairingSession_IO } from '@domain/pairing/operations/pairing-revoke.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

export default defineEndpoint(PAIRING_CONTRACTS.PAIRING_SESSION_REVOKE, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await revokePairingSession_IO({
      token: input.token,
      stylist_account_id: accountCheck.data.account_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // DECISION: the audit log carries only a token PREFIX (8 characters + '...'), never the full token.
    // EventLog keeps 90 days, so a full token in event_payload is a persistent credential leak (DB access
    // could re-mount a revoked pairing session). The prefix is enough to correlate audit events.
    const tokenPrefix =
      typeof input.token === 'string' && input.token.length > 0
        ? `${input.token.slice(0, 8)}...`
        : null;

    audit(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_REVOKED, {
      user: currentUser,
      requestBody: { tokenPrefix },
    });

    ok({ success: true }, APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_REVOKED);
  },
});
