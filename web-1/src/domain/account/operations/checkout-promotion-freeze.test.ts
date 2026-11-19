import { EMAIL_OFFERS } from '@kernel/domain/stripe/stripe.config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type {
  CheckoutAttemptIntent,
  PrepareCheckout,
} from './checkout-attempt.types';

const mocks = vi.hoisted(() => ({
  prepared: vi.fn(),
  promotionList: vi.fn(),
  couponRetrieve: vi.fn(),
  usedTrial: vi.fn(),
}));

vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      user: {
        findUnique: async () => ({
          id: 'usr_test',
          email: 'test@example.test',
          stylist_account: {
            account_id: 'acc_test',
            trial_started_at: null,
            payment_status: 'UNPAID',
          },
        }),
      },
    },
  },
}));
vi.mock('@app/stripe/price-resolver.operations', () => ({
  resolveCheckoutPrice_IO: async () => ({
    success: true,
    data: { priceId: 'price_test' },
  }),
}));
vi.mock('@app/stripe/customer.operations', () => ({
  getOrCreateStripeCustomer: async () => 'cus_test',
}));
vi.mock('@app/stripe/vat-tax-rate.operations', () => ({
  getOrCreateVatTaxRate: async () => 'tax_test',
}));
vi.mock('@app/stripe/launch-offer.operations', () => ({
  getLaunchOfferCheckoutDiscount: async () => null,
}));
vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: { STRIPE_TEST_COUPON_ID: '', PUBLIC_URL: 'https://example.test' },
}));
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({
    promotionCodes: { list: mocks.promotionList },
    coupons: { retrieve: mocks.couponRetrieve },
  }),
}));
vi.mock('./checkout-attempt.database', () => ({
  recoverProviderTrial: vi.fn(),
  readOwnedAccount: async () => ({
    account_id: 'acc_test',
    stripe_customer_id: 'cus_test',
    subscription_id: null,
    subscription_status: null,
    trial_started_at: null,
    payment_status: 'UNPAID',
  }),
  attemptStore: { prepared: mocks.prepared },
}));
vi.mock('./checkout-attempt.provider', () => ({
  assertNoScopedSubscription: mocks.usedTrial,
}));
vi.mock('./checkout-attempt.operations', () => ({
  runCheckoutAttempt_IO: async ({
    intent,
    prepare,
  }: {
    intent: CheckoutAttemptIntent;
    prepare: PrepareCheckout;
  }) => {
    const { freezeAttempt } = await import('./checkout-attempt.freeze');
    const now = new Date();
    const row = {
      account_id: 'acc_test',
      attempt_id: '00000000-0000-4000-8000-000000000001',
      expires_at: new Date(now.getTime() + 3_600_000),
    } as Parameters<typeof freezeAttempt>[0];
    await freezeAttempt(
      row,
      { intent, owner: 'owner', options: () => ({}) },
      prepare
    );
    return {
      success: true,
      data: {
        session: {
          id: 'cs_test',
          client_secret: 'cs_secret',
          url: 'https://example.test/checkout',
        },
        meta: { returnUrl: 'https://example.test' },
        trialDays: intent.expectedTrialDays,
      },
    };
  },
}));

import { createEmbeddedCheckoutSession_IO } from './account-embedded-checkout.operations';
import { createHostedFallbackSession_IO } from './checkout-prepare-hosted.operations';
import { ENV_VARS } from '@app/environment/environment.config';

