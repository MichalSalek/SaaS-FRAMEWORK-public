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

// DECISION (nie usuwaj tego komentarza):
// D2-F1 (PRMA) — Set of Stripe webhook events whose payload IS a
// `Stripe.Subscription` object AND whose handler may call
// `extractPlanIdFromSubscription` (potentially `stripe.prices.retrieve`).
// For these we PRE-FETCH the planId BEFORE entering `$transaction(timeout:25s)`
// so the Stripe API latency (200-800ms typical, up to 20s degraded) doesn't
// eat the tx budget. Schedule events (subscription_schedule.*) are NOT in this
// set — they still resolve `schedule.subscription` inside the handler (separate
// concern, not flagged by D2-F1). Trial/Deleted handlers don't need planId.
// Shared by BOTH entry points into routeStripeEvent: the hot-path webhook
// (index.ts) and the janitor sweeper (stripe-event-janitor.operations.ts).
const SUBSCRIPTION_EVENTS_WITH_PLAN_LOOKUP: ReadonlySet<string> = new Set([
  STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_CREATED,
  STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_UPDATED,
  STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_PAUSED,
  STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_RESUMED,
  STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_PENDING_UPDATE_APPLIED,
  STRIPE_WEBHOOK_EVENTS.CUSTOMER_SUBSCRIPTION_PENDING_UPDATE_EXPIRED,
]);

/**
 * DECISION (nie usuwaj tego komentarza):
 * D2-F1 (PRMA) — `subscription_schedule.*` events carry `schedule.subscription`
 * as a STRING ID, so their handlers first had to `subscriptions.retrieve` it and
 * then — having no `prefetchedPlanId` to pass on — let `handleSubscriptionUpdated`
 * do a second `prices.retrieve`. Both ran INSIDE `$transaction(timeout:25s)` with
 * a 20s-per-call Stripe timeout (STRIPE_CONFIG.API_TIMEOUT_MS), i.e. a single
 * degraded call could eat the whole tx budget and roll the retry back into the
 * janitor. Schedule events are therefore resolved HERE, outside the tx, exactly
 * like the direct subscription events — no Stripe call remains on the in-tx path.
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
   * DECISION (nie usuwaj tego komentarza) — S113, 2026-09-10:
   * TRÓJSTAN, dokładnie jak `scheduleSubscription` niżej: `undefined` = prefetch NIE był
   * próbowany (event spoza zbioru, albo caller nie prefetchuje) → handler może rozwiązać
   * sam; `null` = próbowany i bez wyniku (błąd Stripe albo brak planu) → handler NIE
   * ponawia w transakcji.
   *
   * Wcześniej pole było dwustanowe i to była POŁOWA poprawki D2-F1. `prefetchSubscriptionPlanId`
   * łyka wyjątek i zwraca `undefined` z logiem „handler will fall back to current DB plan" —
   * ale handler NIE wracał do planu z bazy, tylko wołał `extractPlanIdFromSubscription`
   * JESZCZE RAZ, już wewnątrz `$transaction(timeout:25s)`. Przy zdegradowanym Stripie
   * (`API_TIMEOUT_MS` = 20 s) dawało to do 20 s poza transakcją i kolejne do 20 s w środku,
   * czyli odtwarzało dokładnie tę klasę, którą D2-F1 usuwa — a wywoływana funkcja ma
   * w swoim własnym DECISION napisane, że NIE WOLNO jej wołać wewnątrz transakcji.
   * Sąsiednie pole rozwiązało to trójstanem; `planId` po prostu nigdy go nie dostało.
   *
   * CENA TEJ ZMIANY (nazwana wprost, bo nie jest zerowa — przegląd S113):
   * tracimy JEDYNĄ retransmisję rozwiązania planu. `extractPlanIdFromPrice` sam łyka
   * błąd `prices.retrieve` i zwraca `null` bez zatruwania cache'u, więc poprzednio
   * druga próba — ta w transakcji — często się udawała. Dziś jej nie ma: event zostaje
   * zaklepany `processed=true`, Stripe go nie powtórzy, sprzątacz go nie weźmie.
   * Konkretny scenariusz: stylistka zmienia plan, Stripe ma chwilowy błąd na
   * `prices.retrieve`, `customer.subscription.updated` przechodzi, a konto zostaje na
   * STARYM planie mimo obciążenia karty. Ratunkiem jest dopiero `syncAccountWithStripe`
   * przy jej następnym logowaniu (i tylko bez `admin_plan_override`).
   * Wybór jest świadomy: 20 s trzymania transakcji przy zdegradowanym Stripie wywraca
   * cały webhook i wtacza sprzątacza w tę samą ścianę, więc cicha degradacja jednego
   * konta jest tańsza niż burza ponowień. Ale to JEST degradacja, nie czysty zysk —
   * przy statusach nieaktywnych nie ma nawet krytycznego alertu, bo ten wisi na
   * `isSubscriptionActive`. Gdyby to zaczęło boleć, właściwą naprawą jest ponowienie
   * prefetchu PRZED transakcją, nie powrót wywołania do środka.
   */
  planId?: string | null;
  /**
   * Full subscription behind `schedule.subscription` (schedule events only).
   * TRÓJSTAN, celowo: `undefined` = prefetch nie był próbowany (event nie jest
   * schedule'em, albo caller nie prefetchuje) → handler rozwiązuje sam; `null` =
   * próbowany i nieudany → handler NIE ponawia. Bez tego rozróżnienia nieudany
   * prefetch degradował się z powrotem w `subscriptions.retrieve` WEWNĄTRZ tx —
   * czyli przy awarii Stripe tracilibyśmy 20 s poza tx i kolejne 20 s w środku,
   * przywracając dokładnie tę klasę, którą D2-F1 usuwa.
   */
  scheduleSubscription?: Stripe.Subscription | null;
  /**
   * checkout.session.completed expanded with line items + subscription.
   *
   * DECISION (nie usuwaj tego komentarza): w PRZECIWIEŃSTWIE do pozostałych pól ten
   * lookup NIE połyka błędu — `sessions.retrieve` rzuca dalej. Gdyby prefetch zwrócił
   * po cichu `null`, a handler nie ponowił, transakcja zaklepałaby event jako
   * `processed=true` BEZ zaksięgowania płatności i Stripe nigdy by go nie powtórzył.
   * Throw przed transakcją = 500/retry w hot-pathu i policzona próba w janitorze,
   * czyli dokładnie to, co ta ścieżka musi robić przy niedostępnym Stripe.
   */
  checkoutSession?: Stripe.Checkout.Session;
  /**
   * Customer za chargem, którego dotyczy dispute (`charge.dispute.*`).
   * Trójstan jak przy `scheduleSubscription`: `undefined` = nie prefetchowano,
   * `null` = nie udało się ustalić (handler alarmuje, NIE ponawia w tx).
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
    // `?? null` — prefetch ZOSTAŁ wykonany, więc nawet brak wyniku musi być odróżnialny
    // od „nie próbowano". Bez tego handler ponawia wywołanie Stripe'a wewnątrz transakcji.
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
    // Ten sam guard co w routerze i z tego samego powodu: expandowanie sesji spoza
    // zakresu aplikacji to czysty, płatny round-trip. Router i tak odrzuci ją po
    // swojej stronie.
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
