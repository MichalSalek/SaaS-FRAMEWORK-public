/**
 * SPE embedded-checkout unit tests — createEmbeddedCheckoutSession_IO.
 *
 * Mocks the resolver (priceId), customer op (stripeCustomerId) and Stripe adapter
 * (checkout.sessions.create + promotionCodes.list). DB via the global setup proxy.
 * We assert the SPE contract: returns {clientSecret, checkoutSessionId, returnUrl};
 * ui_mode='custom'; trial_period_days per kernel canStartTrial policy (never-claimed
 * trial AND payment_status UNPAID/REJECTED — ABSENT after a consumed trial and for
 * PAID subscribers); launch-offer discount (LAUNCH30_ANNUAL) auto-applied ONLY for
 * annual billing inside the launch window, QA coupon takes precedence, promo lookup
 * fail-open; plan_selected_at marker is written; the op does NOT pre-lock
 * trial_started_at (D2); null client_secret → ACCOUNT_STRIPE_ERROR.
 */

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

// ── Mock Stripe adapter: capture checkout.sessions.create params + promo lookup. ──
const sessionsCreate = vi.fn();
const promotionCodesList = vi.fn();
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: sessionsCreate } },
    promotionCodes: { list: promotionCodesList },
  }),
}));

// ── LAUNCH_OFFER: pinujemy MECHANIZM okna, nie prodowy config. ─────────────────
// Owner 2026-07-10 wyłączył ofertę przez WINDOW_DAYS=0 (okno puste), ale
// infrastruktura okna celowo zostaje na przyszłe kampanie — testy INSIDE/OUTSIDE
// dostają więc niepuste okno 90d przez partial-mock kernela (bez tego „INSIDE"
// nie istnieje i test zieleniał tylko historycznie, patrz stripe.config DECISION).
vi.mock('@kernel/domain/stripe/stripe.config', async importOriginal => {
  const orig = await importOriginal<typeof StripeConfigModule>();
  const LAUNCH_OFFER = { ...orig.LAUNCH_OFFER, WINDOW_DAYS: 90 };
  const startMs = new Date(LAUNCH_OFFER.LAUNCH_DATE).getTime();
  const endMs = startMs + LAUNCH_OFFER.WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return {
    ...orig,
    LAUNCH_OFFER,
    // Oryginalna funkcja domyka się nad modułowym getLaunchWindow (WINDOW_DAYS=0)
    // — sam podmieniony const jej nie zmienia, więc okno liczymy tu wprost.
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
    sessionsCreate.mockReset();
    promotionCodesList.mockReset();
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
    sessionsCreate.mockResolvedValue({
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

    const params = sessionsCreate.mock.calls[0]?.[0] as SessionParams;
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
    sessionsCreate.mockResolvedValue({
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
    const params = sessionsCreate.mock.calls[0]?.[0] as SessionParams;
    // Re-sub after a consumed trial → no second trial.
    expect(params.subscription_data).not.toHaveProperty('trial_period_days');
  });

  it('does NOT write plan_selected_at at mint and does NOT pre-lock trial_started_at (D2; marker removed 2026-07-10)', async () => {
    // The optimistic mint-time plan_selected_at marker was REMOVED (see NOTE in
    // the operation): an abandoned paid checkout looked like a resolved FREE
    // plan to the onboarding-plan guard. Mint must be a pure Stripe round-trip
    // with ZERO account writes — plan_selected_at is written only on genuine
    // FREE selection, trial_started_at only by the webhook.
    sessionsCreate.mockResolvedValue({
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
    sessionsCreate.mockResolvedValue({
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
    sessionsCreate.mockResolvedValue({
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
    const params = sessionsCreate.mock.calls[0]?.[0] as SessionParams;
    expect(params.subscription_data).not.toHaveProperty('trial_period_days');
  });

  it('annual billing INSIDE launch window → launch offer promotion_code applied', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(INSIDE_LAUNCH_WINDOW);
    sessionsCreate.mockResolvedValue({
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
    const params = sessionsCreate.mock.calls[0]?.[0] as SessionParams;
    expect(params.discounts).toEqual([{ promotion_code: LAUNCH_PROMO_ID }]);
  });

  it('monthly billing INSIDE launch window → NO discount (offer is annual-only)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(INSIDE_LAUNCH_WINDOW);
    sessionsCreate.mockResolvedValue({
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
    const params = sessionsCreate.mock.calls[0]?.[0] as SessionParams;
    expect(params.discounts).toBeUndefined();
  });

  it('annual billing OUTSIDE launch window → NO discount and NO promo lookup', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AFTER_LAUNCH_WINDOW);
    sessionsCreate.mockResolvedValue({
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
    const params = sessionsCreate.mock.calls[0]?.[0] as SessionParams;
    expect(params.discounts).toBeUndefined();
  });

  it('QA coupon set → QA coupon wins over launch offer (max ONE discount per session)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(INSIDE_LAUNCH_WINDOW);
    mutableEnv.STRIPE_TEST_COUPON_ID = 'coupon_qa_100';
    sessionsCreate.mockResolvedValue({
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
    const params = sessionsCreate.mock.calls[0]?.[0] as SessionParams;
    expect(params.discounts).toEqual([{ coupon: 'coupon_qa_100' }]);
  });

  it('promo lookup failure → FAIL-OPEN: checkout succeeds WITHOUT the discount', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(INSIDE_LAUNCH_WINDOW);
    promotionCodesList.mockRejectedValue(new Error('stripe 503'));
    sessionsCreate.mockResolvedValue({
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
    const params = sessionsCreate.mock.calls[0]?.[0] as SessionParams;
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
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});

// ── Kontrakt PRAWDZIWEGO kernela (poza partial-mockiem; Codex /spar S50b #5) ──
// Mock wyżej reimplementuje isLaunchOfferActive dla scenariuszy INSIDE/OUTSIDE,
// więc sam z siebie nie wykryłby zmiany semantyki produkcyjnej. Ten test pinuje
// realny stan: owner 2026-07-10 wyłączył ofertę przez WINDOW_DAYS=0 → okno jest
// PUSTE i żadna data (nawet dawne „INSIDE") nie aktywuje oferty na prodzie.
// Ożywienie kampanii (WINDOW_DAYS>0 w kernelu) celowo obleje ten test — wtedy
// zaktualizuj oczekiwania świadomie, razem z decyzją biznesową.
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
