import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import type {
  AccountStatus,
  PaymentStatus,
  SubscriptionStatus,
} from '@kernel/models/db_models.generated.dto';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';

/** The salon is live: an active Studio or Scale owner with a paid or trial
 *  subscription that has not expired. Domain unions, not bare strings, so a
 *  misspelt status in a comparison is a compile error. */
export function canManageSalonProfile(account: {
  pricing_plan: PricingPlan;
  subscription_status: SubscriptionStatus | null;
  payment_status: PaymentStatus;
  account_status: AccountStatus;
  account_expiration_date: Date | null;
}): boolean {
  return (
    account.account_status === 'ACTIVE' &&
    PRICING_POLICY.LIMITS[narrowPricingPlan(account.pricing_plan)]
      .can_have_salon_profile &&
    (account.subscription_status === 'ACTIVE' ||
      account.subscription_status === 'TRIALING' ||
      (account.subscription_status === null &&
        account.payment_status === 'PAID')) &&
    (account.account_expiration_date === null ||
      account.account_expiration_date > new Date())
  );
}
