/**
 * Tri-state `planId` in the Stripe prefetch.
 *
 * Bug class pinned here: `planId` was TWO-state, so "the prefetch failed" was indistinguishable
 * from "no prefetch was attempted". The subscription handler treated both alike and, after a
 * failed prefetch, called `extractPlanIdFromSubscription` AGAIN inside `$transaction(timeout:
 * 25 s)`. On a degraded Stripe (SDK timeout 20 s) that is up to 20 s outside plus 20 s inside:
 * the tx fails, the row returns to `processed=false` and the janitor rolls it into the same wall.
 * The sibling field (`scheduleSubscription`) was tri-state from the start.
 *
 * The test pins the contract at the seam, not the implementation: prefetch ATTEMPTED => never
 * `undefined`. Replacing `?? null` with `planId !== undefined ? { planId } : {}` fails this suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import { STRIPE_WEBHOOK_EVENTS } from '@app/stripe/stripe.config';

const prefetchSubscriptionPlanId = vi.fn();
const isOutOfScopeSession = vi.fn((_metadata: unknown) => false);

vi.mock('@app/stripe/webhooks/stripe-webhooks.utils', () => ({
  prefetchSubscriptionPlanId: (subscription: unknown) =>
    prefetchSubscriptionPlanId(subscription),
  isOutOfScopeSession: (metadata: unknown) => isOutOfScopeSession(metadata),
}));
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({
    checkout: { sessions: { retrieve: vi.fn() } },
  }),
}));
vi.mock('@app/stripe/webhooks/handlers/checkout.handler', () => ({
  CHECKOUT_SESSION_EXPAND: ['line_items'],
}));
vi.mock('@app/stripe/webhooks/handlers/charge-dispute.handler', () => ({
  resolveCustomerIdFromDispute: vi.fn(),
}));
vi.mock('@app/stripe/webhooks/handlers/subscription-schedule.handler', () => ({
  resolveScheduleSubscription: vi.fn(),
}));

const subscriptionEvent = (): Stripe.Event =>
  ({
    type: STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_UPDATED,
    data: { object: { id: 'sub_probe_113' } },
  }) as unknown as Stripe.Event;

describe('prefetchStripeEventContext — trójstan planId (D2-F1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('nieudany prefetch daje planId === null, NIE undefined', async () => {
    // `prefetchSubscriptionPlanId` swallows the Stripe exception and returns undefined.
    prefetchSubscriptionPlanId.mockResolvedValue(undefined);
    const { prefetchStripeEventContext } =
      await import('./stripe-event-prefetch');

    const result = await prefetchStripeEventContext(subscriptionEvent());

    // This is the whole point: the handler must tell "attempted and failed" from "not
    // attempted". `undefined` here would mean another Stripe call inside the transaction.
    expect(result.planId).toBeNull();
    expect(result.planId).not.toBeUndefined();
    expect('planId' in result).toBe(true);
  });

  it('udany prefetch przekazuje planId dalej bez zmian', async () => {
    prefetchSubscriptionPlanId.mockResolvedValue('app-price-pro-monthly');
    const { prefetchStripeEventContext } =
      await import('./stripe-event-prefetch');

    const result = await prefetchStripeEventContext(subscriptionEvent());

    expect(result.planId).toBe('app-price-pro-monthly');
  });

  it('event spoza zbioru NIE ustawia planId (undefined = nie próbowano)', async () => {
    const { prefetchStripeEventContext } =
      await import('./stripe-event-prefetch');

    const result = await prefetchStripeEventContext({
      type: 'invoice.paid',
      data: { object: {} },
    } as unknown as Stripe.Event);

    // Here `undefined` is CORRECT and means something other than null: nobody prefetched,
    // so the handler may resolve the plan itself (backward-compatible path).
    expect(result.planId).toBeUndefined();
    expect(prefetchSubscriptionPlanId).not.toHaveBeenCalled();
  });
});
