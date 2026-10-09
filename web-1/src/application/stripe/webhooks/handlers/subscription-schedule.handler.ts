import type Stripe from 'stripe';
import type { Prisma } from '../../../../prisma/js-client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import {
  emptyEffectsResult,
  type StripeHandlerResult,
} from '@app/stripe/webhooks/stripe-effects.types';
import { handleSubscriptionUpdated } from './subscription-lifecycle.handler';

/**
 * Resolve a possibly-string subscription on a schedule into a full Stripe.Subscription.
 *
 * DECISION (nie usuwaj tego komentarza):
 * subscription_schedule.* events frequently arrive with `schedule.subscription`
 * as a string ID (not expanded). Logging a warning and exiting (the previous
 * behavior) meant scheduled plan changes (e.g., downgrade-at-period-end) never
 * synced to the DB. Fetch via API when needed so handleSubscriptionUpdated can
 * still apply the change. Returns null only when the API call itself fails.
 *
 * D2-F1 (PRMA) — WOŁAJ TO POZA `$transaction`. Eksportowane, bo prefetch w
 * stripe-event-router (`prefetchStripeEventContext`) rozwiązuje subskrypcję PRZED
 * wejściem w tx i podaje ją handlerowi jako `prefetchedSubscription`. Wywołanie
 * wewnątrz tx (poprzednie zachowanie) wkładało do 25-sekundowego budżetu DWA calle
 * Stripe po 20 s timeoutu każdy — ten `subscriptions.retrieve` plus `prices.retrieve`
 * z `extractPlanIdFromSubscription` w handleSubscriptionUpdated, któremu schedule
 * NIE podawał prefetchedPlanId. Zostaje jako fallback dla wywołań bez prefetchu.
 */
export const resolveScheduleSubscription = async (
  schedule: Stripe.SubscriptionSchedule
): Promise<Stripe.Subscription | null> => {
  if (schedule.subscription == null) {
    return null;
  }
  if (typeof schedule.subscription !== 'string') {
    return schedule.subscription as Stripe.Subscription;
  }
  try {
    // d2f1-allow: fallback dla callerów bez prefetchu — webhookowa ścieżka rozwiązuje
    // subskrypcję w prefetchStripeEventContext, PRZED transakcją (prefetchedSubscription).
    return await getStripe().subscriptions.retrieve(schedule.subscription);
  } catch (error) {
    reportIssueBackend({
      namespace: 'STRIPE_SCHEDULE_SUBSCRIPTION_FETCH_FAILED',
      message: 'Failed to fetch subscription referenced by schedule',
      payload: {
        scheduleId: schedule.id,
        subscriptionId: schedule.subscription,
        error,
      },
      mode: 'error',
    });
    return null;
  }
};

/**
 * NEW: Handle pending_update_applied event.
 * Called when pending update is successfully applied after payment.
 */
export const handlePendingUpdateApplied = async ({
  subscription,
  eventCreatedAt,
  prefetchedPlanId,
  tx,
}: {
  subscription: Stripe.Subscription;
  eventCreatedAt: Date;
  prefetchedPlanId?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  reportIssueBackend({
    namespace: 'STRIPE_PENDING_UPDATE_APPLIED',
    message: 'Pending update applied - processing as subscription update',
    payload: { subscriptionId: subscription.id, status: subscription.status },
    mode: 'info',
  });

  // Process as regular subscription update (planId now changed)
  return await handleSubscriptionUpdated({
    subscription,
    eventCreatedAt,
    ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
    ...(tx && { tx }),
  });
};

/**
 * NEW: Handle pending_update_expired event.
 * Called when pending update expires (payment failed or user cancelled).
 */
export const handlePendingUpdateExpired = async ({
  subscription,
  eventCreatedAt,
  prefetchedPlanId,
  tx,
}: {
  subscription: Stripe.Subscription;
  eventCreatedAt: Date;
  prefetchedPlanId?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  reportIssueBackend({
    namespace: 'STRIPE_PENDING_UPDATE_EXPIRED',
    message: 'Pending update expired - subscription remains unchanged',
    payload: { subscriptionId: subscription.id, status: subscription.status },
    mode: 'info',
  });

  // Process as regular subscription update (keeps current plan)
  return await handleSubscriptionUpdated({
    subscription,
    eventCreatedAt,
    ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
    ...(tx && { tx }),
  });
};

/**
 * NEW: Handle subscription_schedule.updated event.
 */
export const handleSubscriptionScheduleUpdated = async ({
  schedule,
  eventCreatedAt,
  prefetchedSubscription,
  prefetchedPlanId,
  tx,
}: {
  schedule: Stripe.SubscriptionSchedule;
  eventCreatedAt: Date;
  prefetchedSubscription?: Stripe.Subscription | null;
  prefetchedPlanId?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  reportIssueBackend({
    namespace: 'STRIPE_SCHEDULE_UPDATED',
    message: 'Subscription schedule updated',
    payload: {
      scheduleId: schedule.id,
      status: schedule.status,
      subscriptionId: schedule.subscription,
    },
    mode: 'info',
  });

  // `undefined` = nie prefetchowano (rozwiąż sam); `null` = prefetch już próbował i nie
  // wyszło — NIE ponawiaj wewnątrz tx (patrz StripeEventPrefetch.scheduleSubscription).
  const subscription =
    prefetchedSubscription !== undefined
      ? prefetchedSubscription
      : await resolveScheduleSubscription(schedule);
  if (subscription) {
    return await handleSubscriptionUpdated({
      subscription,
      eventCreatedAt,
      ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
      ...(tx && { tx }),
    });
  }
  return emptyEffectsResult();
};

/**
 * NEW: Handle subscription_schedule.released event.
 * Called when schedule is cancelled/released.
 */
export const handleSubscriptionScheduleReleased = async ({
  schedule,
  eventCreatedAt,
  prefetchedSubscription,
  prefetchedPlanId,
  tx,
}: {
  schedule: Stripe.SubscriptionSchedule;
  eventCreatedAt: Date;
  prefetchedSubscription?: Stripe.Subscription | null;
  prefetchedPlanId?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  reportIssueBackend({
    namespace: 'STRIPE_SCHEDULE_RELEASED',
    message: 'Subscription schedule released (cancelled)',
    payload: {
      scheduleId: schedule.id,
      subscriptionId: schedule.subscription,
    },
    mode: 'info',
  });

  // `undefined` = nie prefetchowano (rozwiąż sam); `null` = prefetch już próbował i nie
  // wyszło — NIE ponawiaj wewnątrz tx (patrz StripeEventPrefetch.scheduleSubscription).
  const subscription =
    prefetchedSubscription !== undefined
      ? prefetchedSubscription
      : await resolveScheduleSubscription(schedule);
  if (subscription) {
    return await handleSubscriptionUpdated({
      subscription,
      eventCreatedAt,
      ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
      ...(tx && { tx }),
    });
  }
  return emptyEffectsResult();
};
