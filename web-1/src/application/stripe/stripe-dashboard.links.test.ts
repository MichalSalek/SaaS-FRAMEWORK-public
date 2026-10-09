import { describe, expect, it } from 'vitest';
import { stripeDashboardLinkProp } from './stripe-dashboard.links';

describe('stripeDashboardLinkProp', () => {
  it('links a string id or an expanded object', () => {
    expect(stripeDashboardLinkProp('disputes', 'dp_1')).toEqual({
      link: {
        label: 'Otwórz w panelu Stripe',
        url: 'https://dashboard.stripe.com/disputes/dp_1',
      },
    });
    expect(
      stripeDashboardLinkProp('customers', { id: 'cus_1' }).link?.url
    ).toBe('https://dashboard.stripe.com/customers/cus_1');
  });

  it('gives no link without an id', () => {
    expect(stripeDashboardLinkProp('customers', null)).toEqual({});
    expect(stripeDashboardLinkProp('customers', '')).toEqual({});
  });
});
