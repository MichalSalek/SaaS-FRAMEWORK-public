import { isCountryCode } from '@kernel/domain/localization/country.config';

/** Detected or stored billing country is a market hint, not proof of residence. */
export interface BillingMarketAnalytics {
  billingCountry?: string | null | undefined;
  currency?: string | null | undefined;
  billingPeriod?: string | null | undefined;
}

export function billingMarketProperties(market?: BillingMarketAnalytics) {
  const country = market?.billingCountry?.trim().toUpperCase();
  const currency = market?.currency?.trim().toUpperCase();
  const period = market?.billingPeriod;
  return {
    ...(country && country !== 'XK' && isCountryCode(country)
      ? { billing_country: country }
      : {}),
    ...(currency && ['PLN', 'USD', 'EUR'].includes(currency)
      ? { currency }
      : {}),
    ...(period === 'month' || period === 'year'
      ? { billing_period: period }
      : {}),
  };
}
