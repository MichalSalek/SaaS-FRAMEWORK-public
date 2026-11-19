import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';

const accountState = vi.hoisted(() => ({
  subscriptionId: null as string | null,
  status: null as string | null,
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      user: {
        findUnique: vi.fn(async () => ({
          stylist_account: {
            account_id: 'acc',
            subscription_id: accountState.subscriptionId,
            subscription_status: accountState.status,
          },
        })),
      },
    },
  },
}));

vi.mock('./checkout-attempt.operations', () => ({
  retireCheckoutAttempt_IO: vi.fn(async () => ({
    success: true,
    data: undefined,
  })),
  runCheckoutAttempt_IO: vi.fn(),
}));

vi.mock('./account-free-selection.operations', () => ({
  selectFreePlan_IO: vi.fn(async () => ({ success: true, data: {} })),
}));
vi.mock('./account-embedded-checkout.operations', () => ({
  createEmbeddedCheckoutSession_IO: vi.fn(
    async ({ automaticTax }: { automaticTax?: boolean }) => ({
      success: true,
      data: {
        ...(automaticTax && { billingAddressRequired: true }),
        clientSecret: 'cs_secret_embedded',
        checkoutSessionId: 'cs_test_embedded',
        returnUrl:
          'http://localhost:3001/app/checkout/return?sessionId={CHECKOUT_SESSION_ID}',
      },
    })
  ),
}));

const featureFlags = { value: new Map<string, boolean>() };
vi.mock('@app/feature-flags/feature-flags.cache', () => ({
  getFeatureFlags: vi.fn(
    async () =>
      new Map([
        [FEATURE_FLAG_KEYS.CHECKOUT_ATTEMPTS_ENABLED, true],
        ...featureFlags.value,
      ])
  ),
}));

import { createCheckoutSession_IO } from './account-stripe.operations';
import { createEmbeddedCheckoutSession_IO } from './account-embedded-checkout.operations';

const USER_ID = 'usr_test_0000000000000001';

