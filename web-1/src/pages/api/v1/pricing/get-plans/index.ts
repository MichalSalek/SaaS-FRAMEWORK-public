import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { defineEndpoint } from '@app/http/define-endpoint';
import { fetchPricingPlans } from '@app/stripe/pricing.operations';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { PRICING_CONTRACTS } from '@kernel/domain/pricing/pricing.contracts';

// DECISION: authCheck:false skips the permission check, so this endpoint is deliberately NOT in
// BASE_PERMISSIONS (unlike newsletter/confirmations); public by design. The contract access
// PUBLIC_NO_GRANT records that fact without adding a grant.
export default defineEndpoint(PRICING_CONTRACTS.PRICING_GET_PLANS, {
  handle: async ({ req, input, res, ok }) => {
    if (req.query.currency !== undefined && input.currency === undefined) {
      respondValidationFailed(res, {
        currency: VALIDATION_MESSAGES.payment.invalidCurrency,
      });
      return;
    }
    const data = await fetchPricingPlans(input.currency);
    res.setHeader(
      'Cache-Control',
      data.is_fallback
        ? 'private, no-store'
        : 'public, s-maxage=300, stale-while-revalidate=3600'
    );
    ok(data, APP_EVENTS.INFO.PRICING.PRICING_PLANS_FETCHED);
  },
});
