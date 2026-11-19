import {
  guardUpdatedSubscription,
  guardSubscriptionCreated,
} from './checkout-attempt-event.guard';
import { reconcileSalonDerivedPairings_IO } from '@domain/pairing/salon-derived-cleanup.operations';
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
 * DECISION: `prefetchedPlanId` is TRI-STATE, resolved BEFORE the webhook `$transaction` (rationale:
 * web-1/src/application/stripe/webhooks/stripe-event-prefetch.ts). `undefined` = no prefetch, resolving
 * on the fly is allowed; `null` = prefetch ran and found no plan, so do NOT retry and take the same
 * degradation path as an unrecognised planId (keep the DB plan + critical alert below). Same fan-in
 * for the schedule paths (subscription_schedule.*).
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

  // DECISION: per-account serialization BEFORE reading the snapshot. Two concurrent
  // `subscription.updated` of one account (e.g. schedule-cancel T1 and rescind T2) read the same
  // pre-write snapshot S0. The no-op gate below compares that snapshot: the older cancel wrote
  // cancel=true (recency-CAS watermark T1), while the newer rescind saw S0.cancel=false ==
  // rescind.cancel=false -> "no change" -> SKIP, so the recency-CAS never advanced and the newer
  // rescind was lost behind the older cancel (involuntary churn). The advisory xact-lock
  // (PgBouncer-safe, key=customerId) serializes the handler per account: the second waits and,
  // after the first commits, `findAccountByCustomerId` reads the FRESH snapshot (cancel=true), the
  // gate sees the change and T2's recency-CAS wins. This xact-lock is the ONLY per-account
  // serialization (a session-level event-keyed lock could not cover two DIFFERENT events of one
  // account). `tx` is present in the hot path and janitor; outside a tx (edge) there is none.
  if (tx) {
    await acquireAdvisoryXactLock(tx, customerId);
  }

  const guarded = await guardUpdatedSubscription({
    tx,
    customerId,
    prefetchedPlanId,
    subscription,
    effects,
  });
  if (!guarded) {
    return { effects };
  }
  const { account, extractedPlanId } = guarded;

  // DECISION: the plan write calls updateAccountPlanStatus with stripeEventAt.
  // That updateMany matches when last_stripe_event_at is null or <= this event.
  // Test: web-1/src/test-utils/integration/stripe-recency-gate.test.ts (mock
  // count 0 skips the audit; count 1 applies it). It does not deliver two
  // webhook events.
  const isSubscriptionActive = isStripeSubscriptionActive({
    status: subscription.status,
  });

  // DECISION: NON-CANONICAL NON-ACTIVE GUARD, parity with the subscription-deleted handler
  // "non-current subscription, ignoring". An account can have an active paying subscription A
  // (subscription_id=A) AND an orphaned secondary subscription B (checkout double-submit /
  // abandoned re-subscribe). B going `incomplete -> incomplete_expired` is emitted as
  // `customer.subscription.updated` (NOT `.deleted`), so it reaches THIS handler. Without the
  // guard the ENTITLEMENT-ACTIVE GATE below (non-active => FREE) would downgrade the PAYING
  // account on the strength of dead sub B (and re-point subscription_id at B). The guard applies
  // only to non-active: active events keep switching to the really active subscription. A
  // canonical event (subscription_id NULL or == event) passes. The recency guard is not enough: B
  // has a newer event.created than A's last event, so it would pass `lte`.
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
  // DECISION: ENTITLEMENT-ACTIVE GATE. `pricing_plan` is the only source of entitlements
  // (gallery-create.operation.ts + user-query.operations.ts read only it), and account-state-guard
  // gates access on is_active (soft-delete/ban), not on Stripe's account_status=NOT_ACTIVE. So we
  // promote to a paid plan ONLY when the subscription really gives access (isSubscriptionActive =
  // active/trialing/past_due grace) and write FREE for non-paying statuses (incomplete,
  // incomplete_expired, unpaid, canceled, paused), or an abandoned 3DS / exhausted dunning /
  // incomplete_expired (for which Stripe does not always send subscription.deleted) would leave
  // PRO quota unpaid. Cancel-at-period-end is untouched (status stays `active` until the period
  // ends). An extraction failure on an ACTIVE subscription still keeps the current plan
  // (getPricingPlanOrFallback -> account.pricing_plan; never a silent FREE for payers, see the
  // CRITICAL ALERT above).
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
  // payment_status derives from subscription_status (PAST_DUE/UNPAID -> IN_PROGRESS),
  // not binarily from isSubscriptionActive; see the DECISION at
  // mapStripeStatusToPaymentStatus. PAST_DUE still grants access (account_status=ACTIVE).
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

  // DECISION: skip-if-no-change gate. handleSubscriptionUpdated is the fan-in for 9+ Stripe
  // webhook events and most arrive with identical state (e.g. each invoice.payment_succeeded
  // indirectly re-fires subscription.updated). Without the gate every delivery wrote an unchanged
  // row and emitted a STRIPE_SUBSCRIPTION_UPDATED audit + downstream churn/trial checks. Skipping
  // also guarantees handleChurnAlert never runs on a no-op and avoids an extra user.findUnique
  // probe. Trial dates are skipped on the no-op path too: a non-state-changing event encodes no
  // trial start.
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
    // DECISION: advance the recency watermark even on a no-op so this event still fences an OLDER
    // out-of-order write. Without it the per-account serialization closes only HALF the concurrent
    // cancel/rescind race: a newer rescind that no-ops here would not stamp, letting the older
    // cancel pass the CAS and win (see bumpStripeEventWatermark). Forward-only and state-untouched.
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
    if (
      (account.pricing_plan === 'STUDIO' || account.pricing_plan === 'SCALE') &&
      pricingPlanValue !== 'STUDIO' &&
      pricingPlanValue !== 'SCALE'
    ) {
      effects.push(() =>
        reconcileSalonDerivedPairings_IO({ salonAccountId: account.account_id })
      );
    }
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
    // planApplied together with churn (see the DECISION at buildSubscriptionAnalyticsEffects).
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
  // DECISION: handleSubscriptionCreated (and Paused/Resumed/PendingUpdateApplied in
  // subscription-state.handler.ts and subscription-schedule.handler.ts) delegate to
  // handleSubscriptionUpdated as an idempotent fan-in. The primary DB write happens in
  // handleCheckoutCompleted, which fires before or together with subscription.created; if
  // subscription.created arrives first (Stripe does not guarantee ordering),
  // findAccountByCustomerId returns null and we return silently. The hasSubscriptionStateChanged
  // gate prevents redundant writes, so each event type is a no-op when state is consistent.
  const gate = await guardSubscriptionCreated({
    tx,
    subscription,
    prefetchedPlanId,
  });
  if (gate.rejected) {
    return { effects: gate.rejected };
  }
  const effectivePlanId = gate.planId;
  const result = await handleSubscriptionUpdated({
    subscription,
    eventCreatedAt,
    ...(effectivePlanId !== undefined && { prefetchedPlanId: effectivePlanId }),
    ...(tx && { tx }),
  });

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
