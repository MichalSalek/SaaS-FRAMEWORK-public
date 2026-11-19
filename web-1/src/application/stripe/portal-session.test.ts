import { describe, expect, it } from 'vitest';
import {
  buildPortalReturnUrl,
  buildPortalSessionParams,
} from './portal-session';

describe('purpose-aware portal session', () => {
  it('manage has an explicit way back and the Nailfolio configuration', () => {
    expect(
      buildPortalSessionParams({
        customer: 'cus_owned',
        base: 'https://example.com/app',
        configuration: 'bpc_owned',
      })
    ).toEqual({
      customer: 'cus_owned',
      configuration: 'bpc_owned',
      return_url: 'https://example.com/app/user/account/plan?portal=back',
    });
  });
  it('cancel links the scoped subscription and redirects after completion', () => {
    const params = buildPortalSessionParams({
      customer: 'cus_owned',
      subscription: 'sub_owned',
      purpose: 'cancel',
      locale: 'de',
      base: 'https://example.com',
    });
    expect(params.flow_data).toEqual({
      type: 'subscription_cancel',
      subscription_cancel: { subscription: 'sub_owned' },
      after_completion: {
        type: 'redirect',
        redirect: {
          return_url:
            'https://example.com/de/app/user/account/plan?portal=canceled',
        },
      },
    });
    expect(params.return_url).toBe(
      'https://example.com/de/app/user/account/plan?portal=back'
    );
  });
  it('refuses a cancel flow without a scoped subscription', () => {
    expect(() =>
      buildPortalSessionParams({
        customer: 'cus_owned',
        purpose: 'cancel',
        base: 'https://example.com',
      })
    ).toThrow();
  });
  it('uses only the override origin, replacing stale path, query and fragment', () => {
    expect(
      buildPortalReturnUrl(
        'https://example.com/old?legacy=1#anchor',
        'back',
        'en'
      )
    ).toBe('https://example.com/en/app/user/account/plan?portal=back');
  });
});
