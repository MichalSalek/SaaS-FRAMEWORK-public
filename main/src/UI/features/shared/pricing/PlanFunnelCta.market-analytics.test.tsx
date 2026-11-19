import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

const state = vi.hoisted(() => ({ emit: vi.fn(), set: vi.fn() }));
vi.mock('../../../../application/analytics/analytics-sinks', () => ({
  emitAnalyticsEvent: state.emit,
  clarity: vi.fn(),
}));
vi.mock('../../../shared/hooks/usePricingFunnelState', () => ({
  usePricingFunnelState: () => ({ setPricingFunnel: state.set }),
}));
vi.mock('./hooks/usePricingMarket', () => ({
  usePricingMarket: () => ({ country: 'CA', currency: 'usd' }),
}));
vi.mock('../../../components/Button/LinkButton.atom', () => ({
  LinkButtonAtom: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));
import { PlanFunnelCtaMolecule } from './PlanFunnelCta.molecule';

describe('pricing market intent', () => {
  it('sends the selected Canadian market when the paid CTA is clicked', () => {
    render(
      <PlanFunnelCtaMolecule
        planId={PricingPlanValue.PRO}
        label='Choose'
        billingPeriod='year'
        ctaLocation='stylists-pricing-preview'
      />
    );
    expect(state.emit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    expect(state.emit).toHaveBeenCalledWith('pricing_plan_clicked', {
      plan: PricingPlanValue.PRO,
      location: 'stylists-pricing-preview',
      billing_country: 'CA',
      currency: 'USD',
      billing_period: 'year',
    });
  });
});
