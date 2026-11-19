import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

const state = vi.hoisted(() => ({
  user: undefined as
    | undefined
    | {
        id: string;
        account_type: string;
        stylist_account: {
          pricing_plan: string;
          billing: {
            currency: string | null;
            pendingPayment?: { currency: string };
          } | null;
          subscription_status: string | null;
          address_country: string;
        };
      },
  country: 'PL' as string | null,
  billingCountry: null as string | null,
  marketError: false,
  marketData: true,
  refetchMarket: vi.fn(),
}));
vi.mock('../../../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({ data: state.user, isLoading: false }),
}));
vi.mock('../../../../shared/hooks/currentUser.query', () => ({
  hasSessionToken: () => false,
}));
vi.mock('../../../../shared/hooks/usePricingFunnelState', () => ({
  usePricingFunnelState: () => ({ getPricingFunnel: () => null }),
}));
vi.mock('../../location/useDetectedCountry', () => ({
  useDetectedCountry: () => ({
    data: state.marketData
      ? { country_code: state.country, international_billing_enabled: true }
      : undefined,
    isError: state.marketError,
    refetch: state.refetchMarket,
    isLoading: false,
  }),
}));
vi.mock('../../../../../domain/account/accountIO.possibilities.api', () => ({
  getBillingProfile_IO: async () => ({ country: state.billingCountry }),
}));
import { usePricingMarket } from './usePricingMarket';

function renderMarket() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePricingMarket(), { wrapper });
}

