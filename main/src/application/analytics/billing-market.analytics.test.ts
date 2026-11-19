import { describe, expect, it } from 'vitest';
import { billingMarketProperties } from './billing-market.analytics';

describe('billing market analytics', () => {
  it('keeps country and actual currency independent', () => {
    expect(
      billingMarketProperties({
        billingCountry: 'CA',
        currency: 'usd',
        billingPeriod: 'year',
      })
    ).toEqual({
      billing_country: 'CA',
      currency: 'USD',
      billing_period: 'year',
    });
    expect(
      billingMarketProperties({ billingCountry: 'DE', currency: 'usd' })
    ).toEqual({ billing_country: 'DE', currency: 'USD' });
  });
  it('omits invalid and missing values rather than inferring them', () => {
    expect(
      billingMarketProperties({
        billingCountry: 'ZZ',
        currency: 'cad',
        billingPeriod: 'week',
      })
    ).toEqual({});
    expect(billingMarketProperties({ billingCountry: 'CA' })).toEqual({
      billing_country: 'CA',
    });
    expect(billingMarketProperties({ billingCountry: 'XK' })).toEqual({});
    expect(billingMarketProperties({})).toEqual({});
  });
});
