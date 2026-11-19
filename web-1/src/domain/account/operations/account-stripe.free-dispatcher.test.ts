import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

vi.mock('./account-free-selection.operations', () => ({
  selectFreePlan_IO: vi.fn(async () => ({ success: true, data: {} })),
}));
vi.mock('./checkout-attempt.operations', () => ({
  retireCheckoutAttempt_IO: vi.fn(async () => ({
    success: true,
    data: undefined,
  })),
  runCheckoutAttempt_IO: vi.fn(),
}));
vi.mock('./account-embedded-checkout.operations', () => ({
  createEmbeddedCheckoutSession_IO: vi.fn(),
}));
import { createCheckoutSession_IO } from './account-stripe.operations';
import { selectFreePlan_IO } from './account-free-selection.operations';
import { retireCheckoutAttempt_IO } from './checkout-attempt.operations';
import { createEmbeddedCheckoutSession_IO } from './account-embedded-checkout.operations';

const USER_ID = 'usr_test_0000000000000001';
describe('Free checkout dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(selectFreePlan_IO).mockResolvedValue({ success: true, data: {} });
    vi.mocked(retireCheckoutAttempt_IO).mockImplementation(
      async ({ commit }) => {
        if (commit) {
          const result = await commit({
            accountId: 'acc',
            owner: '00000000-0000-4000-8000-000000000001',
          });
          if (!result.success) {
            return result;
          }
        }
        return { success: true, data: undefined };
      }
    );
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
    expect(retireCheckoutAttempt_IO).toHaveBeenCalledWith({
      userId: USER_ID,
      commit: expect.any(Function),
    });
    expect(
      vi.mocked(retireCheckoutAttempt_IO).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(selectFreePlan_IO).mock.invocationCallOrder[0] ?? Infinity
    );
    expect(selectFreePlan_IO).toHaveBeenCalledWith({
      userId: USER_ID,
      checkoutLease: {
        accountId: 'acc',
        owner: '00000000-0000-4000-8000-000000000001',
      },
    });
    expect(createEmbeddedCheckoutSession_IO).not.toHaveBeenCalled();
  });

  it('does not select Free if retiring the outstanding attempt fails', async () => {
    vi.mocked(retireCheckoutAttempt_IO).mockResolvedValue({
      success: false,
      error: { type: 'CHECKOUT_FREE_PLAN_CONFLICT', accountId: 'acc' },
    });
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.FREE,
      billingPeriod: 'month',
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'CHECKOUT_FREE_PLAN_CONFLICT' },
    });
    expect(selectFreePlan_IO).not.toHaveBeenCalled();
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

  it('does not block FREE based on IP', async () => {
    const result = await createCheckoutSession_IO({
      userId: USER_ID,
      planId: PricingPlanValue.FREE,
      billingPeriod: 'month',
      observedCountry: 'US',
    });
    expect(result).toMatchObject({
      success: true,
      data: { mode: 'free_selected' },
    });
  });
});