describe('pricing market', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    state.user = undefined;
    state.country = 'PL';
    state.billingCountry = null;
    state.marketError = false;
    state.marketData = true;
    state.refetchMarket.mockReset();
  });
  it('reports an unknown market as a retryable failure, not a USD restriction', async () => {
    state.marketData = false;
    state.marketError = true;
    const { result } = renderMarket();
    expect(result.current.isMarketError).toBe(true);
    expect(result.current.country).toBeNull();
    expect(result.current.currency).toBeNull();
    await result.current.refetchMarket();
    expect(state.refetchMarket).toHaveBeenCalledOnce();
  });
  it('keeps a saved PL country usable despite a failed market lookup', async () => {
    state.marketData = false;
    state.marketError = true;
    state.user = {
      id: 'one',
      account_type: 'STYLIST',
      stylist_account: {
        pricing_plan: PricingPlanValue.FREE,
        billing: null,
        subscription_status: null,
        address_country: 'PL',
      },
    };
    const { result } = renderMarket();
    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(result.current.isMarketError).toBe(false);
    expect(result.current.country).toBe('PL');
    expect(result.current.currency).toBe('pln');
  });
  it('keeps an existing locked subscription currency during market failure', async () => {
    state.marketData = false;
    state.marketError = true;
    state.user = {
      id: 'one',
      account_type: 'STYLIST',
      stylist_account: {
        pricing_plan: PricingPlanValue.PRO,
        billing: { currency: 'eur' },
        subscription_status: 'ACTIVE',
        address_country: 'DE',
      },
    };
    const { result } = renderMarket();
    await waitFor(() => expect(result.current.isResolving).toBe(false));
    expect(result.current.isMarketError).toBe(false);
    expect(result.current.isCurrencyLocked).toBe(true);
    expect(result.current.currency).toBe('eur');
  });
  it('keeps stale successful market data when its background refresh fails', () => {
    state.country = 'US';
    state.marketError = true;
    const { result } = renderMarket();
    expect(result.current.isMarketError).toBe(false);
    expect(result.current.country).toBe('US');
    expect(result.current.currency).toBe('usd');
    expect(result.current.internationalBillingEnabled).toBe(true);
  });
  it.each([
    ['PL', 'pln'],
    ['US', 'usd'],
    ['ES', 'eur'],
    ['CA', 'usd'],
    [null, 'usd'],
  ] as const)(
    'maps %s to %s independently of language',
    (country, currency) => {
      state.country = country;
      expect(renderMarket().result.current.currency).toBe(currency);
    }
  );
  it('ignores legacy manual choices and detects the current market automatically', () => {
    state.country = 'CA';
    localStorage.setItem('nf:pricing-country:guest', 'ES');
    const { result } = renderMarket();
    expect(result.current.currency).toBe('usd');
    expect(result.current.country).toBe('CA');
    expect(result.current).not.toHaveProperty('setCountry');
  });
  it.each(['ACTIVE', 'TRIALING', 'PAST_DUE', 'UNPAID', 'INCOMPLETE', 'PAUSED'])(
    'keeps the existing PLN subscription currency for %s while travelling in the US',
    async status => {
      state.country = 'US';
      state.billingCountry = 'PL';
      state.user = {
        id: 'one',
        account_type: 'STYLIST',
        stylist_account: {
          pricing_plan: PricingPlanValue.PRO,
          billing: { currency: 'pln' },
          subscription_status: status,
          address_country: 'US',
        },
      };
      const { result } = renderMarket();
      await waitFor(() => expect(result.current.currency).toBe('pln'));
      expect(result.current.isCurrencyLocked).toBe(true);
      expect(result.current.country).toBe('PL');
    }
  );
  it('locks a subscription with missing currency until billing metadata recovers', async () => {
    state.country = 'US';
    state.user = {
      id: 'one',
      account_type: 'STYLIST',
      stylist_account: {
        pricing_plan: PricingPlanValue.PRO,
        subscription_status: 'ACTIVE',
        billing: null,
        address_country: 'US',
      },
    };
    const { result, rerender } = renderMarket();
    await waitFor(() =>
      expect(result.current.isCurrencyUnavailable).toBe(true)
    );
    expect(result.current.isCurrencyLocked).toBe(true);
    expect(result.current.currency).toBeNull();
    state.user = {
      ...state.user,
      stylist_account: {
        ...state.user.stylist_account,
        billing: { currency: 'pln' },
      },
    };
    rerender();
    expect(result.current.currency).toBe('pln');
    expect(result.current.isCurrencyUnavailable).toBe(false);
  });
  it('does not lock an admin-granted plan without a subscription', async () => {
    state.country = 'US';
    state.user = {
      id: 'one',
      account_type: 'STYLIST',
      stylist_account: {
        pricing_plan: PricingPlanValue.PRO,
        subscription_status: null,
        billing: null,
        address_country: 'US',
      },
    };
    const { result } = renderMarket();
    await waitFor(() => expect(result.current.currency).toBe('usd'));
    expect(result.current.isCurrencyLocked).toBe(false);
  });
  it.each(['CANCELED', 'INCOMPLETE_EXPIRED'])(
    'allows a new local currency after terminal subscription status %s',
    async status => {
      state.country = 'US';
      state.user = {
        id: 'one',
        account_type: 'STYLIST',
        stylist_account: {
          pricing_plan: PricingPlanValue.FREE,
          subscription_status: status,
          billing: { currency: 'pln' },
          address_country: 'US',
        },
      };
      const { result } = renderMarket();
      await waitFor(() => expect(result.current.currency).toBe('usd'));
      expect(result.current.isCurrencyLocked).toBe(false);
    }
  );
  it('locks currency for a pending invoice even when no subscription status is available', async () => {
    state.country = 'US';
    state.user = {
      id: 'one',
      account_type: 'STYLIST',
      stylist_account: {
        pricing_plan: PricingPlanValue.FREE,
        subscription_status: null,
        billing: { currency: null, pendingPayment: { currency: 'pln' } },
        address_country: 'US',
      },
    };
    const { result } = renderMarket();
    await waitFor(() =>
      expect(result.current.isCurrencyUnavailable).toBe(true)
    );
    expect(result.current.isCurrencyLocked).toBe(true);
    expect(result.current.currency).toBeNull();
  });
});
