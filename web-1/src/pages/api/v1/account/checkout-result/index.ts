import { defineEndpoint } from '@app/http/define-endpoint';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { getCheckoutResult_IO } from '@domain/account/operations/account-checkout-result.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_CHECKOUT_RESULT, {
  handle: async ({ input, ctx, res, ok }) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!input.sessionId || !/^cs_[a-zA-Z0-9_]{1,200}$/.test(input.sessionId)) {
      respondValidationFailed(res, undefined);
      return;
    }
    const { session } = requireAuthenticatedContext(ctx);
    const result = await getCheckoutResult_IO(session.userId, input.sessionId);
    ok(result, APP_EVENTS.INFO.ACCOUNT.CHECKOUT_RESULT_FETCHED);
  },
});
