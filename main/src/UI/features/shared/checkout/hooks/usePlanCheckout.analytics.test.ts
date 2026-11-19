import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { renderHook } from '@testing-library/react';
const state = vi.hoisted(() => ({
  mutation: vi.fn(),
  sessionCreated: vi.fn(),
  user: undefined as
    undefined | { id: string; stylist_account: { account_id: string } },
  read: vi.fn(),
  bind: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({ useMutation: state.mutation }));
vi.mock('../../../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({ data: state.user }),
}));
vi.mock(
  '../../../../../application/client-device-storage/purchase-resume',
  () => ({
    readPurchaseResume: state.read,
    bindPurchaseResumeSession: state.bind,
  })
);
vi.mock('../../../checkout/components/checkout-pay.helpers', () => ({
  payFlow: { sessionCreated: state.sessionCreated },
}));
vi.mock('../../../../../domain/account/accountIO.possibilities.api', () => ({
  checkoutSession_IO: vi.fn(),
}));
vi.mock('../../../../../application/http/io', () => ({ isIOError: vi.fn() }));
vi.mock(
  '../../../../../application/app-snackbar/appSnackbar.possibilities.api',
  () => ({ pushNewSnackbar: vi.fn() })
);
vi.mock('../../../../../application/analytics/flow-events', () => ({
  trackFlowStep: vi.fn(),
}));
import { usePlanCheckout } from './usePlanCheckout';

describe('checkout session market', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.user = undefined;
  });
  it('passes only request market metadata to the created-session event', () => {
    renderHook(() => usePlanCheckout());
    const options = state.mutation.mock.calls[0]?.[0];
    options.onSuccess(
      { mode: 'checkout_elements', clientSecret: 'secret' },
      {
        planId: PricingPlanValue.PRO,
        billingCountry: 'CA',
        currency: 'usd',
        billingPeriod: 'year',
        promo: 'private',
      }
    );
    expect(state.sessionCreated).toHaveBeenCalledWith(
      PricingPlanValue.PRO,
      'checkout_elements',
      { billingCountry: 'CA', currency: 'usd', billingPeriod: 'year' }
    );
  });
  it('binds the original intent to a reused session only for the same identity', () => {
    state.user = { id: 'user-a', stylist_account: { account_id: 'account-a' } };
    state.read.mockReturnValue({ id: 'intent-a' });
    const hook = renderHook(() => usePlanCheckout());
    const options = state.mutation.mock.calls.at(-1)?.[0];
    const context = options.onMutate();
    const response = {
      mode: 'checkout_elements',
      checkoutSessionId: 'cs_reused',
    };
    const request = { planId: PricingPlanValue.PRO, billingPeriod: 'month' };
    options.onSuccess(response, request, context);
    expect(state.bind).toHaveBeenCalledWith(
      { userId: 'user-a', accountId: 'account-a' },
      'intent-a',
      'cs_reused'
    );
    state.bind.mockClear();
    state.user = { id: 'user-b', stylist_account: { account_id: 'account-b' } };
    hook.rerender();
    options.onSuccess(response, request, context);
    expect(state.bind).not.toHaveBeenCalled();
  });
});
