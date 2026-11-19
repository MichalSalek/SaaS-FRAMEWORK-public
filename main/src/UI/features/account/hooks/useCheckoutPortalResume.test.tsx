import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { saveCheckoutPortalIntent } from '../../checkout/checkout-portal-intent';
const mock = vi.hoisted(() => ({
  replace: vi.fn(async () => true),
  profile: vi.fn(async () => ({ has_customer: true })),
  setFunnel: vi.fn(),
  userId: 'user-1',
}));
vi.mock('next/router', () => ({
  useRouter: () => ({ query: { portal: 'back' }, replace: mock.replace }),
}));
vi.mock('../../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({ data: { id: mock.userId } }),
}));
vi.mock('../../../shared/hooks/usePricingFunnelState', () => ({
  usePricingFunnelState: () => ({ setPricingFunnel: mock.setFunnel }),
}));
vi.mock('../../../../domain/account/accountIO.possibilities.api', () => ({
  getBillingProfile_IO: mock.profile,
}));
import { useCheckoutPortalResume } from './useCheckoutPortalResume';

describe('return from the tax details portal', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
    mock.userId = 'user-1';
  });
  it('refreshes the profile and resumes a fresh checkout with the same intent without confirming', async () => {
    saveCheckoutPortalIntent({
      userId: 'user-1',
      source: 'onboarding',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'year',
      billingCountry: 'CH',
      currency: 'usd',
      promo: 'WELCOME',
      createdAt: Date.now(),
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useCheckoutPortalResume(), { wrapper });
    await waitFor(() =>
      expect(mock.replace).toHaveBeenCalledWith(ROUTES_FRONT.USER_ACCOUNT_PAY)
    );
    expect(mock.profile).toHaveBeenCalledOnce();
    expect(mock.setFunnel).toHaveBeenCalledWith({
      source: 'onboarding',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'year',
      billingCountry: 'CH',
      currency: 'usd',
      promo: 'WELCOME',
    });
    expect(mock.profile.mock.invocationCallOrder[0]).toBeLessThan(
      mock.replace.mock.invocationCallOrder[0] ?? 0
    );
  });
  it('does not restore another user’s portal intent', () => {
    saveCheckoutPortalIntent({
      userId: 'user-1',
      source: 'account-pay',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      billingCountry: 'CH',
      currency: 'usd',
      createdAt: Date.now(),
    });
    mock.userId = 'user-2';
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useCheckoutPortalResume(), { wrapper });
    expect(mock.profile).not.toHaveBeenCalled();
    expect(mock.replace).not.toHaveBeenCalled();
  });
  it('does not reopen checkout if the fresh billing profile fails', async () => {
    saveCheckoutPortalIntent({
      userId: 'user-1',
      source: 'account-pay',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      billingCountry: 'CH',
      currency: 'usd',
      createdAt: Date.now(),
    });
    mock.profile.mockRejectedValueOnce(new Error('unavailable'));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCheckoutPortalResume(), { wrapper });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(mock.replace).not.toHaveBeenCalled();
    expect(mock.setFunnel).not.toHaveBeenCalled();
  });
});
