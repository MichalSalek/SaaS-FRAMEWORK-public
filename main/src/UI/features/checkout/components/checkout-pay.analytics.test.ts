import { describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
const state = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../../../application/analytics/flow-events', () => ({
  trackFlowStep: state.track,
}));
vi.mock('../../../../application/platform/haptics', () => ({
  hapticNotification: vi.fn(),
}));
import { payFlow } from './checkout-pay.helpers';

describe('checkout market dimensions', () => {
  it('records selected request market on a paid session and no paid currency for free', () => {
    const market = {
      billingCountry: 'CA',
      currency: 'usd',
      billingPeriod: 'year',
    };
    payFlow.sessionCreated(PricingPlanValue.PRO, 'checkout_elements', market);
    expect(state.track).toHaveBeenLastCalledWith(
      'checkout',
      'session_created',
      {
        plan: PricingPlanValue.PRO,
        kind: 'elements',
        billing_country: 'CA',
        currency: 'USD',
        billing_period: 'year',
      }
    );
    payFlow.sessionCreated(PricingPlanValue.FREE, 'free_selected', market);
    expect(state.track).toHaveBeenLastCalledWith(
      'checkout',
      'session_created',
      {
        plan: PricingPlanValue.FREE,
        kind: 'free',
        billing_country: 'CA',
        billing_period: 'year',
      }
    );
  });
  it('records dimensions on the attempt and every outcome', () => {
    const market = {
      billingCountry: 'CA',
      currency: 'usd',
      billingPeriod: 'year',
    };
    const props = {
      plan: PricingPlanValue.PRO,
      billing_country: 'CA',
      currency: 'USD',
      billing_period: 'year',
    };
    payFlow.clicked(PricingPlanValue.PRO, market);
    expect(state.track).toHaveBeenLastCalledWith('checkout', 'pay_clicked', {
      ...props,
      measurement_version: 2,
      measurement_changed_at: '2026-11-06',
    });
    payFlow.succeeded(PricingPlanValue.PRO, market);
    expect(state.track).toHaveBeenLastCalledWith(
      'checkout',
      'payment_succeeded',
      props
    );
    payFlow.declined(PricingPlanValue.PRO, { code: 'test' } as never, market);
    expect(state.track).toHaveBeenLastCalledWith('checkout', 'payment_failed', {
      ...props,
      code: 'test',
    });
    payFlow.threw(PricingPlanValue.PRO, market);
    expect(state.track).toHaveBeenLastCalledWith(
      'checkout',
      'confirmation_unknown',
      {
        ...props,
        code: 'confirm_threw',
      }
    );
  });
});
