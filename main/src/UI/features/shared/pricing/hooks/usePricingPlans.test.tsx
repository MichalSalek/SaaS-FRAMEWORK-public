import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type { BillingCurrency } from '@kernel/domain/localization/country.config';

const state = vi.hoisted(() => ({
  currency: 'usd' as BillingCurrency | null,
  unavailable: false,
  requests: [] as string[],
  refetchMarket: vi.fn(async () => {}),
  resolveUsd: undefined as ((value: unknown) => void) | undefined,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./usePricingMarket', () => ({
  usePricingMarket: () => ({
    currency: state.currency,
    isResolving: false,
    isCurrencyUnavailable: state.unavailable,
    refetchMarket: state.refetchMarket,
  }),
}));
vi.mock('../../../../../domain/pricing/pricingIO.possibilities.api', () => ({
  getPricingPlans_IO: ({ currency }: { currency: string }) => {
    state.requests.push(currency);
    return currency === 'usd'
      ? new Promise(resolve => {
          state.resolveUsd = resolve;
        })
      : Promise.resolve({
          currency,
          is_fallback: false,
          plans: [
            {
              plan_id: PricingPlanValue.PRO,
              monthly_price: 2900,
              yearly_monthly_price: 2300,
              yearly_total: 27600,
            },
          ],
        });
  },
}));
import { usePricingPlans } from './usePricingPlans';

describe('pricing query currency isolation', () => {
  it('ignores a late USD response after the country changes to EUR', async () => {
    state.currency = 'usd';
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(() => usePricingPlans(), {
      wrapper,
    });
    await waitFor(() => expect(state.resolveUsd).toBeDefined());
    state.currency = 'eur';
    rerender();
    await waitFor(() =>
      expect(
        result.current.data?.find(p => p.id === PricingPlanValue.PRO)
          ?.priceMonthly
      ).toBe(2900)
    );
    state.resolveUsd?.({
      currency: 'usd',
      is_fallback: false,
      plans: [
        {
          plan_id: PricingPlanValue.PRO,
          monthly_price: 1900,
          yearly_monthly_price: 1500,
          yearly_total: 18000,
        },
      ],
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(result.current.currency).toBe('eur');
    expect(
      result.current.data?.find(p => p.id === PricingPlanValue.PRO)
        ?.priceMonthly
    ).toBe(2900);
    expect(
      result.current.data?.find(p => p.id === PricingPlanValue.PRO)
        ?.priceYearlyTotal
    ).toBe(27600);
  });
  it('never requests fallback prices while a locked currency is unavailable, including retry', async () => {
    state.currency = null;
    state.unavailable = true;
    state.requests.length = 0;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(() => usePricingPlans(), {
      wrapper,
    });
    expect(result.current.isError).toBe(true);
    expect(result.current.isPending).toBe(false);
    await act(async () => {
      await result.current.refetch();
    });
    expect(state.refetchMarket).toHaveBeenCalled();
    expect(state.requests).toEqual([]);
    state.currency = 'pln';
    state.unavailable = false;
    rerender();
    await waitFor(() => expect(state.requests).toEqual(['pln']));
  });
});
