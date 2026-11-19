import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  retry: vi.fn(),
  error: true,
  country: null as string | null,
  international: false,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../shared/pricing/hooks/usePricingPlans', () => ({
  usePricingPlans: () => ({
    country: state.country,
    currency: null,
    isCurrencyLocked: false,
    internationalBillingEnabled: state.international,
    isMarketError: state.error,
    refetchMarket: state.retry,
  }),
}));
import { PricingMarketMolecule } from './PricingMarket.molecule';
describe('market failure', () => {
  it('shows a retryable failure instead of a country restriction', () => {
    const view = render(<PricingMarketMolecule />);
    expect(screen.getByRole('alert')).toHaveTextContent('marketLoadError');
    expect(screen.queryByText('marketUnavailable')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
    state.error = false;
    state.country = 'DE';
    view.rerender(<PricingMarketMolecule />);
    expect(screen.getByText('marketUnavailable')).toBeInTheDocument();
  });
});
