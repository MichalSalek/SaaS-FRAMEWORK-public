import type Stripe from 'stripe';

/**
 * Check if subscription has a pending update.
 * Pending updates occur when user changes plan "at period end" in Customer Portal.
 */
export const hasPendingUpdate = ({
  subscription,
}: {
  subscription: Stripe.Subscription;
}): boolean => {
  return Boolean(subscription.pending_update);
};

/**
 * Check if subscription has an active schedule.
 * Schedules are used for future plan changes.
 *
 * Note: schedule can be either string (ID) or expanded object.
 * We only consider it "active" if it's expanded (object).
 */
export const hasActiveSchedule = ({
  subscription,
}: {
  subscription: Stripe.Subscription;
}): boolean => {
  return (
    Boolean(subscription.schedule) && typeof subscription.schedule !== 'string'
  );
};

/**
 * Extract date fields from subscription for DB storage.
 */
export const extractSubscriptionDateFields = ({
  subscription,
}: {
  subscription: Stripe.Subscription;
}): {
  cancelAt: Date | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
} => {
  const cancelAt = subscription.cancel_at
    ? new Date(subscription.cancel_at * 1000)
    : null;
  const cancelAtPeriodEnd =
    subscription.cancel_at_period_end || Boolean(cancelAt);
  const firstItemPeriodEnd = subscription.items.data[0]?.current_period_end;
  const currentPeriodEnd = firstItemPeriodEnd
    ? new Date(firstItemPeriodEnd * 1000)
    : null;

  return { cancelAt, cancelAtPeriodEnd, currentPeriodEnd };
};
