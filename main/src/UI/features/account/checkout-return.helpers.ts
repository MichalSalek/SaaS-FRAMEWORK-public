import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { resolveSubscriptionState } from '@kernel/domain/user-and-account/subscription-state';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import type { SubscriptionBillingSummary } from '@kernel/models/session/session.dto';

/** A stale plan name is insufficient evidence of a successful checkout. */
export function isCheckoutPlanConfirmed(
  account:
    | (Parameters<typeof resolveSubscriptionState>[0] & {
        billing?: Pick<SubscriptionBillingSummary, 'billingPeriod'> | null;
      })
    | null
    | undefined,
  expectedPlan: PricingPlan | null,
  options: { billingPeriod?: BillingPeriod; acceptCanceling?: boolean } = {}
): boolean {
  if (
    !account ||
    expectedPlan === null ||
    account.pricing_plan !== expectedPlan
  ) {
    return false;
  }
  const state = resolveSubscriptionState(account);
  const expectedCycle = options.billingPeriod === 'year' ? 'yearly' : 'monthly';
  if (
    options.billingPeriod !== undefined &&
    account.billing?.billingPeriod !== expectedCycle
  ) {
    return false;
  }
  return (
    state === 'active' ||
    state === 'trialing' ||
    (options.acceptCanceling === true &&
      state === 'canceling' &&
      (account.subscription_status === 'ACTIVE' ||
        account.subscription_status === 'TRIALING'))
  );
}
