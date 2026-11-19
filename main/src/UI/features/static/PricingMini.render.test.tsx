import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import enMessages from '../../../locales/en/common.json';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { ForStylistsPricingPreviewSectionOrganism } from './ForStylistsPageSections.b.organism';
import { ForStudiosPricingTierPreviewSectionOrganism } from './ForStudiosPageSections.b.organism';

const state = vi.hoisted(() => ({
  enabled: true,
  price: 6050 as number | null,
}));
vi.mock('../shared/pricing/hooks/usePricingPlans', () => ({
  usePricingPlans: () => ({
    currency: 'usd',
    country: 'CA',
    internationalBillingEnabled: state.enabled,
    isCurrencyLocked: false,
    data: [
      { id: 'FREE', priceMonthly: 0 },
      { id: 'PRO', priceMonthly: state.price },
      { id: 'PRO_PLUS', priceMonthly: state.price },
      { id: 'STUDIO', priceMonthly: state.price },
      { id: 'SCALE', priceMonthly: null },
    ],
  }),
}));
vi.mock('../shared/pricing/PlanFunnelCta.molecule', () => ({
  PlanFunnelCtaMolecule: ({
    disabled,
    label,
  }: {
    disabled: boolean;
    label: string;
  }) => <button disabled={disabled}>{label}</button>,
}));
vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn(), pathname: '/', query: {} }),
}));
const messages = enMessages as unknown as AbstractIntlMessages;
const sectionFor = (heading: string) =>
  screen
    .getByRole('heading', { name: heading, level: 3 })
    .closest('article') as HTMLElement;

describe('public mini-pricings', () => {
  it('shows USD cents on both stylist and studio cards', () => {
    state.enabled = true;
    state.price = 6050;
    const view = renderWithProviders(
      <ForStylistsPricingPreviewSectionOrganism onPricingClick={vi.fn()} />,
      { locale: 'en', messages }
    );
    expect(sectionFor('Pro').textContent?.replace(/\s+/g, ' ')).toContain(
      'USD 60.50/month'
    );
    view.unmount();
    renderWithProviders(
      <ForStudiosPricingTierPreviewSectionOrganism
        onSecondaryClick={vi.fn()}
      />,
      { locale: 'en', messages }
    );
    expect(sectionFor('Studio').textContent?.replace(/\s+/g, ' ')).toContain(
      'USD 60.50/month'
    );
  });
  it('disables paid checkout if the country is unavailable and keeps free signup usable', () => {
    state.enabled = false;
    state.price = 6050;
    renderWithProviders(
      <ForStylistsPricingPreviewSectionOrganism onPricingClick={vi.fn()} />,
      { locale: 'en', messages }
    );
    expect(within(sectionFor('Pro')).getByRole('button')).toBeDisabled();
    expect(within(sectionFor('Free Demo')).getByRole('button')).toBeEnabled();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
  it('does not present a missing paid price as zero', () => {
    state.enabled = true;
    state.price = null;
    renderWithProviders(
      <ForStudiosPricingTierPreviewSectionOrganism
        onSecondaryClick={vi.fn()}
      />,
      { locale: 'en', messages }
    );
    const studio = sectionFor('Studio');
    expect(within(studio).getByRole('button')).toBeDisabled();
    expect(studio.textContent).not.toContain('then');
  });
});
