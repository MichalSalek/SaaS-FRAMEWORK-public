import crypto from 'crypto';
import type Stripe from 'stripe';
import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AccountStripeError,
  CheckoutPlanNotFoundError,
  CheckoutPriceResolveError,
  PlanChangeNoSubscriptionError,
} from '@kernel/domain/user-and-account/account-errors.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import type {
  BillingPeriod,
  PlanChangeResponse,
} from '@kernel/domain/user-and-account/account-checkout.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { resolveCheckoutPrice_IO } from '@app/stripe/price-resolver.operations';
import { getPlanIdFromPricingPlanValue } from '@app/stripe/stripe.config';

/**
 * Mapuje stan latest_invoice (po subscriptions.update / retrieve) na PlanChangeResponse.
 *
 * DECISION (nie usuwaj tego komentarza): klasyfikacja po amount_remaining/amount_due +
 * confirmation_secret, NIE tylko po `status !== 'paid'`. Brak faktury LUB amount<=0
 * (downgrade/credit/$0 — zmiana aplikuje sie bez platnosci, np. period swap z kredytem) ->
 * `completed`. Nieoplacona + confirmation_secret -> SCA `requires_action`. Nieoplacona BEZ
 * secret (hard-decline / brak metody) -> `payment_failed` (zamyka klase falszywego 'completed'
 * na nieoplaconej fakturze, ktora mylila front zielonym sukcesem).
 */
const mapLatestInvoiceToPlanChange = (
  latestInvoice: Stripe.Subscription['latest_invoice']
): PlanChangeResponse => {
  // Brak faktury = zmiana bez platnosci (downgrade/credit/$0) -> completed.
  if (latestInvoice == null) {
    return { status: 'completed' };
  }
  // String = niezexpandowana faktura. Nie powinno wystapic (retrieve/update ZAWSZE
  // expanduja latest_invoice.confirmation_secret), ale defensywnie NIE zwracamy
  // 'completed' dla nieznanego stanu (falszywy zielony sukces) — payment_failed,
  // by front pokazal blad zamiast udawac sukces na nierozpoznanej fakturze.
  if (typeof latestInvoice === 'string') {
    return { status: 'payment_failed', reason: 'invoice_unexpanded' };
  }
  const amountRemaining =
    latestInvoice.amount_remaining ?? latestInvoice.amount_due ?? 0;
  if (latestInvoice.status === 'paid' || amountRemaining <= 0) {
    return { status: 'completed' };
  }
  const clientSecret = latestInvoice.confirmation_secret?.client_secret;
  if (clientSecret != null) {
    return { status: 'requires_action', clientSecret };
  }
  const status = latestInvoice.status;
  return status != null
    ? { status: 'payment_failed', reason: status }
    : { status: 'payment_failed' };
};

/**
 * SPE — zmiana planu paid->paid (D4) przez `subscription.update` z pending_if_incomplete.
 *
 * Precondition: istniejaca subskrypcja (subscription_id != null). proration_behavior:
 * 'always_invoice' + payment_behavior:'pending_if_incomplete' -> natychmiastowa faktura
 * proracyjna, ale cena aplikuje sie do subskrypcji DOPIERO po oplacie (porzucony 3DS NIE
 * przelacza planu; SSOT planu w DB ustawia webhook pending_update_applied). Zwraca completed
 * (oplacona/credit), requires_action (SCA inline + clientSecret) lub payment_failed (decline).
 */
export const changePaidPlan_IO = async ({
  userId,
  targetPlanId,
  billingPeriod,
}: {
  userId: string;
  targetPlanId: PricingPlan;
  billingPeriod: BillingPeriod;
}): Promise<
  OperationResult<
    PlanChangeResponse,
    | PlanChangeNoSubscriptionError
    | CheckoutPlanNotFoundError
    | CheckoutPriceResolveError
    | AccountStripeError
    | AccountNotFoundError
    | DatabaseError
  >
