/**
 * SPE dispatcher unit tests — createCheckoutSession_IO (plan-choice D9 union).
 *
 * Isolates the dispatcher's routing logic by mocking the leaf operations
 * (selectFreePlan_IO, createEmbeddedCheckoutSession_IO) and the feature-flag cache.
 * Asserts the discriminated-union `mode` returned per plan:
 *   FREE  → { mode:'free_selected' }            (delegates to selectFreePlan_IO)
 *   SCALE → CHECKOUT_PLAN_NOT_FOUND             (custom/contact, no self-serve)
 *   paid  → { mode:'checkout_elements', ... }   (embedded default ON)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';

// ── Mock leaf ops the dispatcher delegates to. ──────────────────────────────────
vi.mock('./account-free-selection.operations', () => ({
  selectFreePlan_IO: vi.fn(async () => ({ success: true, data: {} })),
}));
vi.mock('./account-embedded-checkout.operations', () => ({
  createEmbeddedCheckoutSession_IO: vi.fn(async () => ({
    success: true,
    data: {
      clientSecret: 'cs_secret_embedded',
      checkoutSessionId: 'cs_test_embedded',
      returnUrl:
        'http://localhost:3001/app/checkout/return?sessionId={CHECKOUT_SESSION_ID}',
    },
  })),
}));

// ── Mock feature-flags cache: default (embedded ON, hosted OFF) unless overridden. ──
const featureFlags = { value: new Map<string, boolean>() };
vi.mock('@app/feature-flags/feature-flags.cache', () => ({
  getFeatureFlags: vi.fn(async () => featureFlags.value),
}));

import { createCheckoutSession_IO } from './account-stripe.operations';
import { selectFreePlan_IO } from './account-free-selection.operations';
import { createEmbeddedCheckoutSession_IO } from './account-embedded-checkout.operations';

const USER_ID = 'usr_test_0000000000000001';

describe('createCheckoutSession_IO — SPE plan-choice dispatcher', () => {
  beforeEach(() => {
    // Reset to the documented defaults (embedded ON, hosted OFF) each test by
    // leaving the flag map EMPTY — the dispatcher applies `?? true` / `?? false`.
    featureFlags.value = new Map<string, boolean>();
    vi.mocked(selectFreePlan_IO).mockResolvedValue({ success: true, data: {} });
  });

  it('FREE → { mode:"free_selected" } via selectFreePlan_IO', async () => {
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.FREE,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('free_selected');
    }
    expect(selectFreePlan_IO).toHaveBeenCalledWith({ userId: USER_ID });
    expect(createEmbeddedCheckoutSession_IO).not.toHaveBeenCalled();
  });

  it('FREE conflict bubbles up the leaf error', async () => {
    vi.mocked(selectFreePlan_IO).mockResolvedValue({
      success: false,
      error: { type: 'CHECKOUT_FREE_PLAN_CONFLICT', accountId: 'acc_x' },
    });

    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.FREE,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CHECKOUT_FREE_PLAN_CONFLICT');
    }
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
    // Explicitly OFF for embedded AND hosted → dispatcher still defaults to embedded.
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
});
