import type * as ReactQuery from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { PlanCheckoutPanelTranslations } from './PlanCheckoutSession.organism';

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  eligible: true,
  unresolved: false,
  queryError: false,
  refetch: vi.fn(),
  error: null as unknown,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@tanstack/react-query', async importOriginal => ({
  ...(await importOriginal<typeof ReactQuery>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    data: state.unresolved
      ? undefined
      : {
          stylist_account: {
            trial_started_at: null,
            payment_status: state.eligible ? 'UNPAID' : 'PAID',
          },
        },
    isError: state.queryError,
    refetch: state.refetch,
  }),
}));
vi.mock('../shared/checkout/hooks/usePlanCheckout', () => ({
  usePlanCheckout: () => ({
    mutate: state.mutate,
    error: state.error,
    isError: Boolean(state.error),
    isSuccess: false,
    reset: vi.fn(),
  }),
}));
vi.mock('./StripeCustomCheckout.organism', () => ({
  StripeCustomCheckoutOrganism: () => null,
}));
vi.mock('./components/CheckoutForm.molecule', () => ({
  CheckoutFormMolecule: () => null,
}));
vi.mock('./components/ExistingPlanNotice.molecule', () => ({
  ExistingPlanNoticeMolecule: () => null,
}));
vi.mock('./ExistingSubscriptionRecovery.molecule', () => ({
  ExistingSubscriptionRecoveryMolecule: () => null,
}));
import { PlanCheckoutSessionOrganism } from './PlanCheckoutSession.organism';

const tx = {
  preparing: 'preparing',
  sessionError: 'error',
  retry: 'retry',
} as PlanCheckoutPanelTranslations;
function panel() {
  return render(
    <PlanCheckoutSessionOrganism
      planId={PricingPlanValue.PRO}
      billingPeriod='month'
      mode='account-pay'
      tx={tx}
    />
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  state.mutate.mockReset();
  state.eligible = true;
  state.unresolved = false;
  state.queryError = false;
  state.error = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe('checkout trial terms', () => {
  it.each([
    [true, 14],
    [false, 0],
  ])('sends the expected offer for eligibility %s', (eligible, days) => {
    state.eligible = eligible;
    panel();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
      expectedTrialDays: days,
    });
  });
  it('does not mint while account eligibility is unresolved', () => {
    state.unresolved = true;
    panel();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it('offers account reload when eligibility cannot be read', () => {
    state.unresolved = true;
    state.queryError = true;
    panel();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(state.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy();
  });
  it('offers a reload and does not retry the request when the offer changed', () => {
    state.error = Object.assign(new Error('terms'), {
      httpError: {
        event: APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED,
        data: {
          field: 'expectedTrialDays',
          code: 'CHECKOUT_TERMS_CHANGED',
          trialDays: 0,
        },
      },
    });
    panel();
    expect(screen.getByText('termsChanged')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'reloadOffer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'retry' })).toBeNull();
  });
});
