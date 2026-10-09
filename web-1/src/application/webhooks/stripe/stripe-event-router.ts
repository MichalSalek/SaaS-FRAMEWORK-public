import type Stripe from 'stripe';
import type { Prisma } from '../../../prisma/js-client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type { ReportIssueProps } from '@app/debugger/error-debugger.types';
import {
  STRIPE_WEBHOOK_EVENTS,
  STRIPE_WEBHOOK_LOG_NAMESPACE,
} from '@app/stripe/stripe.config';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import {
  CHECKOUT_SESSION_EXPAND,
  handleCheckoutCompleted,
} from '@app/stripe/webhooks/handlers/checkout.handler';
import {
  handleInvoicePaymentFailed,
  handleInvoicePaymentSucceeded,
  handleInvoiceUpcoming,
} from '@app/stripe/webhooks/handlers/invoice.handler';
import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
} from '@app/stripe/webhooks/handlers/subscription-lifecycle.handler';
import { handleSubscriptionDeleted } from '@app/stripe/webhooks/handlers/subscription-deleted.handler';
import {
  handleSubscriptionPaused,
  handleSubscriptionResumed,
  handleSubscriptionTrialWillEnd,
} from '@app/stripe/webhooks/handlers/subscription-state.handler';
import {
  handlePendingUpdateApplied,
  handlePendingUpdateExpired,
  handleSubscriptionScheduleUpdated,
  handleSubscriptionScheduleReleased,
} from '@app/stripe/webhooks/handlers/subscription-schedule.handler';
import { handleProductOrPriceUpdate } from '@app/stripe/webhooks/handlers/product-price.handler';
import {
  handleChargeDisputeCreated,
  handleChargeDisputeClosed,
} from '@app/stripe/webhooks/handlers/charge-dispute.handler';
import {
  emptyEffectsResult,
  type StripeHandlerResult,
} from '@app/stripe/webhooks/stripe-effects.types';
import { isOutOfScopeSession } from '@app/stripe/webhooks/stripe-webhooks.utils';
import type { StripeEventPrefetch } from './stripe-event-prefetch';

// DECISION (nie usuwaj tego komentarza):
// C1 — Handlers return Promise<StripeHandlerResult> (effects[]) so the router
// AGGREGATES post-commit work back to the entry point. Each handler queues
// effects (emails, Stripe API cancels, churn alerts) instead of scheduling them
// inline via runAfterResponse. The entry point invokes runAfterResponse ONLY
// after $transaction commits — a rolled-back tx fires zero side effects
// (D1 atomicity, see pages/api/v1/webhooks/stripe/index.ts DECISION).
// Errors propagate via throw → caught by index.ts try/catch → respondGeneralError.

/**
 * Uniform "event received" diagnostic. Every dispatch arm logged the same four-field
 * `reportIssueBackend` shape with a hand-written literal that just restated `event.type`
 * — 17 near-identical copies, one per case, and a fresh copy required per new event.
 * The message is byte-identical to what those literals produced.
 */
const logEventReceived = (
  event: Stripe.Event,
  payload: ReportIssueProps['payload'],
  mode: ReportIssueProps['mode'] = 'info'
): void => {
  reportIssueBackend({
    namespace: STRIPE_WEBHOOK_LOG_NAMESPACE,
    message: `${event.type} received`,
    payload,
    mode,
  });
};

/**
 * Route a Stripe event to the appropriate handler.
 *
 * DECISION (nie usuwaj tego komentarza):
 * D1 (run 25) — `tx` is the SAME interactive transaction opened by index.ts
 * (and by the janitor), whose first statement is claimEventForProcessingTx.
 * Handlers thread tx through so the entire
 * effect (account update + audit log + processed=true) commits atomically.
 * Handlers without DB writes (product/price cache invalidation) ignore tx.
 *
 * C1 — Returns StripeHandlerResult to surface post-commit effects[] up to the
 * webhook entry point. Effects MUST NOT be scheduled inside this function or
 * its callees (handlers); the post-commit collector is the sole scheduler.
 *
 * D2-F1 (PRMA) — `prefetch` carries everything resolved from Stripe BEFORE the
 * `$transaction` block (see `prefetchStripeEventContext`): the planId for the
 * subscription fan-in handlers and, for `subscription_schedule.*`, the full
 * subscription behind `schedule.subscription`. Threaded down so NO handler calls
 * the Stripe API while holding the tx. An empty object is passed for events that
 * need no lookup (handlers that don't accept the params ignore them).
 */
