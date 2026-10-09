/**
 * D2-F1 — trójstan `planId` w prefetchu Stripe'a.
 *
 * KLASA BŁĘDU, którą ta suita pinuje (S113, 2026-09-10): pole `planId` było DWUSTANOWE,
 * więc „prefetch się nie udał" było nieodróżnialne od „prefetchu nie robiono". Handler
 * subskrypcji traktował oba przypadki tak samo i przy nieudanym prefetchu wołał
 * `extractPlanIdFromSubscription` PONOWNIE — już wewnątrz `$transaction(timeout: 25 s)`.
 * Przy zdegradowanym Stripie (timeout SDK 20 s) dawało to do 20 s poza transakcją i
 * kolejne do 20 s w środku: transakcja padała, wiersz wracał do `processed=false`,
 * a sprzątacz wtaczał go w tę samą ścianę. Czyli dokładnie ta klasa, którą D2-F1 usuwa —
 * i to w momencie, w którym boli najbardziej, bo odpala się WYŁĄCZNIE gdy Stripe już
 * nie odpowiada. Sąsiednie pole (`scheduleSubscription`) miało trójstan od początku;
 * `planId` nigdy go nie dostało.
 *
 * Test pilnuje kontraktu na styku, nie implementacji: prefetch PRÓBOWANY ⇒ nigdy
 * `undefined`. Zamiana `?? null` z powrotem na `planId !== undefined ? { planId } : {}`
 * wywraca tę suitę.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import { STRIPE_WEBHOOK_EVENTS } from '@app/stripe/stripe.config';

const prefetchSubscriptionPlanId = vi.fn();
const isOutOfScopeSession = vi.fn((_metadata: unknown) => false);

vi.mock('@app/stripe/webhooks/stripe-webhooks.utils', () => ({
  prefetchSubscriptionPlanId: (subscription: unknown) =>
    prefetchSubscriptionPlanId(subscription),
  isOutOfScopeSession: (metadata: unknown) =>
    isOutOfScopeSession(metadata),
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
    // `prefetchSubscriptionPlanId` łyka wyjątek Stripe'a i zwraca undefined.
    prefetchSubscriptionPlanId.mockResolvedValue(undefined);
    const { prefetchStripeEventContext } =
      await import('./stripe-event-prefetch');

    const result = await prefetchStripeEventContext(subscriptionEvent());

    // To jest CAŁY sens poprawki: handler musi odróżnić „próbowano i nie wyszło"
    // od „nie próbowano". `undefined` tutaj = ponowne wywołanie Stripe'a w transakcji.
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

    // Tu `undefined` jest POPRAWNE i znaczy co innego niż null: nikt nie prefetchował,
    // więc handler ma prawo rozwiązać plan sam (ścieżka zgodności wstecz).
    expect(result.planId).toBeUndefined();
    expect(prefetchSubscriptionPlanId).not.toHaveBeenCalled();
  });
});
