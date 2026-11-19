import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { readCheckoutPortalIntent } from '../checkout-portal-intent';
const create = vi.hoisted(() =>
  vi.fn(async () => ({ url: 'https://billing.stripe.com/test' }))
);
vi.mock('../../../../domain/account/accountIO.possibilities.api', () => ({
  createPortalSession_IO: create,
}));
import { prepareCheckoutTaxPortal } from './useCheckoutTaxPortal';

describe('pre-purchase tax portal intent', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    create.mockClear();
  });
  it('opens the existing billing portal and saves the full purchase intent first', async () => {
    const intent = {
      userId: 'owner',
      source: 'onboarding' as const,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'year' as const,
      billingCountry: 'CH' as const,
      currency: 'usd' as const,
      promo: 'CODE',
    };
    const url = await prepareCheckoutTaxPortal(intent, 'en', () => true);
    expect(url).toBe('https://billing.stripe.com/test');
    expect(create).toHaveBeenCalledWith({ purpose: 'manage', locale: 'en' });
    expect(readCheckoutPortalIntent('owner')).toMatchObject(intent);
  });
  it('does not persist an intent when the user already left the checkout', async () => {
    const intent = {
      userId: 'owner',
      source: 'account-pay' as const,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month' as const,
      billingCountry: 'CH' as const,
      currency: 'usd' as const,
    };
    expect(
      await prepareCheckoutTaxPortal(intent, 'pl', () => false)
    ).toBeNull();
    expect(readCheckoutPortalIntent('owner')).toBeNull();
  });
});
