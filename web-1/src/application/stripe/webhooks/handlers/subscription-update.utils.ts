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
 * DECISION (nie usuwaj tego komentarza):
 * D10 (run 25) — skip-if-no-change gate for fan-in dedup. `handleSubscriptionUpdated`
 * fires from 9+ Stripe events (customer.subscription.{created,updated,paused,resumed},
 * pending_update_{applied,expired}, subscription_schedule.{updated,released}, plus
 * the recursive `subscription.created` backup). Most produce identical state — the
 * earlier implementation re-ran UPDATE + audit log on every call, multiplying
 * unrelated side effects (handleChurnAlert hits the same false→true gate but
 * defensively; trial dates use idempotent updateMany). This comparator lets the
 * caller short-circuit when EVERY persisted field matches, preventing DB write
 * amplification + duplicate STRIPE_SUBSCRIPTION_UPDATED audit rows.
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
 * DECISION (nie usuwaj tego komentarza):
 * D10 (run 25) — skip-if-no-change applied here too. Schedule/pending events are
 * the WORST offenders for fan-in spam: subscription_schedule.updated fires every
 * time Stripe touches the schedule (often multiple times per real change). Without
 * this gate, the audit log fills with STRIPE_SUBSCRIPTION_SCHEDULE_DETECTED rows
 * that all describe the same state.
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
    // BUG-002: Stripe owns these. Bez przekazania params SSOT zapisuje null
    // (plan-status-update.operations.ts:91-92) — zerowałoby daty na renewal AKTYWNEJ
    // subskrypcji (gate hasSubscriptionStateChanged nie śledzi tych pól). Derywacja
    // identyczna z subscription-lifecycle.handler i stripe-sync.operations.
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
 * Send churn alert when cancel_at_period_end transitions from false to true.
 * Returns a post-commit effect — admin alert, not critical path.
 *
 * DECISION (nie usuwaj tego komentarza):
 * D10 (run 25) — transition gate hardened. The condition
 *   `if (!cancelAtPeriodEnd || (account.cancel_at_period_end ?? false)) return`
 * is intentionally NOT a no-op safety net — it's the SOLE protection against
 * email spam when Stripe fan-out delivers customer.subscription.updated multiple
 * times for the same cancellation (every invoice.payment_succeeded re-fires this
 * handler indirectly via the dunning chain).
 *
 * Three cases:
 *   - false → true : real cancel toggle — FIRE ALERT (the only desired path)
 *   - true  → true : already cancelled, repeat event — SKIP (no spam)
 *   - any   → false: cancel was rescinded — SKIP (no churn anymore; resume alert
 *                    would belong here but no such event yet wired)
 *
 * Concurrency note: the false→true transition gate is the SOLE spam guard for the
 * COMMON case — Stripe fan-out re-delivers customer.subscription.updated many times
 * for one cancellation, but each repeat reads a snapshot where cancel_at_period_end
 * is already true → SKIP. It does NOT serialize two GENUINELY CONCURRENT same-account
 * cancel webhooks: `previouslyCancelling` (line below) is read from the pre-write
 * snapshot loaded before the tx, and the Postgres row lock serializes the WRITE in
 * updateAccountPlanStatus, not that READ — so both could observe false and both fire.
 * That narrow concurrent-double-fire window is the webhook-serialization item tracked
 * for post-launch (SPAR-005/006 in API_TEST_REMEDIATION_PLAN.md); pre-launch (zero
 * subscriptions) it cannot manifest. Dup admin churn email, not money.
 *
 * H9 / C1: returns `StripeWebhookEffect | null` so the alert is scheduled by the
 * post-commit collector. Eliminates the prior raw `void sendChurnAlert_IO(...)`
 * which fired the email inside the still-open webhook tx — a rolled-back tx
 * would have surfaced a phantom "customer canceled" alert. The DB
 * `user.findUnique` read still happens inside the tx (consistent snapshot).
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
 * Send downgrade alert to admin when the account's plan is actually lowered.
 * Returns a post-commit effect (StripeWebhookEffect) — admin visibility, not
 * critical path. Null when the transition is not a downgrade.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Fires on ANY tier-lowering (owner 2026-07-16: "tylko downgrade, może lecieć
 * zawsze póki co, bez innych warunków"). `isPlanDowngrade` (kernel pricing-policy,
 * PLAN_TIER_ORDER) is the SOLE gate: unchanged plan (X→X), upgrades and unknown
 * plans (index -1) all return false → no alert. Orthogonal to handleChurnAlert
 * (cancel_at_period_end scheduling; plan STILL active) — this is the plan value
 * dropping. Callers gate on `planApplied`, so a recency-skipped / no-op webhook
 * write never fires a phantom downgrade alert (parity with churn). The alert is a
 * post-commit effect so a rolled-back webhook tx sends zero downgrade emails.
 *
 * `preloadedEmail` lets a caller that already loaded the owner's email (the
 * subscription-deleted handler loads it for the user-facing downgrade-notification)
 * skip the redundant in-tx `user.findUnique`; callers without it (the fan-in
 * updated handler) pass nothing and this resolves the email itself.
 *
 * CONCURRENCY (closing-review, świadomie zaakceptowane): path B (subscription-
 * deleted) NIE bierze per-customer advisory xact-locka, który trzyma path A
 * (subscription-updated) — więc współbieżny `updated`→FREE ‖ `deleted`→FREE tej
 * samej subskrypcji może odczytać ten sam stale paid-snapshot i strzelić DWA
 * maile admina. Sekwencyjnie samo-deduplikuje (drugi czyta już FREE). To
 * DOKŁADNIE ta sama zaakceptowana postawa co handleChurnAlert (SPAR-005/006):
 * mail do JEDNEGO admina, nie pieniądze; pre-launch (zero subów) nie manifestuje.
 * NIE dodawać locka tylko tu — churn ma tę samą charakterystykę, byłoby niespójne.
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
 * Business analytics (PostHog) funnel effects for a persisted subscription write.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Business analytics (PostHog) — user-scoped funnel eventy OBOK istniejącej logiki
 * (churn alert / EventLog zostają nietknięte, NIE dublujemy EventLog). distinctId =
 * account.created_by_user_id (owner subskrypcji; ta sama wartość user.id którą już
 * używa handleChurnAlert → sendChurnAlert_IO). Emitowane jako POST-COMMIT effects[]
 * (NIE synchronicznie w tx) — zgodnie z Post-Commit Effects Pattern
 * (stripe-effects.types.ts): rollback transakcji webhooka NIE może odpalić phantom
 * eventu „converted"/„cancel" dla stanu, który nie utrwalił się w DB. Caller gejtuje
 * na `planApplied` razem z churn, więc stale/out-of-order eventy też nie strzelają.
 * captureBackendEvent jest never-throw, więc effect spełnia kontrakt „MUST NOT throw".
 *
 * trial_converted: przejście trialing → active. Porównanie stanu PRZED zapisem
 * (account.subscription_status = snapshot z findAccountByCustomerId, spójny w tx)
 * z nowym (nextSubscriptionStatus) — handler jest fan-inem bez dostępu do
 * Stripe previous_attributes, więc DB-snapshot to autorytatywne źródło transitionu.
 *
 * subscription_cancel_scheduled: cancel_at_period_end false → true (ta sama
 * tranzycja co handleChurnAlert.isRealCancelTransition; cancel_at_period_end:null
 * liczony jako false — DB default legacy). days_since_account_created pozwala
 * odróżnić anulowanie przed/po aktywacji (created_at ze snapshotu konta stylistki).
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
 * DECISION (nie usuwaj tego komentarza):
 * D1 (run 25) — when called inside the webhook $transaction (`tx` passed),
 * we DO let errors propagate so the outer transaction rolls back and the
 * janitor retries. When called outside (legacy callers), errors are swallowed
 * (non-critical) preserving prior behavior.
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
