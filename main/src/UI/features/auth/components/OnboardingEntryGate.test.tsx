import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { OnboardingEntryGateMolecule } from './OnboardingEntryGate.molecule';

const state = vi.hoisted(() => ({
  router: {
    isReady: true,
    query: {} as Record<string, string>,
    replace: vi.fn(),
  },
  account: {
    data: undefined as Record<string, unknown> | undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  },
  sessionPending: false,
  funnel: null as null | { planId: string; billingPeriod: string },
}));

vi.mock('next/router', () => ({ useRouter: () => state.router }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../../../application/auth/better-auth-client', () => ({
  authClient: { useSession: () => ({ isPending: state.sessionPending }) },
}));
vi.mock('../../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => state.account,
}));
vi.mock('../../../shared/hooks/usePricingFunnelState', () => ({
  usePricingFunnelState: () => ({ getPricingFunnel: () => state.funnel }),
}));
vi.mock('../../../layouts/AppLayout.composition', () => ({
  AppLayoutComposition: ({ children }: { children: ReactNode }) => (
    <main>{children}</main>
  ),
}));

const resolvedStylist = () => ({
  account_type: 'STYLIST',
  client_account: null,
  stylist_account: {
    pricing_plan: PricingPlanValue.STUDIO,
    payment_status: 'PAID',
    subscription_id: 'sub_trial',
    subscription_status: 'TRIALING',
    admin_plan_override: false,
    plan_selected_at: '2026-09-08T21:56:12.178Z',
  },
});
const flow = (
  <OnboardingEntryGateMolecule>
    <p>new-account-flow</p>
  </OnboardingEntryGateMolecule>
);

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.router.isReady = true;
  state.router.query = {};
  state.account.data = undefined;
  state.account.isLoading = false;
  state.account.isFetching = false;
  state.account.isError = false;
  state.sessionPending = false;
  state.funnel = null;
});

describe('onboarding re-entry for an existing account', () => {
  it('resumes the existing trial without exposing the Free checkout', async () => {
    state.account.data = resolvedStylist();
    render(flow);
    await waitFor(() =>
      expect(state.router.replace).toHaveBeenCalledWith(ROUTES_FRONT.APP)
    );
    expect(screen.queryByText('new-account-flow')).toBeNull();
  });

  it('preserves explicit paid-plan intent for the billing page', async () => {
    state.account.data = resolvedStylist();
    state.router.query = { role: 'stylist' };
    state.funnel = { planId: PricingPlanValue.STUDIO, billingPeriod: 'month' };
    render(flow);
    await waitFor(() =>
      expect(state.router.replace).toHaveBeenCalledWith(
        ROUTES_FRONT.USER_ACCOUNT_PAY
      )
    );
    expect(state.funnel).toEqual({
      planId: PricingPlanValue.STUDIO,
      billingPeriod: 'month',
    });
  });

  it('waits for session, router and account refetch before deciding', async () => {
    state.account.data = resolvedStylist();
    state.sessionPending = true;
    const view = render(flow);
    expect(state.router.replace).not.toHaveBeenCalled();
    state.sessionPending = false;
    state.router.isReady = false;
    view.rerender(flow);
    expect(state.router.replace).not.toHaveBeenCalled();
    state.router.isReady = true;
    state.account.isFetching = true;
    view.rerender(flow);
    expect(state.router.replace).not.toHaveBeenCalled();
    state.account.isFetching = false;
    view.rerender(
      <OnboardingEntryGateMolecule>
        <p>new-account-flow</p>
      </OnboardingEntryGateMolecule>
    );
    await waitFor(() =>
      expect(state.router.replace).toHaveBeenCalledWith(ROUTES_FRONT.APP)
    );
  });

  it('admits a new account and does not redirect when that same flow resolves its plan', async () => {
    state.account.data = {
      account_type: 'CLIENT',
      client_account: null,
      stylist_account: null,
    };
    const view = render(flow);
    await screen.findByText('new-account-flow');
    state.account.data = resolvedStylist();
    view.rerender(
      <OnboardingEntryGateMolecule>
        <p>new-account-flow</p>
      </OnboardingEntryGateMolecule>
    );
    expect(screen.getByText('new-account-flow')).toBeTruthy();
    expect(state.router.replace).not.toHaveBeenCalled();
  });

  it('keeps an unresolved Free account in onboarding', async () => {
    state.account.data = {
      ...resolvedStylist(),
      stylist_account: {
        pricing_plan: PricingPlanValue.FREE,
        payment_status: 'UNPAID',
        subscription_id: null,
        subscription_status: null,
        admin_plan_override: false,
        plan_selected_at: null,
      },
    };
    render(flow);
    await screen.findByText('new-account-flow');
    expect(state.router.replace).not.toHaveBeenCalled();
  });

  it('allows adding a missing client role even when a Studio subscription exists', async () => {
    state.account.data = resolvedStylist();
    state.router.query = { role: 'client' };
    render(flow);
    await screen.findByText('new-account-flow');
    expect(state.router.replace).not.toHaveBeenCalled();
  });

  it('shows a retryable read error without exposing the role mutation', () => {
    state.account.isError = true;
    render(flow);
    expect(screen.getByRole('alert').textContent).toContain('accountLoadError');
    expect(screen.getByRole('button', { name: 'retry' })).toBeTruthy();
    expect(screen.queryByText('new-account-flow')).toBeNull();
  });
});
