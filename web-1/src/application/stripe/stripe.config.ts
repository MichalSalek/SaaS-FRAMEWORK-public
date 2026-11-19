// Web-1 specific Stripe configuration, importing SSOT from shared kernel
import {
  getPlanIdFromPricingPlanValue as getPlanIdFromPricingPlanValueShared,
  getPricingPlanValueFromPlanId as getPricingPlanValueFromPlanIdShared,
  isStripeSubscriptionActive as isStripeSubscriptionActiveShared,
  VALID_PAID_PLAN_IDS,
} from '@kernel/domain/stripe/stripe.config';

export * from '@kernel/domain/stripe/stripe.config';

// Stripe webhook event types we handle (Backend only)
export const STRIPE_WEBHOOK_EVENTS = {
  CHECKOUT_SESSION_COMPLETED: 'checkout.session.completed',
  CUSTOMER_SUBSCRIPTION_CREATED: 'customer.subscription.created',
  CUSTOMER_SUBSCRIPTION_UPDATED: 'customer.subscription.updated',
  CUSTOMER_SUBSCRIPTION_DELETED: 'customer.subscription.deleted',
  CUSTOMER_SUBSCRIPTION_PAUSED: 'customer.subscription.paused',
  CUSTOMER_SUBSCRIPTION_RESUMED: 'customer.subscription.resumed',
  CUSTOMER_SUBSCRIPTION_TRIAL_WILL_END: 'customer.subscription.trial_will_end',
  CUSTOMER_SUBSCRIPTION_PENDING_UPDATE_APPLIED:
    'customer.subscription.pending_update_applied',
  CUSTOMER_SUBSCRIPTION_PENDING_UPDATE_EXPIRED:
    'customer.subscription.pending_update_expired',
  SUBSCRIPTION_SCHEDULE_UPDATED: 'subscription_schedule.updated',
  SUBSCRIPTION_SCHEDULE_RELEASED: 'subscription_schedule.released',
  INVOICE_PAYMENT_SUCCEEDED: 'invoice.payment_succeeded',
  INVOICE_PAYMENT_FAILED: 'invoice.payment_failed',
  INVOICE_UPCOMING: 'invoice.upcoming',
  PRODUCT_UPDATED: 'product.updated',
  PRICE_UPDATED: 'price.updated',
  CHARGE_DISPUTE_CREATED: 'charge.dispute.created',
  CHARGE_DISPUTE_CLOSED: 'charge.dispute.closed',
} as const;

/**
 * Logger namespace for Stripe webhook diagnostics (reportIssueBackend).
 *
 * DECISION: the base namespace shared by all undistinguished webhook logs. Distinct one-off
 * subsystems (`STRIPE_WEBHOOK_SIGNATURE_ERROR`, `_IDEMPOTENCY`, ...) KEEP their own namespaces:
 * they are separate alert categories and are NOT merged into this constant.
 * `_ADVISORY_LOCK_ERROR` left with the advisory lock removed from the hot path; do not recreate
 * it for parity.
 */
export const STRIPE_WEBHOOK_LOG_NAMESPACE = 'STRIPE_WEBHOOK';

export const UNKNOWN_PLAN_ID = 'unknown';
export const DEFAULT_PLAN_ID = 'free';

// All valid plan IDs including free
export const getValidPlanIds = (): string[] => {
  return [DEFAULT_PLAN_ID, ...VALID_PAID_PLAN_IDS];
};

// Re-export SSOT functions from shared kernel
export const getPricingPlanValueFromPlanId =
  getPricingPlanValueFromPlanIdShared;
export const getPlanIdFromPricingPlanValue =
  getPlanIdFromPricingPlanValueShared;
export const isStripeSubscriptionActive = ({
  status,
}: {
  status: string;
}): boolean => isStripeSubscriptionActiveShared(status);
