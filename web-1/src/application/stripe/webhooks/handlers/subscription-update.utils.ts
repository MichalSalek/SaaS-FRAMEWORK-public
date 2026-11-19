import type Stripe from 'stripe';
import type { Prisma } from '../../../../prisma/js-client';
import {
  getPlanDisplayName,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { isPlanDowngrade } from '@kernel/domain/pricing/pricing-policy';
import type {
  AccountStatus,
  PaymentStatus,
  SubscriptionStatus,
} from '@kernel/models/db_models.generated.dto';
import {
  AccountStatusValue,
  EventLogTypeValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { captureBackendEvent } from '@app/debugger/posthog-server';
import {
  mapStripeStatusToSubscriptionStatus,
  mapStripeStatusToPaymentStatus,
} from '@kernel/models/db_models.manual.dto';
import { TIME } from '@kernel/application/constants.config';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { extractSubscriptionDateFields } from '@app/stripe/subscription-schedule.utils';
import { updateAccountPlanStatus } from '@app/stripe/plan-status-update.operations';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  sendChurnAlert_IO,
  sendDowngradeAlert_IO,
} from '@domain/email/operations/admin-alerts.operation';
import type { StripeWebhookEffect } from '@app/stripe/webhooks/stripe-effects.types';

/**
 * Account state snapshot loaded by findAccountByCustomerId. Used by skip-if-no-change
 * comparator to detect "fan-in no-op" webhook calls (same event delivered via 7+
 * customer.subscription.* / invoice.* / subscription_schedule.* channels).
 */
export type SubscriptionStateSnapshot = {
  pricing_plan: PricingPlan;
  payment_status: PaymentStatus;
  account_status: AccountStatus;
  subscription_status: SubscriptionStatus | null;
  subscription_id: string | null;
  cancel_at_period_end: boolean | null;
  cancel_at: Date | null;
  current_period_end: Date | null;
};

/**
 * Next state computed from a Stripe webhook event. Comparing against
 * SubscriptionStateSnapshot tells us whether a DB write + audit log are needed.
 */
export type SubscriptionStateNext = {
  pricingPlan: PricingPlan;
  paymentStatus: PaymentStatus;
  accountStatus: AccountStatus;
  subscriptionStatus: SubscriptionStatus;
  subscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
  currentPeriodEnd: Date | null;
};

const datesEqual = (a: Date | null, b: Date | null): boolean => {
  if (a === null && b === null) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  return a.getTime() === b.getTime();
};

/**
 * Compare current account state vs computed next state.
 *
 * DECISION: skip-if-no-change gate for fan-in dedup. `handleSubscriptionUpdated` fires from 9+
 * Stripe events (customer.subscription.{created,updated,paused,resumed}, pending_update_*,
 * subscription_schedule.*, plus the recursive `subscription.created` backup) and most produce
 * identical state. This comparator lets the caller short-circuit when EVERY persisted field
 * matches, preventing DB write amplification and duplicate STRIPE_SUBSCRIPTION_UPDATED audit rows.
 *
 * Compare by VALUE (not reference) on dates: Stripe sends timestamps as seconds,
 * we store as ms — JS Date.getTime() normalizes both sides.
 *
 * cancel_at_period_end: null is treated as false (DB default for legacy accounts).
 */
export const hasSubscriptionStateChanged = (
  current: SubscriptionStateSnapshot,
  next: SubscriptionStateNext
): boolean => {
  if (current.pricing_plan !== next.pricingPlan) {
    return true;
  }
  if (current.payment_status !== next.paymentStatus) {
    return true;
  }
  if (current.account_status !== next.accountStatus) {
    return true;
  }
  if (current.subscription_status !== next.subscriptionStatus) {
    return true;
  }
  if (current.subscription_id !== next.subscriptionId) {
    return true;
  }
  if ((current.cancel_at_period_end ?? false) !== next.cancelAtPeriodEnd) {
    return true;
  }
  if (!datesEqual(current.cancel_at, next.cancelAt)) {
    return true;
  }
  if (!datesEqual(current.current_period_end, next.currentPeriodEnd)) {
    return true;
  }
  return false;
};

/**
 * Helper: Update account status/dates without changing planId.
 * Used when pending update or schedule is detected.
 *
 * DECISION: the same skip-if-no-change gate applies here. Schedule/pending events are the worst
 * fan-in offenders (subscription_schedule.updated fires several times per real change); without
 * the gate the audit log fills with STRIPE_SUBSCRIPTION_SCHEDULE_DETECTED rows describing the
 * same state.
 */
export const updateAccountStatusWithoutPlanChange = async ({
  account,
  subscription,
  isSubscriptionActive,
  eventCreatedAt,
  eventName,
  eventPayload,
  tx,
}: {
  account: SubscriptionStateSnapshot & {
    account_id: string;
    created_by_user_id: string;
  };
  subscription: Stripe.Subscription;
  isSubscriptionActive: boolean;
  eventCreatedAt: Date;
  eventName:
    | typeof APP_EVENTS.INFO.ACCOUNT.STRIPE_SUBSCRIPTION_PENDING_UPDATE_DETECTED
    | typeof APP_EVENTS.INFO.ACCOUNT.STRIPE_SUBSCRIPTION_SCHEDULE_DETECTED;
  eventPayload: Record<string, unknown>;
  tx?: Prisma.TransactionClient;
}): Promise<void> => {
  const { cancelAt, cancelAtPeriodEnd, currentPeriodEnd } =
    extractSubscriptionDateFields({ subscription });

  const nextAccountStatus: AccountStatus = isSubscriptionActive
    ? AccountStatusValue.ACTIVE
    : AccountStatusValue.NOT_ACTIVE;
  const nextSubscriptionStatus = mapStripeStatusToSubscriptionStatus(
    subscription.status
  );
  // SCDUN-1: payment_status pochodzi z subscription_status (PAST_DUE/UNPAID ->
  // IN_PROGRESS), nie binarnie z isSubscriptionActive — spojnie z
  // subscription-lifecycle.handler. Galaz pending/schedule mialaby ten sam leak:
  // past_due + pending update = PAID bez placenia. PAST_DUE nadal daje dostep.
  const nextPaymentStatus: PaymentStatus = mapStripeStatusToPaymentStatus(
    nextSubscriptionStatus
  );

  const next: SubscriptionStateNext = {
    pricingPlan: account.pricing_plan, // pending/schedule: keep current plan
    paymentStatus: nextPaymentStatus,
    accountStatus: nextAccountStatus,
    subscriptionStatus: nextSubscriptionStatus,
    subscriptionId: subscription.id,
    cancelAtPeriodEnd,
    cancelAt,
    currentPeriodEnd,
  };

  if (!hasSubscriptionStateChanged(account, next)) {
    reportIssueBackend({
      namespace: 'STRIPE_SUBSCRIPTION_NO_OP',
      message:
        'Pending/schedule webhook arrived with no state change — skipping update + audit',
      payload: {
        accountId: account.account_id,
        subscriptionId: subscription.id,
        eventName,
      },
      mode: 'info',
    });
    return;
  }

  // Use SSOT function (keeps current pricing_plan)
  const planApplied = await updateAccountPlanStatus({
    accountId: account.account_id,
    // #4 (5th-class inventory): pass event-time so this pending/schedule status write goes through
    // the recency-CAS (last_stripe_event_at). Bez tego stale pending/schedule event landujacy PO
    // subscription.deleted moglby re-linkowac skasowany subscription_id + flipnac status z CANCELED
    // (helper nie czytal ani nie advansowal watermarka). Parytet z plan-change path (handler:299).
    stripeEventAt: eventCreatedAt,
    pricingPlan: account.pricing_plan,
    paymentStatus: nextPaymentStatus,
    accountStatus: nextAccountStatus,
    subscriptionStatus: nextSubscriptionStatus,
    subscriptionId: subscription.id,
    cancelAtPeriodEnd,
    cancelAt,
    currentPeriodEnd,

    accountExpirationDate: cancelAt ?? currentPeriodEnd,
    upcomingPaymentDate: currentPeriodEnd
      ? new Date(currentPeriodEnd.getTime() - 7 * TIME.MS_PER_DAY)
      : null,
    // oldPricingPlan: omitted - skip audit log (no plan change)
    source: 'stripe',
    createdByUserId: account.created_by_user_id,
    ...(tx && { tx }),
  });

  // Gate the audit on the recency-CAS outcome (parity with the lifecycle handler,
  // subscription-lifecycle.handler.ts:378): a STALE pending/schedule event can pass
  // the pre-write hasSubscriptionStateChanged gate (which reads the pre-write
  // snapshot) yet be recency-skipped by updateAccountPlanStatus (count 0). Writing
  // the audit unconditionally would record a state change that never persisted.
  if (planApplied) {
    await writeRawEventLog_IO({
      eventName,
      eventLogType: EventLogTypeValue.ACCOUNT,
      eventPayloadToStringify: eventPayload,
      meta: {
        created_by_user_id: account.created_by_user_id,
      },
      ...(tx && { tx }),
    });
  }
};

/**
 * Admin churn alert when cancel_at_period_end goes from false to true. A repeat
 * delivery or a rescind returns null. The effect is post-commit, so a rolled-back
 * transaction sends nothing.
 * DECISION: that transition is the only spam guard. The caller locks the customer
 * before reading the snapshot; outside a transaction a second admin email is possible.
 * Test: tests/concurrency/advisory-xact-lock.concurrency.ts (the lock serializes two
 * transactions on one key; not a pair of cancel webhooks through this handler).
 */
export const handleChurnAlert = async ({
  account,
  cancelAtPeriodEnd,
  pricingPlanValue,
  tx,
}: {
  account: {
    account_id: string;
    created_by_user_id: string;
    cancel_at_period_end: boolean | null;
  };
  cancelAtPeriodEnd: boolean;
  pricingPlanValue: PricingPlan;
  tx?: Prisma.TransactionClient;
}): Promise<StripeWebhookEffect | null> => {
  const previouslyCancelling = account.cancel_at_period_end ?? false;
  const isRealCancelTransition = cancelAtPeriodEnd && !previouslyCancelling;

  if (!isRealCancelTransition) {
    return null;
  }

  const churnUser = await (tx ?? DB_CLIENT.use).user.findUnique({
    where: { id: account.created_by_user_id },
    select: { email: true },
  });
  if (!churnUser?.email) {
    return null;
  }

  const userEmail = churnUser.email;
  return () =>
    sendChurnAlert_IO({
      accountId: account.account_id,
      email: userEmail,
      plan: getPlanDisplayName(pricingPlanValue),
      userId: account.created_by_user_id,
    });
};

/**
 * Admin alert when the plan tier actually drops. Null otherwise.
 * DECISION: any tier-lowering fires (owner: "downgrade only, may fire always for
 * now, no other conditions"). isPlanDowngrade is the only gate. Callers also
 * require planApplied, and the send is post-commit.
 * Concurrent updated and deleted webhooks can each mail once: deleted does not
 * take the customer lock. One extra admin email; the lock belongs on that path.
 */
export const handleDowngradeAlert = async ({
  account,
  newPricingPlan,
  preloadedEmail,
  tx,
}: {
  account: {
    account_id: string;
    created_by_user_id: string;
    pricing_plan: PricingPlan;
  };
  newPricingPlan: PricingPlan;
  preloadedEmail?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<StripeWebhookEffect | null> => {
  if (!isPlanDowngrade(account.pricing_plan, newPricingPlan)) {
    return null;
  }

  const ownerEmail =
    preloadedEmail !== undefined
      ? preloadedEmail
      : (
          await (tx ?? DB_CLIENT.use).user.findUnique({
            where: { id: account.created_by_user_id },
            select: { email: true },
          })
        )?.email;

  if (!ownerEmail) {
    return null;
  }

  const oldPlanName = getPlanDisplayName(account.pricing_plan);
  const newPlanName = getPlanDisplayName(newPricingPlan);
  return () =>
    sendDowngradeAlert_IO({
      accountId: account.account_id,
      email: ownerEmail,
      oldPlan: oldPlanName,
      newPlan: newPlanName,
      userId: account.created_by_user_id,
    });
};

/**
 * Post-commit PostHog funnel events for a persisted subscription write.
 * distinctId is account.created_by_user_id. A rolled-back transaction emits
 * nothing, and the caller also requires planApplied. captureBackendEvent does not throw.
 * trial_converted compares the DB snapshot from before the write with the new status.
 * subscription_cancel_scheduled is cancel_at_period_end from false to true.
 */
export const buildSubscriptionAnalyticsEffects = ({
  account,
  nextSubscriptionStatus,
  cancelAtPeriodEnd,
  pricingPlanValue,
}: {
  account: {
    created_by_user_id: string;
    created_at: Date;
    subscription_status: SubscriptionStatus | null;
    cancel_at_period_end: boolean | null;
  };
  nextSubscriptionStatus: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  pricingPlanValue: PricingPlan;
}): StripeWebhookEffect[] => {
  const effects: StripeWebhookEffect[] = [];
  const userId = account.created_by_user_id;

  if (
    account.subscription_status === SubscriptionStatusValue.TRIALING &&
    nextSubscriptionStatus === SubscriptionStatusValue.ACTIVE
  ) {
    effects.push(async () => {
      captureBackendEvent(userId, 'trial_converted', {
        plan_id: pricingPlanValue,
      });
    });
  }

  const previouslyCancelling = account.cancel_at_period_end ?? false;
  if (cancelAtPeriodEnd && !previouslyCancelling) {
    const daysSinceAccountCreated = Math.floor(
      (Date.now() - account.created_at.getTime()) / TIME.MS_PER_DAY
    );
    effects.push(async () => {
      captureBackendEvent(userId, 'subscription_cancel_scheduled', {
        plan_id: pricingPlanValue,
        days_since_account_created: daysSinceAccountCreated,
      });
    });
  }

  return effects;
};

/**
 * Record trial dates on account when subscription enters trialing status.
 *
 * DECISION: inside the webhook $transaction (`tx` passed) errors PROPAGATE so the outer
 * transaction rolls back and the janitor retries; outside it (legacy callers) errors are
 * swallowed as non-critical.
 */
export const handleTrialFieldsUpdate = async ({
  subscription,
  accountId,
  createdByUserId,
  tx,
}: {
  subscription: Stripe.Subscription;
  accountId: string;
  createdByUserId: string;
  tx?: Prisma.TransactionClient;
}): Promise<void> => {
  if (
    subscription.status !== 'trialing' ||
    !subscription.trial_start ||
    !subscription.trial_end
  ) {
    return;
  }
  const client = tx ?? DB_CLIENT.use;
  try {
    // `WHERE trial_started_at: null` makes this the exactly-once trial-start
    // chokepoint: count === 1 only on the FIRST transition into trialing for
    // this account. A row-level lock serializes the concurrent created/updated
    // fan-in, so a retry or duplicate delivery sees a non-null field → count 0.
    const { count } = await client.stylistAccount.updateMany({
      where: { account_id: accountId, trial_started_at: null },
      data: {
        trial_started_at: new Date(subscription.trial_start * 1000),
        trial_ends_at: new Date(subscription.trial_end * 1000),
      },
    });
    // Info-log gated on count: `count===0` means the exactly-once chokepoint
    // skipped the write (trial already recorded) — logging "recorded" there
    // fabricates a misleading audit trail on every duplicate fan-in delivery.
    if (count > 0) {
      reportIssueBackend({
        namespace: 'STRIPE_TRIAL_FIELDS_SET',
        message: 'Trial dates recorded on account',
        payload: { accountId },
        mode: 'info',
      });
    }
    // Audit-log the trial start EXACTLY ONCE, gated on the first-set count.
    // Completes the trial-INFO family (TRIAL_NOT_ELIGIBLE / TRIAL_ALREADY_USED /
    // STRIPE_TRIAL_WILL_END already emit): the SPE cutover moved trial-start to
    // this webhook and set trial_started_at WITHOUT logging the event. Written
    // in the SAME `tx` as the set → they commit/roll-back together (no orphan
    // TRIAL_STARTED without trial_started_at; a janitor retry re-sets + re-emits).
    if (count > 0) {
      await writeRawEventLog_IO({
        eventName: APP_EVENTS.INFO.ACCOUNT.TRIAL_STARTED,
        eventLogType: EventLogTypeValue.ACCOUNT,
        eventPayloadToStringify: {
          accountId,
          subscriptionId: subscription.id,
          trialStart: new Date(subscription.trial_start * 1000),
          trialEnd: new Date(subscription.trial_end * 1000),
        },
        meta: { created_by_user_id: createdByUserId },
        ...(tx && { tx }),
      });
    }
  } catch (error) {
    reportIssueBackend({
      namespace: 'STRIPE_TRIAL_FIELDS_SET_ERROR',
      message: 'Failed to set trial dates (non-critical)',
      payload: {
        accountId,
        error: error instanceof Error ? error.message : error,
      },
      mode: 'error',
    });
    if (tx) {
      // Inside webhook transaction — propagate so outer tx rolls back and
      // janitor retries on next sweep.
      throw error;
    }
  }
};
