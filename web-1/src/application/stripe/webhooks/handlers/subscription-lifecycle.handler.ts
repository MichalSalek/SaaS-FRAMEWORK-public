import type Stripe from 'stripe';
import type { Prisma } from '../../../../prisma/js-client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { AccountStatus } from '@kernel/models/db_models.generated.dto';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  mapStripeStatusToSubscriptionStatus,
  mapStripeStatusToPaymentStatus,
} from '@kernel/models/db_models.manual.dto';
import { TIME } from '@kernel/application/constants.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  isStripeSubscriptionActive,
  getPlanIdFromPricingPlanValue,
  getValidPlanIds,
  UNKNOWN_PLAN_ID,
} from '@app/stripe/stripe.config';
import {
  updateAccountPlanStatus,
  bumpStripeEventWatermark,
} from '@app/stripe/plan-status-update.operations';
import { acquireAdvisoryXactLock } from '@app/db/lock-rows';
import {
  hasPendingUpdate,
  hasActiveSchedule,
  extractSubscriptionDateFields,
} from '@app/stripe/subscription-schedule.utils';
import { findAccountByCustomerId } from '@app/stripe/webhooks/stripe-webhooks.db';
import {
  extractCustomerId,
  extractPlanIdFromSubscription,
  getPricingPlanOrFallback,
} from '@app/stripe/webhooks/stripe-webhooks.utils';
import {
  emptyEffectsResult,
  type StripeHandlerResult,
  type StripeWebhookEffect,
} from '@app/stripe/webhooks/stripe-effects.types';
import {
  updateAccountStatusWithoutPlanChange,
  buildSubscriptionAnalyticsEffects,
  handleChurnAlert,
  handleDowngradeAlert,
  handleTrialFieldsUpdate,
  hasSubscriptionStateChanged,
  type SubscriptionStateNext,
} from './subscription-update.utils';
import { buildSubscriptionNoPlanAlertEffect } from './subscription-no-plan.alert';

/** Handle customer.subscription.updated event
 *
 * DECISION (nie usuwaj tego komentarza):
 * D2-F1 (PRMA) — `prefetchedPlanId` is the planId resolved BEFORE the webhook
 * `$transaction` via `prefetchSubscriptionPlanId`. Passing it in keeps the
 * external Stripe API call (`stripe.prices.retrieve` inside
 * `extractPlanIdFromSubscription`) out of the tx critical path.
 *
 * TRÓJSTAN (S113): `undefined` = prefetchu NIE było → wolno rozwiązać w locie;
 * `null` = prefetch był i nie dał planu → NIE ponawiamy, schodzimy tą samą ścieżką
 * degradacji co nierozpoznany planId (zostaje plan z bazy + krytyczny alert niżej).
 * Poprzednia wersja traktowała nieudany prefetch jak brak prefetchu i wołała Stripe'a
 * wewnątrz transakcji — czyli najgorzej dokładnie wtedy, gdy Stripe już nie odpowiada.
 * Reszta komentarza (fan-in harmonogramu) zostaje aktualna
 * paths (subscription_schedule.*).
 */
