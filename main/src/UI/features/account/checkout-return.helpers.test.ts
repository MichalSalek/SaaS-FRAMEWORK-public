import { describe, expect, it } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import { isCheckoutPlanConfirmed } from './checkout-return.helpers';

const account = {
  pricing_plan: PricingPlanValue.STUDIO,
  subscription_status: SubscriptionStatusValue.ACTIVE,
  cancel_at_period_end: false,
  cancel_at: null,
};
describe('checkout confirmation requires an effective paid plan', () => {
  it.each([SubscriptionStatusValue.ACTIVE, SubscriptionStatusValue.TRIALING])(
    'accepts %s',
    subscription_status => {
      expect(
        isCheckoutPlanConfirmed(
          { ...account, subscription_status },
          PricingPlanValue.STUDIO
        )
      ).toBe(true);
    }
  );
  it.each([
    SubscriptionStatusValue.INCOMPLETE,
    SubscriptionStatusValue.INCOMPLETE_EXPIRED,
    SubscriptionStatusValue.UNPAID,
    SubscriptionStatusValue.PAST_DUE,
    SubscriptionStatusValue.CANCELED,
  ])(
    'rejects %s even if the mirrored plan name matches',
    subscription_status => {
      expect(
        isCheckoutPlanConfirmed(
          { ...account, subscription_status },
          PricingPlanValue.STUDIO
        )
      ).toBe(false);
    }
  );
  it('rejects pending cancellation, missing account and a different target', () => {
    expect(
      isCheckoutPlanConfirmed(
        { ...account, cancel_at_period_end: true },
        PricingPlanValue.STUDIO
      )
    ).toBe(false);
    expect(isCheckoutPlanConfirmed(undefined, PricingPlanValue.STUDIO)).toBe(
      false
    );
    expect(isCheckoutPlanConfirmed(account, PricingPlanValue.PRO)).toBe(false);
  });
});

describe('billing-cycle confirmation', () => {
  const owned = {
    pricing_plan: PricingPlanValue.STUDIO,
    subscription_status: SubscriptionStatusValue.ACTIVE,
    cancel_at_period_end: false,
    cancel_at: null,
    billing: { billingPeriod: 'monthly' as const },
  };
  it('waits for the actual yearly price rather than confirming the unchanged plan name', () => {
    expect(
      isCheckoutPlanConfirmed(owned, PricingPlanValue.STUDIO, {
        billingPeriod: 'year',
      })
    ).toBe(false);
    expect(
      isCheckoutPlanConfirmed(
        { ...owned, billing: { billingPeriod: 'yearly' } },
        PricingPlanValue.STUDIO,
        { billingPeriod: 'year' }
      )
    ).toBe(true);
    expect(
      isCheckoutPlanConfirmed(
        { ...owned, billing: null },
        PricingPlanValue.STUDIO,
        { billingPeriod: 'year' }
      )
    ).toBe(false);
  });
  it('confirms a paid change preserving cancellation only when that outcome was requested', () => {
    const canceling = { ...owned, cancel_at_period_end: true };
    expect(isCheckoutPlanConfirmed(canceling, PricingPlanValue.STUDIO)).toBe(
      false
    );
    expect(
      isCheckoutPlanConfirmed(canceling, PricingPlanValue.STUDIO, {
        billingPeriod: 'month',
        acceptCanceling: true,
      })
    ).toBe(true);
  });
});
