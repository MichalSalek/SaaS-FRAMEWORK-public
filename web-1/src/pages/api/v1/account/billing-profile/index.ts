import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { getBillingProfile_IO } from '@app/stripe/billing-profile.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_BILLING_PROFILE, {
  handle: async ({ ctx, res, ok }) => {
    const { session } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'private, no-store');
    const result = await getBillingProfile_IO(session.userId);
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    ok(result.data, APP_EVENTS.INFO.ACCOUNT.BILLING_PROFILE_FETCHED);
  },
});
