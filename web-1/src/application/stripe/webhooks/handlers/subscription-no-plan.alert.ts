import type Stripe from 'stripe';
import { getValidPlanIds } from '@app/stripe/stripe.config';
import { buildCriticalAlertEffect } from '@app/stripe/webhooks/stripe-webhooks.utils';
import { stripeDashboardLinkProp } from '@app/stripe/stripe-dashboard.links';

/**
 * Owner alert for an active, paid subscription whose planId is missing or not
 * in the plan map. The handler keeps the DB plan (no silent FREE fallback),
 * so the stylist may have paid without getting the plan. Built here so the
 * lifecycle handler stays under its file cap.
 */
export const buildSubscriptionNoPlanAlertEffect = (
  subscription: Stripe.Subscription,
  extractedPlanId: string | undefined
) => {
  const firstItem = subscription.items.data[0];
  const firstPrice = firstItem?.price;
  return buildCriticalAlertEffect({
    context: 'STRIPE_SUBSCRIPTION_NO_PLAN',
    diagnostic: { subscriptionId: subscription.id },
    alert: {
      alertTitle: 'Aktywna subskrypcja bez poprawnego planId',
      alertMessage:
        'Subskrypcja jest aktywna i opłacona, ale planId jest pusty, nieznany albo spoza mapy planów. ' +
        'Plan w bazie został bez zmian (bez cichego przejścia na Free). Stylistka mogła zapłacić i nie dostać wyższego planu.',
      ...stripeDashboardLinkProp('subscriptions', subscription.id),
      details: {
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        status: subscription.status,
        currentPeriodEnd: firstItem?.current_period_end
          ? new Date(firstItem.current_period_end * 1000).toISOString()
          : null,
        extractedPlanId,
        validPlanIds: getValidPlanIds(),
        metadata: subscription.metadata,
        priceId: firstPrice?.id,
        productId:
          typeof firstPrice?.product === 'string'
            ? firstPrice.product
            : firstPrice?.product?.id,
      },
    },
  });
};
