import type { PropsWithChildren } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { AccountPlanSectionOrganism } from './AccountPlanSection.organism';

const state = vi.hoisted(() => ({ account: {} as Record<string, unknown> }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../../hooks/useCurrentLang', () => ({
  useCurrentLang: () => 'pl',
}));
vi.mock('../../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({ data: { stylist_account: state.account } }),
}));
vi.mock('../../shared/account/hooks/useUsageStats', () => ({
  useUsageStats: () => ({}),
}));
vi.mock('../hooks/usePlanPortalReturn', () => ({
  usePlanPortalReturn: () => ({}),
}));
vi.mock('../hooks/useAccountPayActions', () => ({
  useAccountPayActions: () => ({ downgradeTarget: null }),
}));
vi.mock('./PlanDiscounts.molecule', () => ({
  PlanDiscountsMolecule: () => null,
}));
vi.mock('../../salon-profile/SalonSetupEntry.organism', () => ({
  SalonSetupEntryOrganism: () => null,
}));
vi.mock('./UsageStatsSection.organism', () => ({
  UsageStatsSectionOrganism: () => <p>usage</p>,
}));
vi.mock('./DowngradeWarningDialog.organism', () => ({
  DowngradeWarningDialogOrganism: () => null,
}));
vi.mock('../../../components/Button/LinkButton.atom', () => ({
  LinkButtonAtom: ({
    href,
    variant,
    children,
  }: PropsWithChildren<{ href: string; variant: string }>) => (
    <a href={href} data-variant={variant}>
      {children}
    </a>
  ),
}));

const account = {
  pricing_plan: PricingPlanValue.FREE,
  subscription_status: null,
  cancel_at_period_end: false,
  cancel_at: null,
  current_period_end: '2026-12-01T00:00:00.000Z',
  trial_ends_at: '2026-12-01T00:00:00.000Z',
  salon_plan: null,
};

afterEach(cleanup);

describe('plan hub actions', () => {
  it.each([
    [PricingPlanValue.FREE, null],
    [PricingPlanValue.PRO, 'ACTIVE'],
    [PricingPlanValue.PRO_PLUS, 'TRIALING'],
  ])(
    'places one upgrade link after the %s summary',
    (plan, subscriptionStatus) => {
      state.account = {
        ...account,
        pricing_plan: plan,
        subscription_status: subscriptionStatus,
      };
      render(<AccountPlanSectionOrganism showFavoriteStylists={false} />);
      const upgrade = screen.getByRole('link', { name: 'upgradePlan' });
      expect(upgrade).toHaveAttribute('href', ROUTES_FRONT.USER_ACCOUNT_PAY);
      expect(upgrade).toHaveAttribute('data-variant', 'primary');
      expect(screen.getAllByRole('link')).toHaveLength(1);
      expect(
        screen
          .getByRole('heading', { name: /^summary\./ })
          .compareDocumentPosition(upgrade) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        upgrade.compareDocumentPosition(
          screen.getByRole('heading', { name: 'includes' })
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      if (plan !== PricingPlanValue.FREE) {
        expect(
          screen.getByRole('button', { name: 'cancelPlan' })
        ).toBeInTheDocument();
      }
    }
  );

  it.each([PricingPlanValue.STUDIO, PricingPlanValue.SCALE])(
    'retains the change link for %s',
    plan => {
      state.account = {
        ...account,
        pricing_plan: plan,
        subscription_status: 'ACTIVE',
      };
      render(<AccountPlanSectionOrganism showFavoriteStylists={false} />);
      expect(
        screen.queryByRole('link', { name: 'upgradePlan' })
      ).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'changePlan' })).toHaveAttribute(
        'data-variant',
        'primary'
      );
    }
  );

  it.each([
    ['PAST_DUE', false, 'fixPayment'],
    ['ACTIVE', true, 'keepPlan'],
  ])(
    'preserves primary recovery action for %s',
    (subscriptionStatus, cancel, action) => {
      state.account = {
        ...account,
        pricing_plan: PricingPlanValue.PRO,
        subscription_status: subscriptionStatus,
        cancel_at_period_end: cancel,
      };
      render(<AccountPlanSectionOrganism showFavoriteStylists={false} />);
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'changePlan' })).toHaveAttribute(
        'data-variant',
        'outlined'
      );
      expect(
        screen.queryByRole('link', { name: 'upgradePlan' })
      ).not.toBeInTheDocument();
    }
  );

  it('does not show personal plan actions to a salon-only member', () => {
    state.account = {
      ...account,
      salon_plan: {
        pricing_plan: PricingPlanValue.STUDIO,
        salon_name: 'Salon',
      },
    };
    render(<AccountPlanSectionOrganism showFavoriteStylists={false} />);
    expect(
      screen.queryByRole('link', { name: 'upgradePlan' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'changePlan' })
    ).not.toBeInTheDocument();
  });

  it('keeps an own paid subscription manageable for a salon member', () => {
    state.account = {
      ...account,
      pricing_plan: PricingPlanValue.PRO,
      subscription_status: 'ACTIVE',
      salon_plan: {
        pricing_plan: PricingPlanValue.STUDIO,
        salon_name: 'Salon',
      },
    };
    render(<AccountPlanSectionOrganism showFavoriteStylists={false} />);
    expect(
      screen.getByRole('link', { name: 'upgradePlan' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'manageBilling' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'cancelPlan' })
    ).toBeInTheDocument();
  });
});