describe('checkout promotion after trial eligibility changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (ENV_VARS as { STRIPE_TEST_COUPON_ID: string }).STRIPE_TEST_COUPON_ID = '';
    mocks.usedTrial.mockResolvedValue({
      startedAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: null,
    });
    mocks.prepared.mockResolvedValue({});
    mocks.promotionList.mockResolvedValue({
      data: [
        {
          id: 'promo_test',
          promotion: { coupon: EMAIL_OFFERS.FIRST_MONTH.couponId },
          expires_at: null,
          max_redemptions: 1,
          times_redeemed: 0,
          customer: 'cus_test',
        },
      ],
    });
    mocks.couponRetrieve.mockResolvedValue({ valid: true, percent_off: 20 });
  });

  it.each([
    ['embedded', createEmbeddedCheckoutSession_IO],
    ['hosted', createHostedFallbackSession_IO],
  ])(
    'retains a valid first-month promotion in %s when provider history removes the trial',
    async (_mode, create) => {
      const result = await create({
        userId: 'usr_test',
        planId: PricingPlanValue.PRO,
        billingPeriod: 'month',
        promo: 'TESTCODE',
        expectedTrialDays: 0,
      });
      expect(result.success).toBe(true);
      const params = JSON.parse(
        mocks.prepared.mock.calls[0]?.[0].paramsJson as string
      );
      expect(params.subscription_data.trial_period_days).toBeUndefined();
      expect(params.discounts).toEqual([{ promotion_code: 'promo_test' }]);
    }
  );

  it('records a rejected promotion when the trial is removed', async () => {
    mocks.promotionList.mockResolvedValue({ data: [] });
    await createEmbeddedCheckoutSession_IO({
      userId: 'usr_test',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      promo: 'INVALID',
      expectedTrialDays: 0,
    });
    const saved = mocks.prepared.mock.calls[0]?.[0];
    const params = JSON.parse(saved.paramsJson as string);
    expect(params.subscription_data.trial_period_days).toBeUndefined();
    expect(params.discounts).toBeUndefined();
    expect(JSON.parse(saved.metaJson as string).promoRejected).toBe(true);
  });

  it('keeps trial checkout without consuming the promotion', async () => {
    mocks.usedTrial.mockResolvedValue(null);
    await createEmbeddedCheckoutSession_IO({
      userId: 'usr_test',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      promo: 'TESTCODE',
      expectedTrialDays: 14,
    });
    const params = JSON.parse(
      mocks.prepared.mock.calls[0]?.[0].paramsJson as string
    );
    expect(params.subscription_data.trial_period_days).toBeGreaterThan(0);
    expect(params.discounts).toBeUndefined();
    expect(mocks.promotionList).not.toHaveBeenCalled();
  });

  it('preserves QA coupon precedence after trial removal', async () => {
    (ENV_VARS as { STRIPE_TEST_COUPON_ID: string }).STRIPE_TEST_COUPON_ID =
      'coupon_qa';
    await createEmbeddedCheckoutSession_IO({
      userId: 'usr_test',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      promo: 'TESTCODE',
      expectedTrialDays: 0,
    });
    const params = JSON.parse(
      mocks.prepared.mock.calls[0]?.[0].paramsJson as string
    );
    expect(params.discounts).toEqual([{ coupon: 'coupon_qa' }]);
    expect(mocks.promotionList).not.toHaveBeenCalled();
  });
  it.each(
    ['custom', 'hosted'].flatMap(mode =>
      ['month', 'year'].flatMap(period =>
        ['pln', 'eur', 'usd'].flatMap(currency =>
          [
            PricingPlanValue.STUDIO,
            PricingPlanValue.PRO,
            PricingPlanValue.PRO_PLUS,
          ].map(planId => ({
            mode,
            period,
            currency,
            planId,
          }))
        )
      )
    )
  )(
    'freezes 14 days for $mode $period $currency $planId',
    async ({ mode, period, currency, planId }) => {
      mocks.usedTrial.mockResolvedValue(null);
      const create =
        mode === 'hosted'
          ? createHostedFallbackSession_IO
          : createEmbeddedCheckoutSession_IO;
      const result = await create({
        userId: 'usr_test',
        planId,
        billingPeriod: period as 'month' | 'year',
        currency: currency as 'pln' | 'eur' | 'usd',
        expectedTrialDays: 14,
      });
      expect(result.success).toBe(true);
      const params = JSON.parse(
        mocks.prepared.mock.calls[0]?.[0].paramsJson as string
      );
      expect(params.subscription_data.trial_period_days).toBe(14);
      expect(params.metadata.currency).toBe(currency);
    }
  );
});
