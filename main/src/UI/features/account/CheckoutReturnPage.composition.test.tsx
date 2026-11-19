import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  result: vi.fn(),
  proof: null as unknown,
}));
vi.mock('next/router', () => ({
  useRouter: () => ({ isReady: true, query: state.query }),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../../application/http/io', () => ({
  contractEndpoint: () => state.result,
}));
vi.mock(
  '../../../application/client-device-storage/purchase-change-proof',
  () => ({ readPurchaseChangeProof: () => state.proof })
);
vi.mock('../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    data: {
      id: 'user-a',
      stylist_account: {
        account_id: 'account-a',
        pricing_plan: PricingPlanValue.PRO,
        subscription_status: 'ACTIVE',
        cancel_at_period_end: false,
        cancel_at: null,
        billing: { billingPeriod: 'monthly' },
      },
    },
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('../../layouts/AppLayout.composition', () => ({
  AppLayoutComposition: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('../../components/AppHero/useReportHeroVisibility', () => ({
  useReportHeroVisibility: vi.fn(),
}));
vi.mock('./CheckoutSuccess.organism', () => ({
  CheckoutSuccessOrganism: ({
    plan,
    resume,
  }: {
    plan: string;
    resume: { sessionId: string };
  }) => (
    <div>
      confirmed {plan} {resume.sessionId}
    </div>
  ),
}));
vi.mock('../../components/Skeleton/Skeleton.atom', () => ({
  SkeletonAtom: () => <span />,
}));
vi.mock('../../components/Button/LinkButton.atom', () => ({
  LinkButtonAtom: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}));
vi.mock('../../components/Button/Button.atom', () => ({
  ButtonAtom: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));
vi.mock('../../components/ErrorState/ErrorState.molecule', () => ({
  ErrorStateMolecule: () => <div>error</div>,
}));
import { CheckoutReturnPageComposition } from './CheckoutReturnPage.composition';

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CheckoutReturnPageComposition />
    </QueryClientProvider>
  );
}
afterEach(cleanup);
beforeEach(() => {
  state.query = {};
  state.result.mockReset();
  state.proof = null;
});
describe('checkout return ownership', () => {
  it('waits for the owned session instead of trusting URL and current plan', async () => {
    state.query = {
      sessionId: 'cs_test_a',
      plan: PricingPlanValue.PRO,
      period: 'month',
    };
    let resolve!: (value: unknown) => void;
    state.result.mockReturnValue(
      new Promise(r => {
        resolve = r;
      })
    );
    mount();
    expect(screen.queryByText(/confirmed PRO/)).not.toBeInTheDocument();
    resolve({
      status: 'confirmed',
      target: { planId: PricingPlanValue.PRO, billingPeriod: 'month' },
    });
    expect(
      await screen.findByText('confirmed PRO cs_test_a')
    ).toBeInTheDocument();
    expect(state.result).toHaveBeenCalledWith(
      { sessionId: 'cs_test_a' },
      { signal: expect.any(AbortSignal) }
    );
  });
  it('keeps an expired owned session neutral even if the plan already matches', async () => {
    state.query = { sessionId: 'cs_test_a', plan: PricingPlanValue.PRO };
    state.result.mockResolvedValue({
      status: 'expired',
      target: { planId: PricingPlanValue.PRO, billingPeriod: 'month' },
    });
    mount();
    expect(await screen.findByText('pendingTitle')).toBeInTheDocument();
    expect(screen.queryByText(/confirmed PRO/)).not.toBeInTheDocument();
  });
  it('rejects a direct change URL without operation proof', async () => {
    state.query = {
      change: 'completed',
      plan: PricingPlanValue.PRO,
      period: 'month',
    };
    mount();
    expect(await screen.findByText('pendingTitle')).toBeInTheDocument();
    expect(state.result).not.toHaveBeenCalled();
  });
  it('accepts a direct change only with operation proof and matching current entitlement', async () => {
    state.query = {
      change: 'completed',
      proof: 'change_token',
      plan: 'STUDIO',
      period: 'year',
    };
    state.proof = { plan: PricingPlanValue.PRO, period: 'month' };
    mount();
    expect(
      await screen.findByText('confirmed PRO change_token')
    ).toBeInTheDocument();
    expect(state.result).not.toHaveBeenCalled();
  });
});
