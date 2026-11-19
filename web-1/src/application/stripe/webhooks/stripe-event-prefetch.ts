import type Stripe from 'stripe';
import { STRIPE_WEBHOOK_EVENTS } from '@app/stripe/stripe.config';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { CHECKOUT_SESSION_EXPAND } from '@app/stripe/webhooks/handlers/checkout.handler';
import { resolveCustomerIdFromDispute } from '@app/stripe/webhooks/handlers/charge-dispute.handler';
import { resolveScheduleSubscription } from '@app/stripe/webhooks/handlers/subscription-schedule.handler';
import {
  isOutOfScopeSession,
  prefetchSubscriptionPlanId,
} from '@app/stripe/webhooks/stripe-webhooks.utils';

/**
 * PRE-TRANSACTION STRIPE CONTEXT
 *
 * Everything the webhook handlers need from the Stripe API is resolved HERE, before
 * `$transaction` opens, and threaded down through `routeStripeEvent`. Split out of the
 * router on purpose: the router dispatches INSIDE the tx, this module must only ever run
 * OUTSIDE it (D2-F1) — keeping them in one file kept blurring that boundary.
 */

// DECISION: the set of Stripe webhook events whose payload IS a `Stripe.Subscription` AND whose
// handler may call `extractPlanIdFromSubscription` (potentially `stripe.prices.retrieve`). For
// these the planId is PRE-FETCHED BEFORE `$transaction(timeout:25s)` so Stripe API latency
// (200-800ms typical, up to 20s degraded) cannot eat the tx budget. Schedule events
// (subscription_schedule.*) are not in this set (they resolve `schedule.subscription` separately,
// below); trial/deleted handlers do not need planId. Shared by BOTH entry points into
// routeStripeEvent: the hot-path webhook (index.ts) and the janitor sweeper
// (stripe-event-janitor.operations.ts).
const SUBSCRIPTION_EVENTS_WITH_PLAN_LOOKUP: ReadonlySet<string> = new Set([
  STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_CREATED,
  STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_UPDATED,
  STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_PAUSED,
  STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_RESUMED,
  STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_PENDING_UPDATE_APPLIED,
  STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_PENDING_UPDATE_EXPIRED,
]);

/**
 * DECISION: `subscription_schedule.*` events carry `schedule.subscription` as a STRING ID, so
 * their handlers had to `subscriptions.retrieve` it and, with no `prefetchedPlanId` to pass on,
 * let `handleSubscriptionUpdated` do a second `prices.retrieve`. Both ran INSIDE
 * `$transaction(timeout:25s)` at 20s per call (STRIPE_CONFIG.API_TIMEOUT_MS), so one degraded call
 * could eat the whole tx budget and roll the retry back into the janitor. Schedule events are
 * therefore resolved HERE, outside the tx, like the direct subscription events.
 */
const SCHEDULE_EVENTS_WITH_SUBSCRIPTION_LOOKUP: ReadonlySet<string> = new Set([
  STRIPE_WEBHOOK_EVENTS.SUBSCRIPTION_SCHEDULE_UPDATED,
  STRIPE_WEBHOOK_EVENTS.SUBSCRIPTION_SCHEDULE_RELEASED,
]);

/**
 * Stripe-side context resolved BEFORE the webhook `$transaction` and threaded into
 * the handlers, so that no handler performs a Stripe API call while holding the tx.
 */