describe('createCheckoutSession_IO — SPE plan-choice dispatcher', () => {
  beforeEach(() => {
    featureFlags.value = new Map<string, boolean>();
    accountState.subscriptionId = null;
    accountState.status = null;
  });
  it('keeps new paid checkout closed until durable-attempt rollout is activated', async () => {
    featureFlags.value.set(FEATURE_FLAG_KEYS.CHECKOUT_ATTEMPTS_ENABLED, false);
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'CHECKOUT_ATTEMPT_BUSY', retryAfterSeconds: 5 },
    });
    expect(createEmbeddedCheckoutSession_IO).not.toHaveBeenCalled();
  });

  it('SCALE → CHECKOUT_PLAN_NOT_FOUND (no self-serve checkout)', async () => {
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.SCALE,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CHECKOUT_PLAN_NOT_FOUND');
    }
    expect(createEmbeddedCheckoutSession_IO).not.toHaveBeenCalled();
  });

  it('paid plan with embedded default → { mode:"checkout_elements", clientSecret }', async () => {
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.mode === 'checkout_elements') {
      expect(result.data.clientSecret).toBe('cs_secret_embedded');
      expect(result.data.checkoutSessionId).toBe('cs_test_embedded');
      expect(result.data.returnUrl).toContain('/app/checkout/return');
    } else {
      throw new Error(
        `expected checkout_elements, got ${result.success ? result.data.mode : 'failure'}`
      );
    }
    expect(createEmbeddedCheckoutSession_IO).toHaveBeenCalledTimes(1);
  });

  it('paid plan → embedded chosen even when both flags OFF (safe default)', async () => {
    featureFlags.value = new Map<string, boolean>([
      [FEATURE_FLAG_KEYS.STRIPE_EMBEDDED_CHECKOUT_ENABLED, false],
      [FEATURE_FLAG_KEYS.STRIPE_HOSTED_FALLBACK_ENABLED, false],
    ]);

    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('checkout_elements');
    }
    expect(createEmbeddedCheckoutSession_IO).toHaveBeenCalledTimes(1);
  });
  it.each([
    'ACTIVE',
    'TRIALING',
    'PAST_DUE',
    'UNPAID',
    'INCOMPLETE',
    'PAUSED',
    null,
  ])(
    'blocks a new session for an existing subscription in status %s, even when country and currency disagree',
    async status => {
      accountState.subscriptionId = 'sub_existing';
      accountState.status = status;
      featureFlags.value = new Map([
        [FEATURE_FLAG_KEYS.INTERNATIONAL_BILLING_ENABLED, true],
        [FEATURE_FLAG_KEYS.STRIPE_AUTOMATIC_TAX_ENABLED, true],
      ]);
      vi.mocked(createEmbeddedCheckoutSession_IO).mockClear();
      const result = await createCheckoutSession_IO({
        userId: USER_ID,
        planId: PricingPlanValue.PRO,
        billingPeriod: 'month',
        currency: 'eur',
        billingCountry: 'US',
      });
      expect(result).toMatchObject({
        success: false,
        error: { type: 'CHECKOUT_FREE_PLAN_CONFLICT' },
      });
      expect(createEmbeddedCheckoutSession_IO).not.toHaveBeenCalled();
    }
  );
  it('rejects an untrusted mismatched country for a new subscription', async () => {
    featureFlags.value = new Map([
      [FEATURE_FLAG_KEYS.INTERNATIONAL_BILLING_ENABLED, true],
      [FEATURE_FLAG_KEYS.STRIPE_AUTOMATIC_TAX_ENABLED, true],
    ]);
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      currency: 'eur',
      billingCountry: 'US',
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'VALIDATION_ERROR', field: 'billingCountry' },
    });
    expect(createEmbeddedCheckoutSession_IO).not.toHaveBeenCalled();
  });
  it('allows an automatically selected currency without inventing an unknown country', async () => {
    featureFlags.value = new Map([
      [FEATURE_FLAG_KEYS.INTERNATIONAL_BILLING_ENABLED, true],
      [FEATURE_FLAG_KEYS.STRIPE_AUTOMATIC_TAX_ENABLED, true],
    ]);
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      currency: 'usd',
    });
    expect(result.success).toBe(true);
    expect(createEmbeddedCheckoutSession_IO).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'usd', automaticTax: true })
    );
    expect(
      vi.mocked(createEmbeddedCheckoutSession_IO).mock.calls[0]?.[0]
    ).not.toHaveProperty('billingCountry');
  });
  it('keeps a missing-country foreign checkout behind both tax rollout gates', async () => {
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      currency: 'usd',
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'VALIDATION_ERROR' },
    });
    expect(createEmbeddedCheckoutSession_IO).not.toHaveBeenCalled();
  });
  it('blocks the hosted branch for an existing incomplete subscription', async () => {
    accountState.subscriptionId = 'sub_existing';
    accountState.status = 'INCOMPLETE';
    featureFlags.value = new Map([
      [FEATURE_FLAG_KEYS.STRIPE_EMBEDDED_CHECKOUT_ENABLED, false],
      [FEATURE_FLAG_KEYS.STRIPE_HOSTED_FALLBACK_ENABLED, true],
    ]);
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      currency: 'pln',
      billingCountry: 'PL',
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'CHECKOUT_FREE_PLAN_CONFLICT' },
    });
  });
  it.each(['CANCELED', 'INCOMPLETE_EXPIRED'])(
    'allows a fresh checkout after terminal status %s',
    async status => {
      accountState.subscriptionId = 'sub_old';
      accountState.status = status;
      const result = await createCheckoutSession_IO({
        userId: USER_ID,
        planId: PricingPlanValue.PRO,
        billingPeriod: 'month',
        currency: 'pln',
        billingCountry: 'PL',
      });
      expect(result.success).toBe(true);
    }
  );
  it('rejects foreign billing before invoking Stripe when either rollout flag is off', async () => {
    for (const flags of [
      [],
      [[FEATURE_FLAG_KEYS.INTERNATIONAL_BILLING_ENABLED, true]],
      [[FEATURE_FLAG_KEYS.STRIPE_AUTOMATIC_TAX_ENABLED, true]],
    ] as [string, boolean][][]) {
      featureFlags.value = new Map(flags);
      vi.mocked(createEmbeddedCheckoutSession_IO).mockClear();
      const result = await createCheckoutSession_IO({
        userId: USER_ID,
        planId: PricingPlanValue.PRO,
        billingPeriod: 'month',
        currency: 'eur',
        billingCountry: 'DE',
      });
      expect(result).toMatchObject({
        success: false,
        error: { type: 'VALIDATION_ERROR', field: 'billingCountry' },
      });
      expect(createEmbeddedCheckoutSession_IO).not.toHaveBeenCalled();
    }
  });
  it('passes the server-gated market and tax mode to checkout', async () => {
    featureFlags.value = new Map([
      [FEATURE_FLAG_KEYS.INTERNATIONAL_BILLING_ENABLED, true],
      [FEATURE_FLAG_KEYS.STRIPE_AUTOMATIC_TAX_ENABLED, true],
    ]);
    await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      currency: 'eur',
      billingCountry: 'DE',
    });
    expect(createEmbeddedCheckoutSession_IO).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'eur',
        billingCountry: 'DE',
        automaticTax: true,
      })
    );
  });
  it('blocks legacy requests from an observed foreign country before Stripe', async () => {
    vi.mocked(createEmbeddedCheckoutSession_IO).mockClear();
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      observedCountry: 'US',
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'VALIDATION_ERROR', field: 'billingCountry' },
    });
    expect(createEmbeddedCheckoutSession_IO).not.toHaveBeenCalled();
  });
  it('allows an explicitly selected PL country when the IP is foreign', async () => {
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      currency: 'pln',
      billingCountry: 'PL',
      observedCountry: 'US',
    });
    expect(result).toMatchObject({
      success: true,
      data: { mode: 'checkout_elements' },
    });
  });
  it('retains PLN for legacy foreign visitors when rollout is enabled', async () => {
    featureFlags.value = new Map([
      [FEATURE_FLAG_KEYS.INTERNATIONAL_BILLING_ENABLED, true],
      [FEATURE_FLAG_KEYS.STRIPE_AUTOMATIC_TAX_ENABLED, true],
    ]);
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      observedCountry: 'US',
    });
    expect(result).toMatchObject({
      success: true,
      data: { billingAddressRequired: true },
    });
    expect(createEmbeddedCheckoutSession_IO).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'pln', automaticTax: true })
    );
  });
  it('reports that Polish automatic-tax checkout needs an address', async () => {
    featureFlags.value = new Map([
      [FEATURE_FLAG_KEYS.STRIPE_AUTOMATIC_TAX_ENABLED, true],
    ]);
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      currency: 'pln',
      billingCountry: 'PL',
    });
    expect(result).toMatchObject({
      success: true,
      data: { billingAddressRequired: true },
    });
  });
});
