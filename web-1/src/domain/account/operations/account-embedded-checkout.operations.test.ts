import type { PrepareCheckout } from './checkout-attempt.types';

import type * as StripeConfigModule from '@kernel/domain/stripe/stripe.config';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  TRIAL_CONFIG,
  LAUNCH_OFFER,
} from '@kernel/domain/stripe/stripe.config';
import {
  PaymentStatusValue,
  type PaymentStatus,
} from '@kernel/models/db_models.generated.dto';

// ── Mock resolver: always resolve a priceId (resolution itself is tested elsewhere). ──
vi.mock('@app/stripe/price-resolver.operations', () => ({
  resolveCheckoutPrice_IO: vi.fn(async () => ({
    success: true,
    data: { priceId: 'price_pro_month' },
  })),
}));

// ── Mock customer op: hand back a stable customer id. ───────────────────────────
vi.mock('@app/stripe/customer.operations', () => ({
  getOrCreateStripeCustomer: vi.fn(async () => 'cus_test_123'),
}));

// ── Mock VAT tax rate op: hand back a stable tax rate id (get-or-create tested
// elsewhere). The op wires it into subscription_data.default_tax_rates. ─────────
vi.mock('@app/stripe/vat-tax-rate.operations', () => ({
  getOrCreateVatTaxRate: vi.fn(async () => 'txr_vat_test'),
}));

// ── Capture prepared parameters and mock the promo lookup. ──
const preparedParams = vi.fn();
const promotionCodesList = vi.fn();
const promotionRetrieve = vi.fn();
const couponRetrieve = vi.fn();
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({
    promotionCodes: { list: promotionCodesList, retrieve: promotionRetrieve },
    coupons: { retrieve: couponRetrieve },
  }),
}));

// The coordinator owns provider calls; this stub captures only its preparation callback.
vi.mock('./checkout-attempt.operations', () => ({
  runCheckoutAttempt_IO: vi.fn(
    async ({ prepare }: { prepare: PrepareCheckout }) => {
      const prepared = await prepare();
      if (!prepared.success) {
        return prepared;
      }
      const session = await preparedParams(prepared.data.params);
      return { success: true, data: { session, meta: prepared.data.meta } };
    }
  ),
}));

// The launch-offer tests pin the window mechanism, not the production config.
// WINDOW_DAYS=0 leaves the real window empty, and the window code stays for a
// later campaign. INSIDE and OUTSIDE cases get a 90-day window from this partial
// kernel mock. Without it the inside case does not exist and the test only
// passed against an older config. See the DECISION in stripe.config.ts.
vi.mock('@kernel/domain/stripe/stripe.config', async importOriginal => {
  const orig = await importOriginal<typeof StripeConfigModule>();
  const LAUNCH_OFFER = { ...orig.LAUNCH_OFFER, WINDOW_DAYS: 90 };
  const startMs = new Date(LAUNCH_OFFER.LAUNCH_DATE).getTime();
  const endMs = startMs + LAUNCH_OFFER.WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return {
    ...orig,
    LAUNCH_OFFER,
    // The original function closes over the module getLaunchWindow (WINDOW_DAYS=0).
    // Replacing the const does not change that closure, so the window is computed here.
    isLaunchOfferActive: (now: Date = new Date()): boolean => {
      const nowMs = now.getTime();
      return nowMs >= startMs && nowMs < endMs;
    },
  };
});

import { createEmbeddedCheckoutSession_IO } from './account-embedded-checkout.operations';
import { resolveCheckoutPrice_IO } from '@app/stripe/price-resolver.operations';
import { clearLaunchOfferPromoCache } from '@app/stripe/launch-offer.operations';
import { ENV_VARS } from '@app/environment/environment.config';

const USER_ID = 'usr_test_0000000000000001';
const ACCOUNT_ID = 'acc_test_0000000000000001';
const LAUNCH_PROMO_ID = 'promo_test_launch30';

// ENV_VARS is `as const` (readonly TYPE) but not runtime-frozen — the QA-coupon
// test flips it through this mutable view and afterEach restores the baseline.
const mutableEnv = ENV_VARS as { STRIPE_TEST_COUPON_ID: string };

// Dates pinned to the LAUNCH_OFFER kernel window (2026-07-15 + 90d).
const INSIDE_LAUNCH_WINDOW = new Date('2026-07-20T12:00:00.000Z');
const AFTER_LAUNCH_WINDOW = new Date('2026-12-01T12:00:00.000Z');

type SessionParams = {
  ui_mode?: string;
  mode?: string;
  subscription_data?: {
    trial_period_days?: number;
    default_tax_rates?: string[];
  };
  discounts?: Array<{ coupon?: string; promotion_code?: string }>;
};

