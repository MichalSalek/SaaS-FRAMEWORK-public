import { defineEndpoint } from '@app/http/define-endpoint';
import { detectRequestCountry } from '@app/localization/country.detector';
import { getFeatureFlags } from '@app/feature-flags/feature-flags.cache';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { currencyForCountry } from '@kernel/domain/localization/country.config';
import { PRICING_CONTRACTS } from '@kernel/domain/pricing/pricing.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

export default defineEndpoint(PRICING_CONTRACTS.PRICING_GET_MARKET, {
  handle: async ({ req, res, ok }) => {
    const country = detectRequestCountry(req.headers);
    const flags = await getFeatureFlags();
    res.setHeader('Cache-Control', 'private, no-store');
    ok(
      {
        country_code: country,
        currency: currencyForCountry(country),
        source: country ? 'ip' : 'fallback',
        international_billing_enabled:
          (flags.get(FEATURE_FLAG_KEYS.INTERNATIONAL_BILLING_ENABLED) ??
            false) &&
          (flags.get(FEATURE_FLAG_KEYS.STRIPE_AUTOMATIC_TAX_ENABLED) ?? false),
      },
      APP_EVENTS.INFO.PRICING.PRICING_PLANS_FETCHED
    );
  },
});
