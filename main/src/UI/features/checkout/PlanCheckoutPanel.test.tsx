import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { useState } from 'react';
import type { PlanCheckoutPanelTranslations } from './PlanCheckoutSession.organism';
const state = vi.hoisted(() => ({
  retry: vi.fn(),
  open: vi.fn(),
  market: {} as Record<string, unknown>,
  user: {} as Record<string, unknown>,
  mounts: 0,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../shared/location/CountrySelect.molecule', () => ({
  CountrySelectMolecule: () => null,
}));
vi.mock('../shared/pricing/hooks/usePricingPlans', () => ({
  usePricingPlans: () => state.market,
}));
vi.mock('../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({ data: state.user }),
}));
vi.mock('./ExistingSubscriptionRecovery.molecule', () => ({
  ExistingSubscriptionRecoveryMolecule: () => (
    <div>
      existingSubscriptionRecovery<button>resumeExistingPayment</button>
    </div>
  ),
}));
vi.mock('./components/ExistingPlanNotice.molecule', () => ({
  ExistingPlanNoticeMolecule: () => <div>existing plan</div>,
}));
vi.mock('./hooks/useCheckoutTaxPortal', () => ({
  useCheckoutTaxPortal: () => ({
    open: state.open,
    busy: false,
    failed: false,
  }),
}));
vi.mock('./PlanCheckoutSession.organism', () => ({
  PlanCheckoutSessionOrganism: ({
    currency,
    billingCountry,
    billingProfile,
    billingProfileUnverified,
  }: {
    currency?: string;
    billingCountry?: string;
    billingProfile?: { country?: string | null; tax_ids?: unknown[] };
    billingProfileUnverified?: boolean;
  }) => {
    const [mount] = useState(() => ++state.mounts);
    return (
      <div
        data-testid='session'
        data-mount={mount}
        data-currency={currency}
        data-country={billingCountry}
        data-profile-country={billingProfile?.country ?? ''}>
        <span
          data-testid='fiscal-state'
          data-ids={billingProfile?.tax_ids?.length ?? 0}
          data-unverified={String(Boolean(billingProfileUnverified))}
        />
        session
      </div>
    );
  },
}));
import { PlanCheckoutPanelOrganism } from './PlanCheckoutPanel.organism';
const tx = {
  preparing: 'preparing',
  sessionError: 'profile error',
  retry: 'retry',
} as PlanCheckoutPanelTranslations;
function panel() {
  return render(
    <PlanCheckoutPanelOrganism
      planId={PricingPlanValue.PRO}
      billingPeriod='month'
      mode='account-pay'
      tx={tx}
    />
  );
}
function element(period: 'month' | 'year' = 'month') {
  return (
    <PlanCheckoutPanelOrganism
      planId={PricingPlanValue.PRO}
      billingPeriod={period}
      mode='account-pay'
      tx={tx}
    />
  );
}
beforeEach(() => {
  state.retry.mockClear();
  state.open.mockClear();
  state.user = { id: 'user-a' };
  state.mounts = 0;
  state.market = {
    country: 'DE',
    currency: 'eur',
    isCurrencyLocked: false,
    isCurrencyUnavailable: false,
    isResolving: false,
    isPending: false,
    isError: false,
    billingProfile: { isError: false, data: { country: 'DE', tax_ids: [] } },
    refetchMarket: state.retry,
    data: [{ id: PricingPlanValue.PRO, priceMonthly: 6000 }],
    internationalBillingEnabled: true,
  };
});
describe('checkout preflight', () => {
  it('offers market lookup retry without claiming payments are unavailable', () => {
    state.market = {
      ...state.market,
      country: null,
      currency: null,
      isMarketError: true,
      isError: true,
      internationalBillingEnabled: false,
    };
    const view = panel();
    expect(view.getByRole('alert')).toHaveTextContent('profile error');
    expect(view.queryByText('marketUnavailable')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });
  it('starts a new session for another signed-in person but keeps it on a same-person role refresh', () => {
    const view = render(element());
    const original = view.getByTestId('session');
    state.user = { id: 'user-a', role_id: 'changed-role' };
    view.rerender(element());
    expect(view.getByTestId('session')).toBe(original);
    state.user = {};
    view.rerender(element());
    expect(view.queryByTestId('session')).toBeNull();
    state.user = { id: 'user-b' };
    state.market = { ...state.market, country: 'US', currency: 'usd' };
    view.rerender(element());
    expect(view.getByTestId('session')).not.toBe(original);
    expect(view.getByTestId('session')).toHaveAttribute('data-currency', 'usd');
  });
  it('keeps one session and its original market while a billing profile refetch changes country and currency', () => {
    state.market = {
      ...state.market,
      country: 'PL',
      currency: 'pln',
      billingProfile: { isError: false, data: { country: 'PL', tax_ids: [] } },
    };
    const view = render(element());
    const original = view.getByTestId('session');
    expect(original).toHaveAttribute('data-currency', 'pln');
    state.market = {
      ...state.market,
      isPending: true,
      isResolving: true,
      country: 'US',
      currency: null,
    };
    view.rerender(element());
    expect(view.getByTestId('session')).toBe(original);
    state.market = {
      ...state.market,
      isPending: false,
      isResolving: false,
      country: 'US',
      currency: 'usd',
      billingProfile: { isError: false, data: { country: 'US', tax_ids: [] } },
    };
    view.rerender(element());
    expect(view.getByTestId('session')).toBe(original);
    expect(original).toHaveAttribute('data-country', 'PL');
    expect(original).toHaveAttribute('data-currency', 'pln');
    expect(original).toHaveAttribute('data-profile-country', 'US');
    expect(state.mounts).toBe(1);
  });
  it('keeps the session mounted while refreshing saved fiscal IDs and blocks on a read failure', () => {
    const view = render(element());
    const original = view.getByTestId('session');
    state.market.billingProfile = {
      isError: false,
      isFetching: false,
      data: { country: 'DE', tax_ids: [{ type: 'eu_vat', value: 'DE123' }] },
    };
    view.rerender(element());
    expect(view.getByTestId('session')).toBe(original);
    expect(view.getByTestId('fiscal-state')).toHaveAttribute('data-ids', '1');
    expect(view.getByTestId('session')).toHaveAttribute('data-currency', 'eur');
    state.market.billingProfile = {
      isError: false,
      isFetching: true,
      data: { country: 'DE', tax_ids: [{ type: 'eu_vat', value: 'DE123' }] },
    };
    view.rerender(element());
    expect(view.getByTestId('session')).toBe(original);
    expect(view.getByTestId('fiscal-state')).toHaveAttribute(
      'data-unverified',
      'true'
    );
    state.market.billingProfile = { isError: true, isFetching: false };
    view.rerender(element());
    expect(view.getByTestId('session')).toBe(original);
    expect(view.getByTestId('fiscal-state')).toHaveAttribute(
      'data-unverified',
      'true'
    );
    fireEvent.click(view.getByRole('button', { name: 'retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
    state.market.billingProfile = {
      isError: false,
      isFetching: false,
      data: { country: 'DE', tax_ids: [{ type: 'eu_vat', value: 'DE123' }] },
    };
    view.rerender(element());
    expect(view.getByTestId('session')).toBe(original);
    expect(view.getByTestId('fiscal-state')).toHaveAttribute(
      'data-unverified',
      'false'
    );
  });
  it('chooses a fresh snapshot after the billing period changes', () => {
    state.market.data = [
      { id: PricingPlanValue.PRO, priceMonthly: 6000, priceYearlyTotal: 50000 },
    ];
    const view = render(element());
    const original = view.getByTestId('session');
    state.market = { ...state.market, country: 'US', currency: 'usd' };
    view.rerender(element('year'));
    expect(view.getByTestId('session')).not.toBe(original);
    expect(view.getByTestId('session')).toHaveAttribute('data-currency', 'usd');
  });
  it('keeps free activation independent from unresolved paid markets', () => {
    state.market.isResolving = true;
    const view = render(
      <PlanCheckoutPanelOrganism
        planId={PricingPlanValue.FREE}
        billingPeriod='month'
        mode='account-pay'
        tx={tx}
      />
    );
    expect(view.getByText('session')).toBeDefined();
  });
  it('does not treat an unreadable Stripe profile as an empty one', () => {
    state.market.billingProfile = { isError: true };
    const view = panel();
    expect(view.queryByText('session')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });
  it('leaves fiscal review to the actual address in the payment form instead of adding a country step', () => {
    state.market.billingProfile = {
      isError: false,
      data: { country: 'PL', tax_ids: [{ type: 'eu_vat', value: 'PL123' }] },
    };
    const view = panel();
    expect(view.getByText('session')).toBeDefined();
    expect(view.queryByRole('combobox')).toBeNull();
    expect(state.open).not.toHaveBeenCalled();
  });
  it('continues with the automatically selected currency even if detection has no country hint', () => {
    state.market.country = null;
    state.market.currency = 'usd';
    const view = panel();
    expect(view.getByText('session')).toBeDefined();
    expect(view.queryByRole('combobox')).toBeNull();
  });
  it('keeps same-country company details editable in checkout', () => {
    state.market.billingProfile = {
      isError: false,
      data: { country: 'DE', tax_ids: [{ type: 'eu_vat', value: 'PL123' }] },
    };
    expect(panel().getByText('session')).toBeDefined();
  });
  it('does not mint for a locked EUR subscription with a US address and offers its existing invoice', () => {
    state.market.isCurrencyLocked = true;
    state.market.country = 'US';
    state.user = {
      id: 'user-a',
      stylist_account: {
        billing: {
          pendingPayment: { url: 'https://invoice.stripe.com/i/owned/in_1' },
        },
      },
    };
    const view = panel();
    expect(view.queryByText('session')).toBeNull();
    expect(view.getByText('existingSubscriptionRecovery')).toBeDefined();
    expect(
      view.getByRole('button', { name: 'resumeExistingPayment' })
    ).toBeDefined();
  });
});
