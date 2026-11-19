import type { PrepareCheckout } from './checkout-attempt.types';
import type Stripe from 'stripe';
import { runCheckoutAttempt_IO } from './checkout-attempt.operations';
import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
const { prepareParams, flags } = vi.hoisted(() => ({
  prepareParams: vi.fn(),
  flags: { automaticTax: true },
}));
vi.mock('./checkout-attempt.operations', () => ({
  runCheckoutAttempt_IO: vi.fn(
    async ({ prepare }: { prepare: PrepareCheckout }) => {
      const prepared = await prepare();
      if (!prepared.success) {
        return prepared;
      }
      const session = await prepareParams(prepared.data.params);
      return { success: true, data: { session, meta: prepared.data.meta } };
    }
  ),
}));
vi.mock('@app/stripe/price-resolver.operations', () => ({
  resolveCheckoutPrice_IO: vi.fn(async () => ({
    success: true,
    data: { priceId: 'price_eur' },
  })),
}));
vi.mock('@app/stripe/customer.operations', () => ({
  getOrCreateStripeCustomer: vi.fn(async () => 'cus_1'),
}));
vi.mock('@app/stripe/vat-tax-rate.operations', () => ({
  getOrCreateVatTaxRate: vi.fn(async () => 'txr_1'),
}));
vi.mock('@app/stripe/checkout-discount.operations', () => ({
  resolveCheckoutDiscounts_IO: vi.fn(async () => ({ promoRejected: false })),
}));
vi.mock('@app/feature-flags/feature-flags.cache', () => ({
  getFeatureFlags: vi.fn(
    async () =>
      new Map([
        [FEATURE_FLAG_KEYS.CHECKOUT_ATTEMPTS_ENABLED, true],
        [FEATURE_FLAG_KEYS.STRIPE_EMBEDDED_CHECKOUT_ENABLED, false],
        [FEATURE_FLAG_KEYS.STRIPE_HOSTED_FALLBACK_ENABLED, true],
        [FEATURE_FLAG_KEYS.INTERNATIONAL_BILLING_ENABLED, true],
        [FEATURE_FLAG_KEYS.STRIPE_AUTOMATIC_TAX_ENABLED, flags.automaticTax],
      ])
  ),
}));
import { createEmbeddedCheckoutSession_IO } from './account-embedded-checkout.operations';
import { createCheckoutSession_IO } from './account-stripe.operations';
import { getOrCreateVatTaxRate } from '@app/stripe/vat-tax-rate.operations';
import { resolveCheckoutPrice_IO } from '@app/stripe/price-resolver.operations';
import { getOrCreateStripeCustomer } from '@app/stripe/customer.operations';
describe('hosted regional checkout', () => {
  it('returns a reused hosted session and frozen response metadata without preparation', async () => {
    mockDb({
      user: {
        findUnique: async () => ({
          id: 'user',
          email: 'test@example.com',
          stylist_account: {
            account_id: 'acc',
            trial_started_at: null,
            payment_status: 'UNPAID',
          },
        }),
      },
    });
    prepareParams.mockClear();
    vi.mocked(resolveCheckoutPrice_IO).mockClear();
    vi.mocked(getOrCreateStripeCustomer).mockClear();
    vi.mocked(runCheckoutAttempt_IO).mockResolvedValueOnce({
      success: true,
      data: {
        trialDays: 14,
        session: {
          id: 'cs_reused',
          url: 'https://checkout.stripe.com/reused',
        } as Stripe.Checkout.Session,
        meta: {
          returnUrl: 'https://example.test/frozen',
          billingAddressRequired: true,
          promoRejected: true,
        },
      },
    });
    const result = await createCheckoutSession_IO({
      userId: 'user',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });
    expect(result).toEqual({
      success: true,
      data: {
        trialDays: 14,
        mode: 'hosted_fallback',
        url: 'https://checkout.stripe.com/reused',
        checkoutSessionId: 'cs_reused',
        billingAddressRequired: true,
        promoRejected: true,
      },
    });
    expect(prepareParams).not.toHaveBeenCalled();
    expect(resolveCheckoutPrice_IO).not.toHaveBeenCalled();
    expect(getOrCreateStripeCustomer).not.toHaveBeenCalled();
    expect(runCheckoutAttempt_IO).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          userId: 'user',
          accountId: 'acc',
          mode: 'hosted',
        }),
        prepare: expect.any(Function),
      })
    );
  });

  it('returns the reused session and its frozen response metadata without preparation', async () => {
    mockDb({
      user: {
        findUnique: async () => ({
          id: 'user',
          email: 'test@example.com',
          stylist_account: {
            account_id: 'acc',
            trial_started_at: null,
            payment_status: 'UNPAID',
          },
        }),
      },
    });
    prepareParams.mockClear();
    vi.mocked(resolveCheckoutPrice_IO).mockClear();
    vi.mocked(runCheckoutAttempt_IO).mockResolvedValueOnce({
      success: true,
      data: {
        trialDays: 14,
        session: {
          id: 'cs_reused',
          client_secret: 'secret_reused',
        } as Stripe.Checkout.Session,
        meta: {
          returnUrl: 'https://example.test/frozen',
          billingAddressRequired: true,
          promoRejected: true,
        },
      },
    });
    const result = await createEmbeddedCheckoutSession_IO({
      userId: 'user',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });
    expect(result).toEqual({
      success: true,
      data: {
        checkoutSessionId: 'cs_reused',
        trialDays: 14,
        clientSecret: 'secret_reused',
        returnUrl: 'https://example.test/frozen',
        billingAddressRequired: true,
        promoRejected: true,
      },
    });
    expect(resolveCheckoutPrice_IO).not.toHaveBeenCalled();
    expect(getOrCreateStripeCustomer).not.toHaveBeenCalled();
    expect(prepareParams).not.toHaveBeenCalled();
    expect(resolveCheckoutPrice_IO).not.toHaveBeenCalled();
    expect(getOrCreateStripeCustomer).not.toHaveBeenCalled();
    expect(runCheckoutAttempt_IO).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          userId: 'user',
          accountId: 'acc',
          mode: 'custom',
        }),
        prepare: expect.any(Function),
      })
    );
  });

  it('rejects a hosted session without a URL', async () => {
    mockDb({
      user: {
        findUnique: async () => ({
          id: 'user',
          email: 'test@example.com',
          stylist_account: {
            account_id: 'acc',
            trial_started_at: null,
            payment_status: 'UNPAID',
          },
        }),
      },
    });
    vi.mocked(runCheckoutAttempt_IO).mockResolvedValueOnce({
      success: true,
      data: {
        trialDays: 14,
        session: { id: 'cs_no_url', url: null } as Stripe.Checkout.Session,
        meta: {
          returnUrl: 'https://example.test/frozen',
          billingAddressRequired: true,
          promoRejected: false,
        },
      },
    });
    const result = await createCheckoutSession_IO({
      userId: 'user',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'ACCOUNT_STRIPE_ERROR' },
    });
  });

  it('uses automatic tax and no manual tax rate', async () => {
    mockDb({
      user: {
        findUnique: async () => ({
          id: 'user',
          email: 'test@example.com',
          stylist_account: {
            account_id: 'acc',
            trial_started_at: null,
            payment_status: 'UNPAID',
          },
        }),
      },
    });
    prepareParams.mockResolvedValue({
      id: 'cs_1',
      url: 'https://checkout.stripe.com/test',
    });
    const result = await createCheckoutSession_IO({
      userId: 'user',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      currency: 'eur',
      billingCountry: 'DE',
    });
    expect(result).toMatchObject({
      success: true,
      data: { mode: 'hosted_fallback', billingAddressRequired: true },
    });
    expect(prepareParams.mock.calls[0]?.[0]).toMatchObject({
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      adaptive_pricing: { enabled: false },
      customer_update: { address: 'auto', name: 'auto' },
      billing_address_collection: 'required',
      line_items: [{ price: 'price_eur', quantity: 1 }],
      metadata: { currency: 'eur', billingCountry: 'DE' },
    });
    expect(
      prepareParams.mock.calls[0]?.[0].subscription_data.default_tax_rates
    ).toBeUndefined();
    expect(getOrCreateVatTaxRate).not.toHaveBeenCalled();
  });
  it('uses automatic tax for custom checkout too', async () => {
    mockDb({
      user: {
        findUnique: async () => ({
          id: 'user',
          email: 'test@example.com',
          stylist_account: {
            account_id: 'acc',
            trial_started_at: null,
            payment_status: 'UNPAID',
          },
        }),
      },
    });
    prepareParams.mockReset();
    prepareParams.mockResolvedValue({ id: 'cs_1', client_secret: 'secret' });
    const result = await createEmbeddedCheckoutSession_IO({
      userId: 'user',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      currency: 'eur',
      billingCountry: 'DE',
      automaticTax: true,
    });
    expect(result).toMatchObject({
      success: true,
      data: { billingAddressRequired: true },
    });
    expect(prepareParams.mock.calls[0]?.[0]).toMatchObject({
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      adaptive_pricing: { enabled: false },
      billing_address_collection: 'required',
      customer_update: { address: 'auto', name: 'auto' },
      metadata: { currency: 'eur', billingCountry: 'DE' },
    });
    expect(
      prepareParams.mock.calls[0]?.[0].subscription_data.default_tax_rates
    ).toBeUndefined();
  });
  it.each(['hosted', 'custom'])(
    'collects tax IDs with the manual PL tax rate in %s mode',
    async mode => {
      mockDb({
        user: {
          findUnique: async () => ({
            id: 'user',
            email: 'test@example.com',
            stylist_account: {
              account_id: 'acc',
              trial_started_at: null,
              payment_status: 'UNPAID',
            },
          }),
        },
      });
      prepareParams.mockReset();
      prepareParams.mockResolvedValue({
        id: 'cs_1',
        url: 'https://checkout.stripe.com/test',
        client_secret: 'secret',
      });
      flags.automaticTax = false;
      try {
        const args = {
          userId: 'user',
          planId: PricingPlanValue.PRO,
          billingPeriod: 'month' as const,
          currency: 'pln' as const,
          billingCountry: 'PL' as const,
        };
        const result =
          mode === 'hosted'
            ? await createCheckoutSession_IO(args)
            : await createEmbeddedCheckoutSession_IO(args);
        expect(result.success).toBe(true);
        expect(prepareParams.mock.calls[0]?.[0]).toMatchObject({
          tax_id_collection: { enabled: true },
          customer_update: { name: 'auto', address: 'auto' },
          subscription_data: { default_tax_rates: ['txr_1'] },
        });
        expect(prepareParams.mock.calls[0]?.[0].automatic_tax).toBeUndefined();
      } finally {
        flags.automaticTax = true;
      }
    }
  );
});
