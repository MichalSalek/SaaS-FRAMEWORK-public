import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import plMessages from '../../../locales/pl/common.json';
import enMessages from '../../../locales/en/common.json';
import deMessages from '../../../locales/de/common.json';
import { TRIAL_CONFIG } from '@kernel/domain/stripe/stripe.config';
import { resolveTrialMessages } from '@kernel/domain/stripe/trial-policy-text';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { PricingTierSectionOrganism } from './PricingTierSection.organism';
import { PricingComparisonTableOrganism } from './PricingComparisonTable.organism';

const state = vi.hoisted(() => ({
  currency: 'pln' as 'pln' | 'eur' | 'usd',
  country: 'PL' as 'PL' | 'DE' | 'CA' | null,
  internationalBillingEnabled: true,
  isCurrencyLocked: false,
  paidMissing: false,
  currentPlan: null as string | null,
  setCountry: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('../../../application/analytics/analytics-sinks', () => ({
  emitAnalyticsEvent: state.emit,
  clarity: vi.fn(),
}));
vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn(), pathname: '/pricing', query: {} }),
}));
vi.mock('../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    data: state.currentPlan
      ? { stylist_account: { pricing_plan: state.currentPlan } }
      : undefined,
  }),
}));
vi.mock('../../shared/hooks/usePricingFunnelState', () => ({
  usePricingFunnelState: () => ({ setPricingFunnel: vi.fn() }),
}));
vi.mock('../shared/pricing/hooks/usePricingPlans', () => ({
  usePricingPlans: () => ({
    data: [
      { id: 'FREE', priceMonthly: 0, priceYearly: 0, priceYearlyTotal: 0 },
      {
        id: 'PRO',
        priceMonthly: state.paidMissing ? null : 6050,
        priceYearly: state.paidMissing ? null : 4800,
        priceYearlyTotal: state.paidMissing ? null : 57599,
      },
      {
        id: 'PRO_PLUS',
        priceMonthly: 9900,
        priceYearly: 7900,
        priceYearlyTotal: 94800,
      },
      {
        id: 'STUDIO',
        priceMonthly: 19900,
        priceYearly: 15900,
        priceYearlyTotal: 190800,
      },
      {
        id: 'SCALE',
        priceMonthly: null,
        priceYearly: null,
        priceYearlyTotal: null,
      },
    ],
    isPending: false,
    pricesUnavailable: false,
    ...state,
  }),
}));
const messages = {
  pl: resolveTrialMessages(plMessages),
  en: resolveTrialMessages(enMessages),
  de: resolveTrialMessages(deMessages),
} as unknown as Record<string, AbstractIntlMessages>;
const text = (node: Element) => (node.textContent ?? '').replace(/\s+/g, ' ');

beforeEach(() => {
  state.currency = 'pln';
  state.country = 'PL';
  state.internationalBillingEnabled = true;
  state.isCurrencyLocked = false;
  state.paidMissing = false;
  state.currentPlan = null;
  state.setCountry.mockReset();
  state.emit.mockReset();
});

describe('public pricing currency and real billing amounts', () => {
  it.each([
    ['pl', 'pln', '60,50 PLN'],
    ['de', 'eur', '60,50 EUR'],
    ['en', 'usd', 'USD 60.50'],
  ] as const)(
    'shows exact minor-unit monthly prices in %s (%s)',
    (locale, currency, expected) => {
      state.currency = currency;
      renderWithProviders(<PricingTierSectionOrganism isYearly={false} />, {
        locale,
        messages: messages[locale],
      });
      const pro = screen
        .getByRole('heading', { name: 'Pro', level: 3 })
        .closest('article');
      expect(pro).not.toBeNull();
      expect(text(pro as HTMLElement)).toContain(expected);
      expect(text(pro as HTMLElement)).toContain(currency.toUpperCase());
    }
  );
  it('records the selected market on a paid card click', () => {
    state.country = 'CA';
    state.currency = 'usd';
    renderWithProviders(<PricingTierSectionOrganism isYearly />, {
      messages: messages.pl,
    });
    const pro = screen
      .getByRole('heading', { name: 'Pro', level: 3 })
      .closest('article') as HTMLElement;
    expect(state.emit).not.toHaveBeenCalled();
    fireEvent.click(within(pro).getByRole('link'));
    expect(state.emit).toHaveBeenCalledWith('pricing_plan_clicked', {
      plan: 'PRO',
      location: 'pricing-tier',
      billing_country: 'CA',
      currency: 'USD',
      billing_period: 'year',
    });
  });
  it('uses the actual full annual charge, including cents, for the total and saving', () => {
    renderWithProviders(<PricingTierSectionOrganism isYearly />, {
      messages: messages.pl,
    });
    const pro = screen
      .getByRole('heading', { name: 'Pro', level: 3 })
      .closest('article') as HTMLElement;
    expect(text(pro)).toContain('48 PLN/mies., 575,99 PLN rocznie');
    expect(text(pro)).toContain('Oszczędzasz 150,01 PLN rocznie');
    expect(within(pro).getByText(/48 PLN\/mies\./).tagName).toBe('STRONG');
  });
  it('uses the selected market and disables paid cards for an unavailable country while keeping Free usable', () => {
    state.country = 'CA';
    state.currency = 'usd';
    state.internationalBillingEnabled = false;
    renderWithProviders(<PricingTierSectionOrganism isYearly={false} />, {
      messages: messages.pl,
    });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
    const pro = screen
      .getByRole('heading', { name: 'Pro', level: 3 })
      .closest('article') as HTMLElement;
    const free = screen
      .getByRole('heading', { name: 'Free Demo', level: 3 })
      .closest('article') as HTMLElement;
    expect(within(pro).getByRole('button')).toBeDisabled();
    expect(within(free).getByRole('link')).toHaveAttribute('href');
  });
  it('uses the automatic USD fallback without adding a country picker when detection has no hint', () => {
    state.country = null;
    state.currency = 'usd';
    renderWithProviders(<PricingTierSectionOrganism isYearly={false} />, {
      messages: messages.pl,
    });
    expect(screen.queryByRole('combobox')).toBeNull();
    const pro = screen
      .getByRole('heading', { name: 'Pro', level: 3 })
      .closest('article') as HTMLElement;
    expect(within(pro).getByRole('link')).toHaveAttribute('href');
    expect(text(pro)).toContain('USD');
  });
  it('does not expose a country selector when subscription currency is locked', () => {
    state.isCurrencyLocked = true;
    state.currency = 'usd';
    state.country = 'CA';
    renderWithProviders(<PricingTierSectionOrganism isYearly={false} />, {
      messages: messages.pl,
    });
    expect(screen.queryByLabelText('Kraj rozliczenia')).toBeNull();
    expect(
      screen.getByText(/Waluta bieżącej subskrypcji: USD/)
    ).toBeInTheDocument();
  });
  it('never substitutes zero for a missing paid price', () => {
    state.paidMissing = true;
    renderWithProviders(<PricingTierSectionOrganism isYearly={false} />, {
      messages: messages.pl,
    });
    const pro = screen
      .getByRole('heading', { name: 'Pro', level: 3 })
      .closest('article') as HTMLElement;
    expect(text(pro)).not.toContain(`Po ${TRIAL_CONFIG.DURATION_DAYS} dniach:`);
    expect(within(pro).getByRole('button')).toBeDisabled();
  });
  it('shows the annual total in the comparison as well', () => {
    renderWithProviders(<PricingComparisonTableOrganism />, {
      messages: messages.pl,
    });
    expect(screen.getAllByText(/575,99 PLN rocznie/).length).toBeGreaterThan(0);
  });
});