> => {
  let user;
  try {
    user = await DB_CLIENT.use.user.findUnique({
      where: { id: userId },
      select: {
        stylist_account: {
          select: {
            account_id: true,
            subscription_id: true,
          },
        },
      },
    });
  } catch (error) {
    return databaseFailure('changePaidPlan:fetchUser', error);
  }

  if (!user?.stylist_account) {
    return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: userId });
  }

  const { account_id: accountId, subscription_id: subscriptionId } =
    user.stylist_account;

  if (subscriptionId == null) {
    return failure({ type: 'PLAN_CHANGE_NO_SUBSCRIPTION', accountId });
  }

  const priceResult = await resolveCheckoutPrice_IO({
    planId: targetPlanId,
    billingPeriod,
  });
  if (!priceResult.success) {
    return failure(priceResult.error);
  }
  const targetPriceId = priceResult.data.priceId;
  const stripePlanId = getPlanIdFromPricingPlanValue(targetPlanId);

  const stripe = getStripe();

  let subscription: Stripe.Subscription;
  try {
    // Expand latest_invoice.confirmation_secret już w initial retrieve — potrzebne przez
    // no-op guard niżej do wykrycia porzuconego SCA na proracyjnej fakturze poprzedniej zmiany.
    subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice.confirmation_secret'],
    });
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'changePaidPlan:retrieve',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  const currentItem = subscription.items.data[0];
  if (currentItem == null) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'changePaidPlan:retrieve',
      stripeError: 'Subscription has no line items to update',
    });
  }

  // === GUARD: pending_update (pending_if_incomplete trzyma cene w pending do oplaty) ===
  // DECISION (nie usuwaj tego komentarza):
  // Z payment_behavior:'pending_if_incomplete' zmiana ceny NIE aplikuje sie do itemu dopoki
  // platnosc nie przejdzie — subscription.pending_update trzyma docelowy item, a currentItem
  // ZOSTAJE na STAREJ cenie. Dlatego stary no-op guard (currentItem.price===target) NIE wykrywa
  // juz in-flight zmiany (S59 zakladal immediate-apply, ktore wlasnie odwracamy). Nowy guard:
  //  - pending istnieje i celuje w targetPriceId -> double-submit na ten sam plan: re-surface
  //    istniejacy confirmation_secret z latest_invoice (NIE wolaj update drugi raz — Stripe
  //    voiduje poprzednia fakture + tworzy nowa, kasujac dzialajacy secret = zerwany 3DS usera).
  //  - pending istnieje ale celuje w INNY plan -> user zmienil zdanie: SUPERSEDE (przejdz do
  //    update; Stripe SWIADOMIE voiduje poprzedni pending i tworzy nowy dla nowego targetu).
  //  - brak pending, currentItem juz na target -> zmiana zaaplikowana (pending_update_applied)
  //    LUB realny no-op: mapuj latest_invoice (porzucony SCA z tej zmiany -> requires_action).
  const pendingUpdate = subscription.pending_update;
  if (pendingUpdate != null) {
    const pendingPrice = pendingUpdate.subscription_items?.[0]?.price;
    const pendingPriceId =
      typeof pendingPrice === 'string'
        ? pendingPrice
        : (pendingPrice?.id ?? null);
    if (pendingPriceId === targetPriceId) {
      // Double-submit na ten sam target -> re-surface istniejacy stan, BEZ drugiego update.
      return success(mapLatestInvoiceToPlanChange(subscription.latest_invoice));
    }
    // Inny target -> supersede: kontynuuj do update nizej (Stripe voiduje poprzedni pending).
  } else if (currentItem.price?.id === targetPriceId) {
    // Brak pending, juz na docelowej cenie -> zaaplikowane lub no-op (mapuj fakture).
    return success(mapLatestInvoiceToPlanChange(subscription.latest_invoice));
  }

  // === UPDATE: pending_if_incomplete + always_invoice ===
  // DECISION (nie usuwaj tego komentarza):
  // proration_behavior:'always_invoice' WYMUSZA natychmiastowa fakture proracyjna — 'create_prorations'
  // dokladaloby prorate dopiero do NAST. faktury okresowej, wiec immediate SCA by NIE powstal dla
  // same-interval paid->paid (Codex CRITICAL-1). payment_behavior:'pending_if_incomplete' trzyma zmiane
  // w subscription.pending_update dopoki faktura nie zostanie oplacona -> porzucony 3DS NIE przelacza
  // planu (caly cel F1). SSOT planu w DB = webhook (pending_update_applied -> sync nowy; expired -> keep
  // stary). API Basil ('2025-12-15.clover'): SCA przez latest_invoice.confirmation_secret (payment_intent
  // USUNIETY — NIE wracac do expand payment_intent). metadata.planId=target jest ustawiana, ALE webhook
  // wyznacza plan z CENY ITEMU (extractPlanIdFromSubscription price-first), NIE z metadata — inaczej
  // metadata=target (aplikuje sie natychmiast) wymusilaby sync planu PRZED oplata.
  // idempotencyKey random per-invocation (parytet account-embedded-checkout): chroni network-retry TEGO
  // zadania (zgubiona odpowiedz -> ten sam update, nie druga proracja). Deterministyczny ODRZUCONY:
  // intencja A->B->A w 24h trafilaby 24h-cache idempotencji Stripe i zwrocila STARY wynik. Residual
  // true-concurrent double-POST (oba przed widocznym pending) = znany, akceptowany pre-launch (frontendowy
  // busy-guard + pending-guard wyzej zwezaja okno); advisory-lock = over-eng (rule-of-three niespelniony).
  const idempotencyKey = crypto.randomUUID();
  let updated: Stripe.Subscription;
  try {
    updated = await stripe.subscriptions.update(
      subscriptionId,
      {
        items: [{ id: currentItem.id, price: targetPriceId }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
        metadata: { planId: stripePlanId, billingPeriod },
        expand: ['latest_invoice.confirmation_secret'],
      },
      { idempotencyKey }
    );
  } catch (error: unknown) {
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'changePaidPlan:update',
      stripeError: error instanceof Error ? error.message : String(error),
    });
  }

  return success(mapLatestInvoiceToPlanChange(updated.latest_invoice));
};
