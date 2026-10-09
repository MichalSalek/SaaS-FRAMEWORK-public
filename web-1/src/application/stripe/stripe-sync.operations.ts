import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  AccountStatusValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import {
  mapStripeStatusToSubscriptionStatus,
  mapStripeStatusToPaymentStatus,
} from '@kernel/models/db_models.manual.dto';
import { TIME } from '@kernel/application/constants.config';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  DEFAULT_PLAN_ID,
  getPricingPlanValueFromPlanId,
  getValidPlanIds,
  isStripeSubscriptionActive,
} from './stripe.config';
import { getStripe } from './adapters/stripe.adapter';
import {
  dispatchCriticalAlert,
  extractPlanIdFromSubscription,
} from './webhooks/stripe-webhooks.utils';
import { updateAccountPlanStatus } from './plan-status-update.operations';
import { stripeDashboardLinkProp } from '@app/stripe/stripe-dashboard.links';

/**
 * Sync stylist account's subscription data from Stripe
 * Safety net in case webhooks fail
 */
export const syncAccountWithStripe = async ({
  accountId,
}: {
  accountId: string;
}): Promise<void> => {
  const stripe = getStripe();
  const account = await DB_CLIENT.use.stylistAccount.findUnique({
    where: { account_id: accountId },
    select: {
      account_id: true,
      stripe_customer_id: true,
      subscription_id: true,
      pricing_plan: true,
      payment_status: true,
      account_status: true,
      subscription_status: true,
      admin_plan_override: true,
    },
  });

  if (!account) {
    reportIssueBackend({
      namespace: 'STRIPE_SYNC',
      message: 'Account not found for sync',
      payload: { accountId },
      mode: 'warn',
    });
    return;
  }

  // No Stripe customer ID = account never subscribed
  if (!account.stripe_customer_id) {
    return;
  }

  // OWNER-001: admin przypiął plan (adminChangePricingPlan_IO / adminBulkChangePlan_IO) — login-time
  // safety-net sync NIE może nadpisać ręcznie nadanego pricing_plan. Stripe webhooks zostają
  // autorytatywne dla statusu; ten guard ucina tylko user-triggered sync (better-auth-hooks @ login).
  if (account.admin_plan_override) {
    reportIssueBackend({
      namespace: 'STRIPE_SYNC_ADMIN_OVERRIDE',
      message: 'Skipping sync - admin plan override is set',
      payload: { accountId: account.account_id },
      mode: 'info',
    });
    return;
  }

  try {
    // First verify the Stripe customer exists
    let customerExists = true;
    try {
      const customer = await stripe.customers.retrieve(
        account.stripe_customer_id
      );
      customerExists = !('deleted' in customer && customer.deleted);
    } catch {
      customerExists = false;
    }

    if (!customerExists) {
      // Stripe customer doesn't exist - clear the invalid stripe_customer_id and reset
      reportIssueBackend({
        namespace: 'STRIPE_SYNC_INVALID_CUSTOMER',
        message:
          'Stripe customer ID in database does not exist in Stripe - resetting account',
        payload: {
          accountId: account.account_id,
          invalidStripeCustomerId: account.stripe_customer_id,
        },
        mode: 'warn',
      });

      // DECISION (nie usuwaj tego komentarza): spadek do Free (dunning/sync) = ACTIVE, nie NOT_ACTIVE — darmowe konto pozostaje widoczne w discovery, spójnie z subscription-deleted.handler.ts i ścieżkami tworzenia konta. Dane nie są usuwane, tylko ograniczone limitami Free.
      await DB_CLIENT.use.stylistAccount.update({
        where: { account_id: account.account_id },
        data: {
          stripe_customer_id: null,
          payment_status: PaymentStatusValue.UNPAID,
          pricing_plan: PricingPlanValue.FREE,
          account_status: AccountStatusValue.ACTIVE,
          subscription_status: SubscriptionStatusValue.CANCELED,
          subscription_id: null,
          cancel_at_period_end: false,
          cancel_at: null,
          current_period_end: null,
          // BUG-002: reset do FREE => Stripe-owned daty wyzerowane.
          account_expiration_date: null,
          upcoming_payment_date: null,
        },
      });
      return;
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: account.stripe_customer_id,
      status: 'all',
      limit: 5, // We only care about the most recent relevant ones
    });

    // Prefer active/trialing, otherwise most recently created
    const latestSubscription =
      subscriptions.data.find(s =>
        isStripeSubscriptionActive({ status: s.status })
      ) ?? subscriptions.data.sort((a, b) => b.created - a.created)[0];

    if (latestSubscription == null) {
      // No subscriptions in Stripe - check if we need to reset
      if (
        account.payment_status === PaymentStatusValue.PAID ||
        account.subscription_id != null
      ) {
        reportIssueBackend({
          namespace: 'STRIPE_SYNC',
          message:
            'No subscriptions in Stripe but account has subscription data - resetting',
          payload: {
            accountId: account.account_id,
            stripeCustomerId: account.stripe_customer_id,
          },
          mode: 'warn',
        });

        // DECISION (nie usuwaj tego komentarza): spadek do Free (dunning/sync) = ACTIVE, nie NOT_ACTIVE — darmowe konto pozostaje widoczne w discovery, spójnie z subscription-deleted.handler.ts i ścieżkami tworzenia konta. Dane nie są usuwane, tylko ograniczone limitami Free.
        await DB_CLIENT.use.stylistAccount.update({
          where: { account_id: account.account_id },
          data: {
            payment_status: PaymentStatusValue.UNPAID,
            pricing_plan: PricingPlanValue.FREE,
            account_status: AccountStatusValue.ACTIVE,
            subscription_status: SubscriptionStatusValue.CANCELED,
            subscription_id: null,
            cancel_at_period_end: false,
            cancel_at: null,
            current_period_end: null,
            // BUG-002: reset do FREE => Stripe-owned daty wyzerowane.
            account_expiration_date: null,
            upcoming_payment_date: null,
          },
        });
      }
      return;
    }

    // Extract planId from subscription using SSOT function
    const stripePlanId: string | undefined =
      await extractPlanIdFromSubscription(latestSubscription);

    const isActive = isStripeSubscriptionActive({
      status: latestSubscription.status,
    });
    const cancelAt = latestSubscription.cancel_at
      ? new Date(latestSubscription.cancel_at * 1000)
      : null;
    const cancelAtPeriodEnd =
      latestSubscription.cancel_at_period_end || Boolean(cancelAt);
    const firstItemPeriodEnd =
      latestSubscription.items.data[0]?.current_period_end;
    const currentPeriodEnd = firstItemPeriodEnd
      ? new Date(firstItemPeriodEnd * 1000)
      : null;

    // Validate and resolve planId
    const validPlanIds = getValidPlanIds();
    const isStripePlanIdValid =
      stripePlanId !== undefined && validPlanIds.includes(stripePlanId);

    // A NON-EMPTY but invalid planId (typo/legacy value in Stripe metadata)
    // must never silently resolve to DEFAULT_PLAN_ID — that could downgrade a
    // paying customer. Keep the fallback (sync is a best-effort safety net and
    // webhook-priority deferral below usually prevents the plan write anyway),
    // but surface a critical alert so the operator fixes the Stripe metadata.
    if (stripePlanId !== undefined && !isStripePlanIdValid) {
      reportIssueBackend({
        namespace: 'STRIPE_SYNC_INVALID_PLANID',
        message:
          'CRITICAL: Stripe subscription carries an invalid planId - falling back to default plan, alert sent to admins',
        payload: {
          accountId: account.account_id,
          subscriptionId: latestSubscription.id,
          stripePlanId,
          validPlanIds,
        },
        mode: 'error',
      });
      dispatchCriticalAlert({
        context: 'STRIPE_SYNC_INVALID_PLANID',
        diagnostic: {
          accountId: account.account_id,
          subscriptionId: latestSubscription.id,
        },
        alert: {
          alertTitle: 'Stripe: subskrypcja z nieznanym planId',
          alertMessage:
            'Synchronizacja ze Stripe dostała planId spoza mapy planów. ' +
            `Rozstrzygnięcie przyjmuje „${DEFAULT_PLAN_ID}” (priorytet webhooka może zachować plan z bazy). ` +
            'Popraw metadane produktu lub ceny w panelu Stripe.',
          ...stripeDashboardLinkProp('subscriptions', latestSubscription.id),
          details: {
            accountId: account.account_id,
            subscriptionId: latestSubscription.id,
            stripePlanId,
            validPlanIds,
            timestamp: new Date().toISOString(),
          },
        },
      });
    }

    const resolvedPlanId = isStripePlanIdValid ? stripePlanId : DEFAULT_PLAN_ID;

    const pricingPlanValue = getPricingPlanValueFromPlanId(resolvedPlanId);

    // ENTITLEMENT-ACTIVE GATE parity (census 2026-07-09, F5): plan płatny tylko
    // gdy subskrypcja realnie daje dostęp — dla martwej (canceled/incomplete_
    // expired/unpaid/paused) rekonsyliujemy do FREE, dokładnie jak
    // subscription-lifecycle.handler. Bez tego sync pisałby plan z metadata
    // martwej subskrypcji (metadata przeżywa cancel).
    const entitledPlanValue = isActive
      ? pricingPlanValue
      : PricingPlanValue.FREE;

    // Status parity: `canceled` = stan terminalny obsłużony przez
    // subscription-deleted.handler jako FREE+ACTIVE (darmowe konto widoczne w
    // discovery) — sync naprawiający ten stan nie może zostawić konta w
    // NOT_ACTIVE (operacyjnie zablokowane mimo ważnego darmowego planu).
    // Pozostałe nieaktywne statusy: NOT_ACTIVE, jak w lifecycle handlerze.
    const nextAccountStatus = isActive
      ? AccountStatusValue.ACTIVE
      : latestSubscription.status === 'canceled'
        ? AccountStatusValue.ACTIVE
        : AccountStatusValue.NOT_ACTIVE;
    const nextSubscriptionStatus = mapStripeStatusToSubscriptionStatus(
      latestSubscription.status
    );
    // SCDUN-1: payment_status pochodzi z subscription_status (PAST_DUE/UNPAID ->
    // IN_PROGRESS), nie binarnie z isActive — spojnie z subscription-lifecycle.handler.
    // Bez tego safety-net nadpisywal efemeryczny IN_PROGRESS na PAID dla kont w dunningu.
    const nextPaymentStatus = mapStripeStatusToPaymentStatus(
      nextSubscriptionStatus
    );

    // CRITICAL LOGIC: Determine if we should update planId
    const isNewOrDifferentSubscription =
      !account.subscription_id ||
      account.subscription_id !== latestSubscription.id;

    // DECISION (nie usuwaj tego komentarza):
    // Webhook-priority deferral dotyczy WYŁĄCZNIE ŻYWEJ subskrypcji (isActive):
    // tam plan-write'y dowiozą webhooki. Dla MARTWEJ subskrypcji o tym samym
    // subscription_id żaden webhook już nie przyjdzie — sync MUSI być
    // autorytatywny, inaczej deklaracja „stripe-sync rekonsyliuje" przy
    // SAME-SECOND TIE (plan-status-update.operations.ts) jest pusta dla klasy
    // resurrection: PAID-plan re-linkowany do canceled sub zostawał na zawsze
    // (entitlement czyta wyłącznie pricing_plan).
    const shouldUpdatePlanId =
      (isNewOrDifferentSubscription || !isActive) &&
      account.pricing_plan !== entitledPlanValue;

    // Status/date changes that sync should always apply
    const hasStatusChanges =
      account.subscription_status !== nextSubscriptionStatus ||
      account.payment_status !== nextPaymentStatus ||
      account.account_status !== nextAccountStatus;

    const hasChanges = isNewOrDifferentSubscription || hasStatusChanges;

    if (!hasChanges) {
      reportIssueBackend({
        namespace: 'STRIPE_SYNC_NO_CHANGES',
        message: 'Sync found no changes - skipping update',
        payload: {
          accountId: account.account_id,
          subscriptionId: latestSubscription.id,
        },
        mode: 'info',
      });
      return;
    }

    // DECISION (nie usuwaj tego komentarza):
    // RMW (read-modify-write) okno: account czytany ~L30-41, potem ~10 await
    // Stripe API calls, potem updateAccountPlanStatus z polem `pricingPlan`
    // z potencjalnie nieświeżego snapshotu. updateAccountPlanStatus używa
    // `stylistAccount.update({ WHERE account_id })` — brak conditional guard
    // (no WHERE pricing_plan=expected, no optimistic locking).
    //
    // Dlaczego to AKCEPTOWALNE dla tej funkcji:
    // 1. syncAccountWithStripe to SAFETY NET (nie webhook). Uruchamiany na
    //    żądanie (panel admina, SSO-callback) gdy webhook mógł nie dotrzeć.
    //    Nie jest autorytatywnym źródłem prawdy — webhook jest.
    // 2. Webhook-priority deferral (L224-238): gdy subscription_id w DB
    //    odpowiada latestSubscription.id (ten sam sub), sync PRZEPISUJE
    //    account.pricing_plan (stary snapshot) zamiast stripePlanValue —
    //    czyli NIE zmienia planu, pozwala webhookowi być autorytatywnym.
    //    shouldUpdatePlanId=false tylko gdy subscription się zmieniło.
    // 3. Status fields (payment_status, account_status, subscription_status)
    //    są przepisywane bezwarunkowo — to jest celowe. Sync ma za zadanie
    //    naprawić ew. rozbieżność statusu. W najgorszym razie nadpisze wartość
    //    identyczną (idempotentne).
    // 4. Prawdziwy race: webhook Stripe zmienia pricing_plan między snapshotten
    //    a updateAccountPlanStatus. Prawdopodobieństwo: niskie (sync wywoływany
    //    user-triggered, nie w pętli). Konsekwencja: plan przywrócony do stanu
    //    Stripe API (nie webhook) — ten sam wynik przy braku race. Kolejny
    //    webhook (np. invoice.paid) skoryguje jeśli rozbieżność.
    //
    // Gdyby sync miał być transakcyjny: potrzeba tx + WHERE subscription_id=
    // latestSubscription.id (optymistyczna blokada na ID subscrypcji).
    // To zbędne dla safety-net o niskim throughput. Klasa D (best-effort).

    // Log decision reasoning
    if (shouldUpdatePlanId) {
      reportIssueBackend({
        namespace: 'STRIPE_SYNC_PLANID_UPDATED',
        message:
          'Sync updating planId - new or different subscription detected',
        payload: {
          accountId: account.account_id,
          oldSubscriptionId: account.subscription_id,
          newSubscriptionId: latestSubscription.id,
          oldPlanId: account.pricing_plan,
          newPlanId: entitledPlanValue,
          reason: isNewOrDifferentSubscription
            ? 'new_subscription'
            : 'dead_subscription_reconciled',
        },
        mode: 'info',
      });
    } else if (account.pricing_plan !== entitledPlanValue) {
      reportIssueBackend({
        namespace: 'STRIPE_SYNC_PLANID_SKIPPED',
        message:
          'Sync skipping planId update - same subscription (webhook has priority)',
        payload: {
          accountId: account.account_id,
          subscriptionId: latestSubscription.id,
          dbPlanId: account.pricing_plan,
          stripePlanId: pricingPlanValue,
          reason: 'webhook_priority',
        },
        mode: 'info',
      });
    }

    await updateAccountPlanStatus({
      accountId: account.account_id,
      pricingPlan: shouldUpdatePlanId
        ? entitledPlanValue
        : account.pricing_plan,
      paymentStatus: nextPaymentStatus,
      accountStatus: nextAccountStatus,
      subscriptionStatus: nextSubscriptionStatus,
      subscriptionId: latestSubscription.id,
      cancelAtPeriodEnd,
      cancelAt,
      currentPeriodEnd,
      // BUG-002: Stripe owns these (ta sama derywacja co subscription-lifecycle.handler).
      accountExpirationDate: cancelAt ?? currentPeriodEnd,
      upcomingPaymentDate: currentPeriodEnd
        ? new Date(currentPeriodEnd.getTime() - 7 * TIME.MS_PER_DAY)
        : null,
      oldPricingPlan: account.pricing_plan,
      source: 'sync',
    });
  } catch (error) {
    reportIssueBackend({
      namespace: 'STRIPE_SYNC_ERROR',
      message: 'Failed to sync account with Stripe',
      payload: {
        accountId,
        stripeCustomerId: account.stripe_customer_id,
        error,
      },
      mode: 'error',
    });
  }
};