export const handleSubscriptionUpdated = async ({
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
  const effects: StripeWebhookEffect[] = [];

  const customerId = extractCustomerId({ customer: subscription.customer });
  if (!customerId) {
    reportIssueBackend({
      namespace: 'STRIPE_SUBSCRIPTION_UPDATED',
      message: 'No customer ID in subscription',
      payload: { subscriptionId: subscription.id },
      mode: 'error',
    });
    return emptyEffectsResult();
  }

  // DECISION (nie usuwaj tego komentarza) — SPAR-005 (per-account serialization PRZED odczytem
  // snapshotu): dwa współbieżne `subscription.updated` tego samego konta (np. schedule-cancel T1
  // ‖ rescind T2) czytały ten sam pre-write snapshot S0. D10 no-op-gate niżej porównuje ten
  // snapshot: starszy cancel pisał cancel=true (recency-CAS watermark T1), a nowszy rescind widział
  // S0.cancel=false == rescind.cancel=false → „no change" → SKIP, więc recency-CAS NIGDY nie
  // advansował i nowszy rescind ginął za starszym cancelem (involuntary churn). Advisory xact-lock
  // (PgBouncer-safe, klucz=customerId) serializuje handler per-konto: drugi czeka, po commitcie
  // pierwszego `findAccountByCustomerId` czyta JUŻ świeży snapshot (cancel=true) → gate widzi zmianę
  // → recency-CAS z T2 wygrywa. Ten xact-lock jest JEDYNĄ serializacją per-konto: hot-path miał
  // kiedyś także session-level advisory lock, ale był event-keyed (więc i tak nie obejmował tego
  // wyścigu — dotyczy DWÓCH RÓŻNYCH eventów jednego konta) i martwy pod poolingiem, więc został
  // usunięty. `tx` obecny w hot-path i janitorze; poza tx (edge) skip = brak serializacji (best-effort).
  if (tx) {
    await acquireAdvisoryXactLock(tx, customerId);
  }

  const account = await findAccountByCustomerId(customerId, tx);
  if (!account) {
    return emptyEffectsResult();
  }

  // DECISION (nie usuwaj tego komentarza):
  // OUT-OF-ORDER RESURRECTION — CLOSED (turbo-review S54, schema fix S54+). This
  // fan-in handler's plan write goes through updateAccountPlanStatus with
  // `stripeEventAt: eventCreatedAt`, which atomically skips the write when a NEWER
  // Stripe event already landed (last_stripe_event_at > eventCreatedAt). So a
  // delayed/retried `subscription.updated` carrying a stale `active` snapshot,
  // delivered AFTER `subscription.deleted` reset the account to FREE (and bumped
  // last_stripe_event_at past the stale event), no longer re-links the canceled
  // subscription to PAID. Effects (churn/trial) computed below from the stale
  // account are harmless on a skipped write (idempotent + the no-op gate at D10).
  const isSubscriptionActive = isStripeSubscriptionActive({
    status: subscription.status,
  });

  // DECISION (nie usuwaj tego komentarza):
  // NON-CANONICAL NON-ACTIVE GUARD (testy-api closing-review) — parytet z
  // subscription-deleted.handler „non-current subscription, ignoring". Konto może
  // mieć aktywną, płacącą subskrypcję A (subscription_id=A) ORAZ osieroconą wtórną
  // subskrypcję B (double-submit checkoutu / porzucony re-subscribe). B przechodzi
  // `incomplete → incomplete_expired`, co Stripe emituje jako `customer.subscription.updated`
  // (NIE `.deleted` → NIE trafia do guarded deleted-handlera, tylko TUTAJ). Bez tego
  // guardu ENTITLEMENT-ACTIVE GATE niżej (non-active ⇒ FREE) zdowngrade'owałby PŁACĄCE
  // konto do FREE na podstawie martwej sub B (i przepiął subscription_id na B). Guard
  // celowo TYLKO dla non-active: aktywne eventy zachowują dotychczasowe zachowanie
  // (przełączenie na realnie aktywną subskrypcję). Canonical (subscription_id NULL lub
  // == event) przechodzi normalnie. Recency-guard NIE wystarcza — B ma nowszy
  // event.created niż ostatni event A, więc przeszedłby `lte`.
  if (
    !isSubscriptionActive &&
    account.subscription_id != null &&
    account.subscription_id !== subscription.id
  ) {
    reportIssueBackend({
      namespace: 'STRIPE_SUBSCRIPTION_UPDATED',
      message:
        'Non-active event for non-current subscription — ignoring (paying account not downgraded by orphaned secondary sub)',
      payload: {
        accountId: account.account_id,
        currentSubscriptionId: account.subscription_id,
        eventSubscriptionId: subscription.id,
        status: subscription.status,
      },
      mode: 'warn',
    });
    return { effects };
  }

  // Gałąź `:` jest osiągalna WYŁĄCZNIE, gdy caller w ogóle nie prefetchował
  // (`undefined` = „nie próbowano", trójstan w `stripe-event-prefetch.ts`). Oba
  // wejścia do `routeStripeEvent` — webhook i sprzątacz — prefetchują, a nieudany
  // prefetch daje teraz `null` i tutaj nie schodzi. Zostaje jako zgodność wstecz;
  // ewentualne trzecie wejście ma prefetchować, a nie liczyć na tę gałąź.
  const extractedPlanId =
    prefetchedPlanId !== undefined
      ? (prefetchedPlanId ?? undefined)
      : await extractPlanIdFromSubscription(subscription); // d2f1-allow: tylko ścieżka bez prefetchu

  // PlanId is recognized only when it exists in the kernel plan map.
  // UNKNOWN_PLAN_ID and any foreign string (e.g. legacy 'pro', typo in Stripe
  // metadata) are NOT recognized — previously a non-empty invalid planId slipped
  // past the alert below and silently mapped to FREE via
  // getPricingPlanValueFromPlanId, downgrading a paying customer.
  const isPlanIdRecognized =
    extractedPlanId !== undefined &&
    extractedPlanId !== UNKNOWN_PLAN_ID &&
    getValidPlanIds().includes(extractedPlanId);
  // Unrecognized planId is treated like a failed extraction downstream: keep
  // the current DB plan (same degradation path as prefetch failure) instead of
  // a silent FREE fallback. The critical alert below surfaces it to operators.
  const recognizedPlanId = isPlanIdRecognized ? extractedPlanId : undefined;

  // CRITICAL ALERT: Active subscription but missing/unknown/invalid planId
  if (isSubscriptionActive && !isPlanIdRecognized) {
    reportIssueBackend({
      namespace: 'STRIPE_SUBSCRIPTION_NO_PLAN',
      message:
        'CRITICAL: Active subscription without planId - alert sent to admins',
      payload: {
        subscriptionId: subscription.id,
        status: subscription.status,
      },
      mode: 'error',
    });
    effects.push(
      buildSubscriptionNoPlanAlertEffect(subscription, extractedPlanId)
    );
  }

  const hasPending = hasPendingUpdate({ subscription });
  const hasSchedule = hasActiveSchedule({ subscription });
  // Compare planId strings: convert DB pricing_plan (number) to planId (string)
  const currentPlanId = getPlanIdFromPricingPlanValue(account.pricing_plan);
  // Stripe's plan differs from DB = Stripe already applied the change, so we should sync.
  // recognizedPlanId (not raw extractedPlanId): an invalid planId must not be
  // treated as a divergence — it would force the sync path with a garbage plan.
  const isStripePlanDivergent =
    recognizedPlanId !== undefined && recognizedPlanId !== currentPlanId;

  // If pending/schedule exists but Stripe hasn't applied the new plan yet, keep current
  if (hasPending && !isStripePlanDivergent) {
    reportIssueBackend({
      namespace: 'STRIPE_SUBSCRIPTION_PENDING_UPDATE',
      message: 'Pending update - keeping current plan',
      payload: {
        accountId: account.account_id,
        pendingPlanId: extractedPlanId,
      },
      mode: 'info',
    });
    await updateAccountStatusWithoutPlanChange({
      account,
      subscription,
      isSubscriptionActive,
      eventCreatedAt,
      eventName:
        APP_EVENTS.INFO.ACCOUNT.STRIPE_SUBSCRIPTION_PENDING_UPDATE_DETECTED,
      eventPayload: {
        accountId: account.account_id,
        status: subscription.status,
        currentPlanId: account.pricing_plan,
        pendingPlanId: extractedPlanId,
      },
      ...(tx && { tx }),
    });
    return { effects };
  }
  if (hasSchedule && !isStripePlanDivergent) {
    reportIssueBackend({
      namespace: 'STRIPE_SUBSCRIPTION_SCHEDULE',
      message: 'Active schedule - keeping current plan',
      payload: {
        accountId: account.account_id,
        scheduledPlanId: extractedPlanId,
      },
      mode: 'info',
    });
    await updateAccountStatusWithoutPlanChange({
      account,
      subscription,
      isSubscriptionActive,
      eventCreatedAt,
      eventName: APP_EVENTS.INFO.ACCOUNT.STRIPE_SUBSCRIPTION_SCHEDULE_DETECTED,
      eventPayload: {
        accountId: account.account_id,
        status: subscription.status,
        currentPlanId: account.pricing_plan,
        scheduledPlanId: extractedPlanId,
      },
      ...(tx && { tx }),
    });
    return { effects };
  }

  // No pending/schedule OR Stripe plan diverges from DB — sync now.
  //
  // DECISION (nie usuwaj tego komentarza):
  // ENTITLEMENT-ACTIVE GATE (testy-api hardening płatności) — `pricing_plan` JEST jedynym
  // źródłem uprawnień: gallery-create.operation.ts + user-query.operations.ts czytają
  // wyłącznie `pricing_plan` (DECISION "display == enforcement by construction"), a
  // account-state-guard gejtuje dostęp na is_active (soft-delete/ban), NIE na Stripe-owym
  // account_status=NOT_ACTIVE. Dlatego promujemy do planu płatnego TYLKO gdy subskrypcja
  // realnie daje dostęp (isSubscriptionActive = active/trialing/past_due-grace). Dla statusów
  // nie-płacących (incomplete/incomplete_expired/unpaid/canceled/paused) piszemy FREE — inaczej
  // porzucony 3DS / wyczerpane dunning / incomplete_expired (dla którego Stripe NIE zawsze
  // wysyła subscription.deleted) zostawiałyby PRO-quota bez płatności. Cancel-at-period-end
  // nietknięte (status pozostaje `active` do końca okresu → PRO trzymane do realnego wygaśnięcia).
  // Ekstrakcja-fail przy AKTYWNEJ subskrypcji nadal keep-current (getPricingPlanOrFallback →
  // account.pricing_plan; brak silent-FREE dla płacących — patrz CRITICAL ALERT wyżej).
  const pricingPlanValue = isSubscriptionActive
    ? getPricingPlanOrFallback(recognizedPlanId, account.pricing_plan)
    : PricingPlanValue.FREE;
  const { cancelAt, cancelAtPeriodEnd, currentPeriodEnd } =
    extractSubscriptionDateFields({ subscription });

  const nextAccountStatus: AccountStatus = isSubscriptionActive
    ? AccountStatusValue.ACTIVE
    : AccountStatusValue.NOT_ACTIVE;
  const nextSubscriptionStatus = mapStripeStatusToSubscriptionStatus(
    subscription.status
  );
  // SCDUN-1: payment_status pochodzi z subscription_status (PAST_DUE/UNPAID ->
  // IN_PROGRESS), nie binarnie z isSubscriptionActive — patrz DECISION przy
  // mapStripeStatusToPaymentStatus. PAST_DUE nadal daje dostep (account_status=ACTIVE).
  const nextPaymentStatus = mapStripeStatusToPaymentStatus(
    nextSubscriptionStatus
  );

  const nextState: SubscriptionStateNext = {
    pricingPlan: pricingPlanValue,
    paymentStatus: nextPaymentStatus,
    accountStatus: nextAccountStatus,
    subscriptionStatus: nextSubscriptionStatus,
    subscriptionId: subscription.id,
    cancelAtPeriodEnd,
    cancelAt,
    currentPeriodEnd,
  };

  // DECISION (nie usuwaj tego komentarza):
  // D10 (run 25) — skip-if-no-change gate. handleSubscriptionUpdated is fan-in
  // for 9+ Stripe webhook events; most arrive with identical state (e.g. each
  // invoice.payment_succeeded indirectly re-fires subscription.updated). Without
  // this gate every such delivery wrote an unchanged row and emitted a
  // STRIPE_SUBSCRIPTION_UPDATED audit + downstream churn/trial checks. Skipping
  // here also guarantees handleChurnAlert won't run on a no-op event — the
  // transition gate inside it already filters false→true, but bailing earlier
  // prevents the extra user.findUnique probe.
  // trial dates are still safe to run when there IS a change (they're idempotent
  // via updateMany WHERE trial_started_at IS NULL) but we skip them in no-op
  // path too — same logic, no trial start is encoded in a non-state-changing event.
  if (!hasSubscriptionStateChanged(account, nextState)) {
    reportIssueBackend({
      namespace: 'STRIPE_SUBSCRIPTION_NO_OP',
      message:
        'Fan-in webhook arrived with no state change — skipping update + audit + churn + trial',
      payload: {
        accountId: account.account_id,
        subscriptionId: subscription.id,
        status: subscription.status,
      },
      mode: 'info',
    });
    // DECISION (nie usuwaj tego komentarza):
    // Advance the recency watermark even on a no-op so this event still fences an
    // OLDER out-of-order write. Without it SPAR-005's serialization only closes
    // HALF the concurrent cancel/rescind race: a newer rescind that no-ops here
    // wouldn't stamp, letting the older cancel then pass the CAS and win (see
    // bumpStripeEventWatermark). Forward-only + state-untouched → safe.
    await bumpStripeEventWatermark({
      accountId: account.account_id,
      stripeEventAt: eventCreatedAt,
      ...(tx && { tx }),
    });
    return { effects };
  }

  reportIssueBackend({
    namespace: 'STRIPE_SUBSCRIPTION_UPDATED',
    message: 'Updating subscription status (immediate change)',
    payload: {
      accountId: account.account_id,
      status: subscription.status,
      isActive: isSubscriptionActive,
      cancelAtPeriodEnd,
      planId: pricingPlanValue,
    },
    mode: 'info',
  });

  const planApplied = await updateAccountPlanStatus({
    accountId: account.account_id,
    stripeEventAt: eventCreatedAt,
    pricingPlan: pricingPlanValue,
    paymentStatus: nextPaymentStatus,
    accountStatus: nextAccountStatus,
    subscriptionStatus: nextSubscriptionStatus,
    subscriptionId: subscription.id,
    cancelAtPeriodEnd,
    cancelAt,
    currentPeriodEnd,
    // BUG-002: Stripe owns these. expiry = cancelAt (gdy anulowane) ?? koniec okresu; upcoming = -7d.
    accountExpirationDate: cancelAt ?? currentPeriodEnd,
    upcomingPaymentDate: currentPeriodEnd
      ? new Date(currentPeriodEnd.getTime() - 7 * TIME.MS_PER_DAY)
      : null,
    oldPricingPlan: account.pricing_plan,
    source: 'stripe',
    createdByUserId: account.created_by_user_id,
    ...(tx && { tx }),
  });

  // GATED on planApplied: when the recency guard skips a stale/out-of-order event
  // (a newer Stripe event already landed) the plan write is a no-op, so the churn
  // transition and trial-field derivation are computed from superseded data. Both
  // must be skipped — otherwise a stale event fires a phantom churn alert and/or
  // stamps trial fields for a state that no longer holds.
  if (planApplied) {
    // Churn alert: notify admin when cancel_at_period_end transitions to true.
    // Transition gate inside handleChurnAlert filters false→true only — see
    // its DECISION comment for the three-case analysis. Skipping above when state
    // is unchanged ensures we never even reach this on a true no-op. The alert
    // is queued as a post-commit effect so a rolled-back webhook tx fires zero
    // churn emails.
    const churnEffect = await handleChurnAlert({
      account,
      cancelAtPeriodEnd,
      pricingPlanValue,
      ...(tx && { tx }),
    });
    if (churnEffect) {
      effects.push(churnEffect);
    }

    // Downgrade alert (owner visibility): fires when this update actually LOWERS
    // the plan tier (Pro+→Pro proration, or drop to FREE on a non-active status).
    // Orthogonal to churn (cancel scheduling). Gated internally on isPlanDowngrade
    // + here on planApplied, so a stale/no-op write fires nothing.
    const downgradeEffect = await handleDowngradeAlert({
      account,
      newPricingPlan: pricingPlanValue,
      ...(tx && { tx }),
    });
    if (downgradeEffect) {
      effects.push(downgradeEffect);
    }

    // Business analytics (PostHog) funnel effects — post-commit, gated on
    // planApplied razem z churn (DECISION przy buildSubscriptionAnalyticsEffects).
    effects.push(
      ...buildSubscriptionAnalyticsEffects({
        account,
        nextSubscriptionStatus,
        cancelAtPeriodEnd,
        pricingPlanValue,
      })
    );

    // Set trial fields when subscription enters trialing status
    await handleTrialFieldsUpdate({
      subscription,
      accountId: account.account_id,
      createdByUserId: account.created_by_user_id,
      ...(tx && { tx }),
    });
  }

  return { effects };
};

/** Handle customer.subscription.created event */
export const handleSubscriptionCreated = async ({
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
  // DECISION (nie usuwaj tego komentarza):
  // handleSubscriptionCreated (and Paused/Resumed/PendingUpdateApplied/etc. in
  // subscription-state.handler.ts and subscription-schedule.handler.ts) delegate
  // to handleSubscriptionUpdated as an idempotent fan-in handler.
  // Primary DB write happens in handleCheckoutCompleted (checkout.session.completed)
  // which fires before or together with subscription.created in the normal Stripe flow.
  // If subscription.created arrives BEFORE checkout.completed (Stripe does not guarantee
  // ordering), findAccountByCustomerId returns null → silent early return (no account yet).
  // hasSubscriptionStateChanged gate in handleSubscriptionUpdated (D10 dedup) prevents
  // redundant DB writes when state already matches. This pattern is intentional:
  // each event type is a no-op when state is already consistent.
  const result = await handleSubscriptionUpdated({
    subscription,
    eventCreatedAt,
    ...(prefetchedPlanId !== undefined && { prefetchedPlanId }),
    ...(tx && { tx }),
  });

  // DECISION (nie usuwaj tego komentarza):
  // D2 (SPE) — trial_started_at is set HERE (and in handleSubscriptionUpdated's
  // post-write path) by handleTrialFieldsUpdate, never pre-locked at checkout
  // creation. handleCheckoutCompleted does NOT write trial dates, and the D10
  // hasSubscriptionStateChanged gate inside handleSubscriptionUpdated short-circuits
  // BEFORE its own handleTrialFieldsUpdate call when checkout.completed already wrote
  // the same plan/status — which would leave trial_started_at NULL forever for an
  // embedded SPE checkout. So on `customer.subscription.created` (the canonical
  // "subscription now exists / entered trialing" signal) we ALSO call
  // handleTrialFieldsUpdate explicitly. It is idempotent (updateMany WHERE
  // trial_started_at IS NULL + status==='trialing' guard inside), so the duplicate
  // call with the no-op path is a single zero-row write at worst.
  const customerId = extractCustomerId({ customer: subscription.customer });
  if (customerId) {
    const account = await findAccountByCustomerId(customerId, tx);
    if (account) {
      await handleTrialFieldsUpdate({
        subscription,
        accountId: account.account_id,
        createdByUserId: account.created_by_user_id,
        ...(tx && { tx }),
      });
    }
  }

  return result;
};