export const routeStripeEvent = async (
  event: Stripe.Event,
  tx: Prisma.TransactionClient,
  prefetch: StripeEventPrefetch = {}
): Promise<StripeHandlerResult> => {
  const {
    planId: prefetchedPlanId,
    scheduleSubscription,
    checkoutSession,
    disputeCustomerId,
  } = prefetch;
  // d2f1-allow: klient używany WYŁĄCZNIE przez fallbackowy expand checkoutu niżej (gdy
  // caller nie prefetchował). Ścieżka webhookowa dostaje sesję gotową z prefetchu.
  const stripe = getStripe();
  // Out-of-order guard input: every subscription.* plan-write is gated on this
  // (event.created is Unix seconds). A stale/retried event older than the last
  // applied one is skipped in updateAccountPlanStatus — see its DECISION comment.
  const eventCreatedAt = new Date(event.created * 1000);

  switch (event.type) {
    case STRIPE_WEBHOOK_EVENTS.CHECKOUT_SESSION_COMPLETED: {
      const session = event.data.object as Stripe.Checkout.Session;

      // Nie zakładamy, że sesja na koncie Stripe należy do tej aplikacji. Bez tego
      // guardu sesja bez naszego stempla trafia tu, nie znajduje stylistki i
      // emituje FAŁSZYWY critical alert "Checkout Completed But No Stylist Account
      // Found". Guard PRZED expand — oszczędza zbędny stripe.sessions.retrieve dla
      // sesji spoza zakresu aplikacji.
      // DECISION (nie usuwaj tego komentarza): przetwarzamy TYLKO sesje z
      // projectId === STRIPE_PROJECT_ID; wariant i uzasadnienie przy
      // isOutOfScopeSession (stripe-webhooks.utils).
      if (isOutOfScopeSession(session.metadata)) {
        reportIssueBackend({
          namespace: 'STRIPE_WEBHOOK_SKIPPED_OUT_OF_SCOPE',
          message:
            'Skipping checkout.session.completed without our projectId (out of application scope)',
          payload: {
            sessionId: session.id,
            projectId: session.metadata?.projectId ?? null,
          },
          mode: 'info',
        });
        return { effects: [] };
      }

      // D2-F1 (PRMA): the expansion is resolved by prefetchStripeEventContext BEFORE the
      // transaction opens — a 20s-timeout Stripe round-trip inside a 25s tx budget, on the
      // hottest webhook path there is (every new paying account). The retrieve below is only
      // the fallback for callers that do not prefetch; it deliberately keeps throwing, since
      // acking a checkout we could not read would mark it processed without granting the plan.
      const expandedSession =
        checkoutSession ??
        (await stripe.checkout.sessions.retrieve(session.id, {
          expand: [...CHECKOUT_SESSION_EXPAND],
        }));

      logEventReceived(event, { sessionId: session.id });

      return await handleCheckoutCompleted({
        session: expandedSession,
        eventCreatedAt,
        tx,
      });
    }

    case STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_CREATED: {
      const subscription = event.data.object as Stripe.Subscription;
      logEventReceived(event, {
        subscriptionId: subscription.id,
        status: subscription.status,
      });
      return await handleSubscriptionCreated({
        subscription,
        eventCreatedAt,
        ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
        tx,
      });
    }

    case STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_UPDATED: {
      const subscription = event.data.object as Stripe.Subscription;
      logEventReceived(event, {
        subscriptionId: subscription.id,
        status: subscription.status,
      });
      return await handleSubscriptionUpdated({
        subscription,
        eventCreatedAt,
        ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
        tx,
      });
    }

    case STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_DELETED: {
      const subscription = event.data.object as Stripe.Subscription;
      logEventReceived(event, { subscriptionId: subscription.id });
      return await handleSubscriptionDeleted({
        subscription,
        eventCreatedAt,
        tx,
      });
    }

    case STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_PAUSED: {
      const subscription = event.data.object as Stripe.Subscription;
      logEventReceived(event, { subscriptionId: subscription.id });
      return await handleSubscriptionPaused({
        subscription,
        eventCreatedAt,
        ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
        tx,
      });
    }

    case STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_RESUMED: {
      const subscription = event.data.object as Stripe.Subscription;
      logEventReceived(event, { subscriptionId: subscription.id });
      return await handleSubscriptionResumed({
        subscription,
        eventCreatedAt,
        ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
        tx,
      });
    }

    case STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_TRIAL_WILL_END: {
      const subscription = event.data.object as Stripe.Subscription;
      logEventReceived(event, {
        subscriptionId: subscription.id,
        trialEnd: subscription.trial_end,
      });
      return await handleSubscriptionTrialWillEnd({ subscription, tx });
    }

    case STRIPE_WEBHOOK_EVENTS.INVOICE_UPCOMING: {
      const invoice = event.data.object as Stripe.Invoice;
      logEventReceived(event, { invoiceId: invoice.id });
      return await handleInvoiceUpcoming({ invoice, tx });
    }

    case STRIPE_WEBHOOK_EVENTS.INVOICE_PAYMENT_SUCCEEDED: {
      const invoice = event.data.object as Stripe.Invoice;
      logEventReceived(event, {
        invoiceId: invoice.id,
        amountPaid: invoice.amount_paid,
      });
      return await handleInvoicePaymentSucceeded({
        invoice,
        eventCreatedAt,
        tx,
      });
    }

    case STRIPE_WEBHOOK_EVENTS.INVOICE_PAYMENT_FAILED: {
      const invoice = event.data.object as Stripe.Invoice;
      logEventReceived(event, {
        invoiceId: invoice.id,
        attemptCount: invoice.attempt_count,
      });
      return await handleInvoicePaymentFailed({ invoice, eventCreatedAt, tx });
    }

    case STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_PENDING_UPDATE_APPLIED: {
      const subscription = event.data.object as Stripe.Subscription;
      logEventReceived(event, {
        subscriptionId: subscription.id,
        status: subscription.status,
      });
      return await handlePendingUpdateApplied({
        subscription,
        eventCreatedAt,
        ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
        tx,
      });
    }

    case STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_PENDING_UPDATE_EXPIRED: {
      const subscription = event.data.object as Stripe.Subscription;
      logEventReceived(event, {
        subscriptionId: subscription.id,
        status: subscription.status,
      });
      return await handlePendingUpdateExpired({
        subscription,
        eventCreatedAt,
        ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
        tx,
      });
    }

    case STRIPE_WEBHOOK_EVENTS.SUBSCRIPTION_SCHEDULE_UPDATED: {
      const schedule = event.data.object as Stripe.SubscriptionSchedule;
      logEventReceived(event, {
        scheduleId: schedule.id,
        status: schedule.status,
      });
      return await handleSubscriptionScheduleUpdated({
        schedule,
        eventCreatedAt,
        ...(scheduleSubscription !== undefined && {
          prefetchedSubscription: scheduleSubscription,
        }),
        ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
        tx,
      });
    }

    case STRIPE_WEBHOOK_EVENTS.SUBSCRIPTION_SCHEDULE_RELEASED: {
      const schedule = event.data.object as Stripe.SubscriptionSchedule;
      logEventReceived(event, {
        scheduleId: schedule.id,
      });
      return await handleSubscriptionScheduleReleased({
        schedule,
        eventCreatedAt,
        ...(scheduleSubscription !== undefined && {
          prefetchedSubscription: scheduleSubscription,
        }),
        ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
        tx,
      });
    }

    case STRIPE_WEBHOOK_EVENTS.PRODUCT_UPDATED:
    case STRIPE_WEBHOOK_EVENTS.PRICE_UPDATED: {
      reportIssueBackend({
        namespace: STRIPE_WEBHOOK_LOG_NAMESPACE,
        message: `${event.type} received — invalidating pricing cache`,
        payload: { eventType: event.type },
        mode: 'info',
      });
      // handleProductOrPriceUpdate is sync and produces no effects.
      // No DB writes here, so no tx threading needed.
      return handleProductOrPriceUpdate();
    }

    case STRIPE_WEBHOOK_EVENTS.CHARGE_DISPUTE_CREATED: {
      const dispute = event.data.object as Stripe.Dispute;
      logEventReceived(
        event,
        {
          disputeId: dispute.id,
          amount: dispute.amount,
          reason: dispute.reason,
        },
        'error'
      );
      return await handleChargeDisputeCreated({
        dispute,
        eventCreatedAt,
        ...(disputeCustomerId !== undefined && {
          prefetchedCustomerId: disputeCustomerId,
        }),
        tx,
      });
    }

    case STRIPE_WEBHOOK_EVENTS.CHARGE_DISPUTE_CLOSED: {
      const dispute = event.data.object as Stripe.Dispute;
      logEventReceived(event, {
        disputeId: dispute.id,
        status: dispute.status,
      });
      return await handleChargeDisputeClosed({
        dispute,
        eventCreatedAt,
        ...(disputeCustomerId !== undefined && {
          prefetchedCustomerId: disputeCustomerId,
        }),
        tx,
      });
    }

    default:
      reportIssueBackend({
        namespace: STRIPE_WEBHOOK_LOG_NAMESPACE,
        message: `Unhandled event type ${event.type}`,
        payload: { eventType: event.type },
        mode: 'info',
      });
      return emptyEffectsResult();
  }
};
