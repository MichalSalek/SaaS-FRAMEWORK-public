import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { issuePairingSession_IO } from '@domain/pairing/operations/pairing-session.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

export default defineEndpoint(PAIRING_CONTRACTS.PAIRING_SESSION_ISSUE, {
  handle: async ({ ctx, res, created, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    reportIssueBackend({
      namespace: 'PAIRING_SESSION_ISSUE',
      message: `Issuing pairing session for stylist: ${accountCheck.data.account_id}`,
      payload: {
        user_id: currentUser.id,
        stylist_account_id: accountCheck.data.account_id,
        pricing_plan: getEffectivePricingPlan(accountCheck.data),
      },
      mode: 'info',
    });

    const result = await issuePairingSession_IO({
      stylist_account_id: accountCheck.data.account_id,
      issued_by_user_id: currentUser.id,
      pricing_plan: getEffectivePricingPlan(accountCheck.data),
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    reportIssueBackend({
      namespace: 'PAIRING_SESSION_ISSUE',
      message: `Pairing session issued successfully`,
      payload: {
        stylist_account_id: result.data.stylist_account_id,
        expires_at: result.data.expires_at,
      },
      mode: 'info',
    });

    audit(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED, {
      user: currentUser,
      requestBody: {},
    });

    created(
      {
        token: result.data.token,
        expires_at: result.data.expires_at.toISOString(),
        stylist_account_id: result.data.stylist_account_id,
      },
      APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_ISSUED
    );
  },
});
