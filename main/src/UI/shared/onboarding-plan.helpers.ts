import type { SafeCurrentUserWire } from '@kernel/domain/user/user.contract-schemas';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import { USER_POLICY } from '@kernel/policies/user.policy';

// Billing owns recovery of engaged subscriptions, including an incomplete payment.
const ENGAGED_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  SubscriptionStatusValue.ACTIVE,
  SubscriptionStatusValue.TRIALING,
  SubscriptionStatusValue.PAST_DUE,
  SubscriptionStatusValue.INCOMPLETE,
]);

/** Shared by the app-wide gate and re-entry through registration. */
export function hasResolvedStylistPlan(
  user: SafeCurrentUserWire | undefined
): boolean {
  const account = user?.stylist_account;
  return (
    user !== undefined &&
    (USER_POLICY.utils.CAN_USER_HAVE_ACTIVE_ACCOUNT({ user }) ||
      (account?.subscription_status != null &&
        ENGAGED_SUBSCRIPTION_STATUSES.has(account.subscription_status)) ||
      account?.admin_plan_override === true)
  );
}