export type StripeEventPrefetch = {
  /**
   * planId of the event's subscription.
   *
   * DECISION: TRI-STATE, like `scheduleSubscription` below: `undefined` = prefetch NOT attempted
   * (event outside the set, or the caller does not prefetch), the handler may resolve on its own;
   * `null` = attempted with no result, the handler does NOT retry inside the transaction. With a
   * two-state field a failed prefetch was indistinguishable from none, and the handler called
   * `extractPlanIdFromSubscription` AGAIN inside `$transaction(timeout:25s)`, up to 20 s
   * (`API_TIMEOUT_MS`) in the tx on a degraded Stripe.
   * Cost, chosen on purpose: no second attempt. The event commits `processed=true`, so a hiccup
   * during a plan change leaves the account on the OLD plan until `syncAccountWithStripe` at her
   * next login (not for `admin_plan_override`). If it hurts, retry the prefetch BEFORE the
   * transaction; never move the call back inside.
   */
  planId?: string | null;
  /**
   * Full subscription behind `schedule.subscription` (schedule events only).
   * TRI-STATE, deliberately: `undefined` = prefetch not attempted (not a schedule event, or the
   * caller does not prefetch), the handler resolves on its own; `null` = attempted and failed, the
   * handler does NOT retry. Without the distinction a failed prefetch degraded back into
   * `subscriptions.retrieve` INSIDE the tx (20 s outside plus 20 s inside on a Stripe outage).
   */
  scheduleSubscription?: Stripe.Subscription | null;
  /**
   * checkout.session.completed expanded with line items + subscription.
   *
   * DECISION: unlike the other fields this lookup does NOT swallow errors: `sessions.retrieve`
   * throws. A silent `null` the handler did not retry would let the transaction commit the event
   * as `processed=true` WITHOUT booking the payment, and Stripe would never repeat it. A throw
   * before the transaction means 500/retry on the hot path and a counted attempt in the janitor,
   * exactly what this path must do when Stripe is unavailable.
   */
  checkoutSession?: Stripe.Checkout.Session;
  /**
   * Customer behind the charge a dispute (`charge.dispute.*`) concerns.
   * Tri-state like `scheduleSubscription`: `undefined` = not prefetched,
   * `null` = could not be resolved (the handler alerts, does NOT retry in the tx).
   */
  disputeCustomerId?: string | null;
};

/**
 * Resolve the Stripe context for an event BEFORE entering `$transaction`.
 * Returns an empty object for events that need no lookup. On Stripe failure the
 * behaviour differs BY FIELD and deliberately so: plan/schedule/dispute lookups degrade
 * to a partial result (the handler keeps the current DB plan, or alerts), while the
 * checkout expand THROWS — see `StripeEventPrefetch.checkoutSession` for why acking an
 * unreadable checkout would be worse than failing loudly.
 * MUST be awaited outside the transaction — see D2-F1.
 */
export const prefetchStripeEventContext = async (
  event: Stripe.Event
): Promise<StripeEventPrefetch> => {
  if (SUBSCRIPTION_EVENTS_WITH_PLAN_LOOKUP.has(event.type)) {
    const subscription = event.data.object as Stripe.Subscription;
    // `?? null`: the prefetch WAS attempted, so even no result must differ from "not attempted".
    // Otherwise the handler retries the Stripe call inside the transaction.
    const planId = await prefetchSubscriptionPlanId(subscription);
    return { planId: planId ?? null };
  }

  if (SCHEDULE_EVENTS_WITH_SUBSCRIPTION_LOOKUP.has(event.type)) {
    const schedule = event.data.object as Stripe.SubscriptionSchedule;
    const scheduleSubscription = await resolveScheduleSubscription(schedule);
    if (scheduleSubscription === null) {
      // Fetch failed / schedule carries no subscription — already logged by the resolver.
      // Explicit null (NOT `{}`): tells the handler the lookup was already made and must
      // not be repeated inside the transaction.
      return { scheduleSubscription: null };
    }
    const planId = await prefetchSubscriptionPlanId(scheduleSubscription);
    return { scheduleSubscription, planId: planId ?? null };
  }

  if (event.type === STRIPE_WEBHOOK_EVENTS.CHECKOUT_SESSION_COMPLETED) {
    const session = event.data.object as Stripe.Checkout.Session;

    if (isOutOfScopeSession(session.metadata)) {
      return {};
    }
    return {
      checkoutSession: await getStripe().checkout.sessions.retrieve(
        session.id,
        {
          expand: [...CHECKOUT_SESSION_EXPAND],
        }
      ),
    };
  }

  if (
    event.type === STRIPE_WEBHOOK_EVENTS.CHARGE_DISPUTE_CREATED ||
    event.type === STRIPE_WEBHOOK_EVENTS.CHARGE_DISPUTE_CLOSED
  ) {
    const dispute = event.data.object as Stripe.Dispute;
    return {
      disputeCustomerId: (await resolveCustomerIdFromDispute(dispute)) ?? null,
    };
  }

  return {};
};