const mockUser = (
  trialStartedAt: Date | null,
  paymentStatus: PaymentStatus = PaymentStatusValue.UNPAID
): void => {
  mockDb({
    user: {
      findUnique: async () => ({
        id: USER_ID,
        email: 'stylist@example.com',
        stylist_account: {
          account_id: ACCOUNT_ID,
          trial_started_at: trialStartedAt,
          payment_status: paymentStatus,
        },
      }),
    },
    stylistAccount: { updateMany: async () => ({ count: 1 }) },
  });
};

describe('createEmbeddedCheckoutSession_IO — SPE custom Checkout Session', () => {
  beforeEach(() => {
    preparedParams.mockReset();
    promotionCodesList.mockReset();
    promotionRetrieve.mockReset();
    promotionRetrieve.mockResolvedValue({
      promotion: { coupon: 'coupon_launch' },
    });
    couponRetrieve.mockReset();
    couponRetrieve.mockResolvedValue({ valid: true, percent_off: 30 });
    promotionCodesList.mockResolvedValue({
      data: [{ id: LAUNCH_PROMO_ID, code: LAUNCH_OFFER.PROMO_CODE }],
    });
    clearLaunchOfferPromoCache();
    vi.mocked(resolveCheckoutPrice_IO).mockResolvedValue({
      success: true,
      data: { priceId: 'price_pro_month' },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    // normalizeString maps an absent env var to '' — restore that baseline.
    mutableEnv.STRIPE_TEST_COUPON_ID = '';
  });

  it('returns {clientSecret, checkoutSessionId, returnUrl} with ui_mode=custom and trial for first-time trial', async () => {
    preparedParams.mockResolvedValue({
      id: 'cs_test_abc',
      client_secret: 'cs_secret_xyz',
    });
    mockUser(null); // never used a trial → eligible.

    const result = await createEmbeddedCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientSecret).toBe('cs_secret_xyz');
      expect(result.data.checkoutSessionId).toBe('cs_test_abc');
      expect(result.data.returnUrl).toContain(
        '/app/checkout/return?sessionId={CHECKOUT_SESSION_ID}'
      );
    }

    const params = preparedParams.mock.calls[0]?.[0] as SessionParams;
    expect(params.ui_mode).toBe('custom');
    expect(params.mode).toBe('subscription');
    // First-time trial → trial_period_days present.
    expect(params.subscription_data?.trial_period_days).toBe(
      TRIAL_CONFIG.DURATION_DAYS
    );
    // Faktura VAT: 23% stawka doliczona do subskrypcji (default_tax_rates) →
    // propagowana na każdą fakturę cykliczną.
    expect(params.subscription_data?.default_tax_rates).toEqual([
      'txr_vat_test',
    ]);
  });

  it('re-subscription after trial used (trial_started_at !== null) → NO trial_period_days', async () => {
    preparedParams.mockResolvedValue({
      id: 'cs_test_resub',
      client_secret: 'cs_secret_resub',
    });
    mockUser(new Date('2026-01-01T00:00:00.000Z')); // trial already used.

    const result = await createEmbeddedCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    const params = preparedParams.mock.calls[0]?.[0] as SessionParams;
    // Re-sub after a consumed trial → no second trial.
    expect(params.subscription_data).not.toHaveProperty('trial_period_days');
  });

  it('does NOT write plan_selected_at at mint and does NOT pre-lock trial_started_at (D2; marker removed 2026-07-10)', async () => {
    preparedParams.mockResolvedValue({
      id: 'cs_test_marker',
      client_secret: 'cs_secret_marker',
    });
    const updateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    mockDb({
      user: {
        findUnique: async () => ({
          id: USER_ID,
          email: 'stylist@example.com',
          stylist_account: { account_id: ACCOUNT_ID, trial_started_at: null },
        }),
      },
      stylistAccount: { updateMany },
    });

    const result = await createEmbeddedCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('null client_secret → ACCOUNT_STRIPE_ERROR', async () => {
    preparedParams.mockResolvedValue({
      id: 'cs_test_null',
      client_secret: null,
    });
    mockUser(null);

    const result = await createEmbeddedCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ACCOUNT_STRIPE_ERROR');
    }
  });

  it('trial_started_at null but payment_status PAID → NO trial (kernel canStartTrial policy)', async () => {
    preparedParams.mockResolvedValue({
      id: 'cs_test_paid',
      client_secret: 'cs_secret_paid',
    });
    // Active subscriber opening a second checkout: never claimed the trial,
    // but PAID must not (re)start one (free-month exploit via duplicate sub).
    mockUser(null, PaymentStatusValue.PAID);

    const result = await createEmbeddedCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    const params = preparedParams.mock.calls[0]?.[0] as SessionParams;
    expect(params.subscription_data).not.toHaveProperty('trial_period_days');
  });

  it('annual billing INSIDE launch window → launch offer promotion_code applied', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(INSIDE_LAUNCH_WINDOW);
    preparedParams.mockResolvedValue({
      id: 'cs_test_launch',
      client_secret: 'cs_secret_launch',
    });
    mockUser(null);

    const result = await createEmbeddedCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'year',
    });

    expect(result.success).toBe(true);
    expect(promotionCodesList).toHaveBeenCalledWith(
      expect.objectContaining({ code: LAUNCH_OFFER.PROMO_CODE, active: true })
    );
    const params = preparedParams.mock.calls[0]?.[0] as SessionParams;
    expect(params.discounts).toEqual([{ promotion_code: LAUNCH_PROMO_ID }]);
  });

  it('monthly billing INSIDE launch window → NO discount (offer is annual-only)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(INSIDE_LAUNCH_WINDOW);
    preparedParams.mockResolvedValue({
      id: 'cs_test_month',
      client_secret: 'cs_secret_month',
    });
    mockUser(null);

    const result = await createEmbeddedCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    expect(promotionCodesList).not.toHaveBeenCalled();
    const params = preparedParams.mock.calls[0]?.[0] as SessionParams;
    expect(params.discounts).toBeUndefined();
  });

  it('annual billing OUTSIDE launch window → NO discount and NO promo lookup', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AFTER_LAUNCH_WINDOW);
    preparedParams.mockResolvedValue({
      id: 'cs_test_expired',
      client_secret: 'cs_secret_expired',
    });
    mockUser(null);

    const result = await createEmbeddedCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'year',
    });

    expect(result.success).toBe(true);
    expect(promotionCodesList).not.toHaveBeenCalled();
    const params = preparedParams.mock.calls[0]?.[0] as SessionParams;
    expect(params.discounts).toBeUndefined();
  });

  it('QA coupon set → QA coupon wins over launch offer (max ONE discount per session)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(INSIDE_LAUNCH_WINDOW);
    mutableEnv.STRIPE_TEST_COUPON_ID = 'coupon_qa_100';
    preparedParams.mockResolvedValue({
      id: 'cs_test_qa',
      client_secret: 'cs_secret_qa',
    });
    mockUser(null);

    const result = await createEmbeddedCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'year',
    });

    expect(result.success).toBe(true);
    expect(promotionCodesList).not.toHaveBeenCalled();
    const params = preparedParams.mock.calls[0]?.[0] as SessionParams;
    expect(params.discounts).toEqual([{ coupon: 'coupon_qa_100' }]);
  });

  it('promo lookup failure → FAIL-OPEN: checkout succeeds WITHOUT the discount', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(INSIDE_LAUNCH_WINDOW);
    promotionCodesList.mockRejectedValue(new Error('stripe 503'));
    preparedParams.mockResolvedValue({
      id: 'cs_test_failopen',
      client_secret: 'cs_secret_failopen',
    });
    mockUser(null);

    const result = await createEmbeddedCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'year',
    });

    expect(result.success).toBe(true);
    const params = preparedParams.mock.calls[0]?.[0] as SessionParams;
    expect(params.discounts).toBeUndefined();
  });

  it('no stylist_account → ACCOUNT_NOT_FOUND (never calls Stripe)', async () => {
    mockDb({
      user: { findUnique: async () => ({ stylist_account: null }) },
    });

    const result = await createEmbeddedCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ACCOUNT_NOT_FOUND');
    }
    expect(preparedParams).not.toHaveBeenCalled();
  });
});

// Contract of the real kernel, outside the partial mock above.
// That mock reimplements isLaunchOfferActive, so it would not catch a production
// change. This pins the live state: WINDOW_DAYS=0 means an empty window, and no
// date (including the former "INSIDE" date) activates the offer.
// Turning the campaign back on (WINDOW_DAYS>0) fails this test on purpose.
// Update the expectation together with that business decision.
describe('kernel stripe.config — realne (niemockowane) okno LAUNCH_OFFER', () => {
  it('WINDOW_DAYS=0 → isLaunchOfferActive() false dla każdej daty', async () => {
    const real = await vi.importActual<typeof StripeConfigModule>(
      '@kernel/domain/stripe/stripe.config'
    );
    expect(real.LAUNCH_OFFER.WINDOW_DAYS).toBe(0);
    expect(real.isLaunchOfferActive(INSIDE_LAUNCH_WINDOW)).toBe(false);
    expect(real.isLaunchOfferActive(AFTER_LAUNCH_WINDOW)).toBe(false);
    expect(
      real.isLaunchOfferActive(new Date(real.LAUNCH_OFFER.LAUNCH_DATE))
    ).toBe(false);
  });
});
