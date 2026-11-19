import { acceptsSubscriptionEvent } from './checkout-attempt-event.guard';
import { acquireAdvisoryXactLock } from '@app/db/lock-rows';
import { reconcileSalonDerivedPairings_IO } from '@domain/pairing/salon-derived-cleanup.operations';
import type Stripe from 'stripe';
import type { Prisma } from '../../../../prisma/js-client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  AccountStatusValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { updateAccountPlanStatus } from '@app/stripe/plan-status-update.operations';
import {
  enqueueEmailOutboxTx,
  kickEmailOutbox,
} from '@app/email-handler/outbox/email-outbox';
import { DB_CLIENT } from '@app/db/db.client';
import { findAccountByCustomerId } from '@app/stripe/webhooks/stripe-webhooks.db';
import { extractCustomerId } from '@app/stripe/webhooks/stripe-webhooks.utils';
import {
  emptyEffectsResult,
  type StripeHandlerResult,
  type StripeWebhookEffect,
} from '@app/stripe/webhooks/stripe-effects.types';
import { handleDowngradeAlert } from './subscription-update.utils';

/** Handle customer.subscription.deleted event
 *
 * DECISION: split out of subscription-lifecycle.handler.ts so the remaining file stays under the
 * 350-line eslint limit after adding `prefetchedPlanId` plumbing to Updated/Created. Deleted does
 * NOT need `extractPlanIdFromSubscription` (it always resets to FREE), so it has no pre-fetch
 * dependency and stays self-contained.
 */
export const handleSubscriptionDeleted = async ({
  subscription,
  eventCreatedAt,
  tx,
}: {
  subscription: Stripe.Subscription;
  eventCreatedAt: Date;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  const effects: StripeWebhookEffect[] = [];

  const customerId = extractCustomerId({ customer: subscription.customer });
  if (!customerId) {
    reportIssueBackend({
      namespace: 'STRIPE_SUBSCRIPTION_DELETED',
      message: 'No customer ID in subscription',
      payload: { subscriptionId: subscription.id },
      mode: 'error',
    });
    return emptyEffectsResult();
  }

  if (subscription.metadata?.attemptId) {
    if (!tx) {
      throw new Error('Tagged Stripe event requires a database transaction');
    }
    await acquireAdvisoryXactLock(tx, customerId);
  }
  let account = await findAccountByCustomerId(customerId, tx);
  if (!account) {
    return emptyEffectsResult();
  }
  if (subscription.metadata?.attemptId) {
    if (
      !(await acceptsSubscriptionEvent({
        tx,
        accountId: account.account_id,
        userId: account.created_by_user_id,
        subscription,
        effects,
      }))
    ) {
      return { effects };
    }
    const refreshed = await findAccountByCustomerId(customerId, tx);
    if (!refreshed || refreshed.account_id !== account.account_id) {
      throw new Error('Subscription account changed while locking');
    }
    account = refreshed;
  }
  // Verify this is the current subscription
  if (account.subscription_id && account.subscription_id !== subscription.id) {
    reportIssueBackend({
      namespace: 'STRIPE_SUBSCRIPTION_DELETED',
      message:
        'Subscription delete event for non-current subscription, ignoring',
      payload: {
        accountId: account.account_id,
        currentSubscriptionId: account.subscription_id,
        deletedSubscriptionId: subscription.id,
      },
      mode: 'warn',
    });
    return emptyEffectsResult();
  }

  reportIssueBackend({
    namespace: 'STRIPE_SUBSCRIPTION_DELETED',
    message: 'Resetting account to free plan',
    payload: { accountId: account.account_id, subscriptionId: subscription.id },
    mode: 'info',
  });
  const planApplied = await updateAccountPlanStatus({
    accountId: account.account_id,
    stripeEventAt: eventCreatedAt,
    pricingPlan: PricingPlanValue.FREE,
    paymentStatus: PaymentStatusValue.UNPAID,
    accountStatus: AccountStatusValue.ACTIVE,
    subscriptionStatus: SubscriptionStatusValue.CANCELED,
    subscriptionId: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    currentPeriodEnd: null,
    // BUG-002: reset do FREE => brak daty wygaśnięcia/płatności (Stripe owner).
    accountExpirationDate: null,
    upcomingPaymentDate: null,
    oldPricingPlan: account.pricing_plan,
    source: 'stripe',
    createdByUserId: account.created_by_user_id,
    ...(tx && { tx }),
  });

  if (
    planApplied &&
    (account.pricing_plan === 'STUDIO' || account.pricing_plan === 'SCALE')
  ) {
    effects.push(() =>
      reconcileSalonDerivedPairings_IO({ salonAccountId: account.account_id })
    );
  }

  const db = tx ?? DB_CLIENT.use;
  const user = await db.user.findUnique({
    where: { id: account.created_by_user_id },
    select: { email: true },
  });
  // GATED on planApplied: when the recency guard skips a stale subscription.deleted
  // event (a newer Stripe event already landed), the FREE reset is a no-op, so we must
  // NOT send a "downgrade notification" for a downgrade that never persisted.
  if (planApplied && user?.email) {
    // DECISION: see web-1/src/application/email-handler/outbox/email-outbox.store.ts (durable
    // intent written in this transaction, sent after commit). One notification per subscription.
    const queuedId = await enqueueEmailOutboxTx(db, {
      userId: account.created_by_user_id,
      accountId: account.account_id,
      ruleId: 'downgrade-notification',
      templateId: 'downgrade-notification',
      occurrence: `subscription-deleted:${subscription.id}`,
      subjectKey: 'email.downgrade.subject',
      infoEvent: APP_EVENTS.INFO.EMAIL.EMAIL_DOWNGRADE_NOTIFICATION_SENT,
      vars: {},
    });
    if (queuedId) {
      effects.push(kickEmailOutbox([queuedId]));
    }
  }

  // Owner downgrade alert: fires when a paying plan resets to FREE.
  // Reuses the already-loaded owner email (no extra in-tx query); helper gates on
  // isPlanDowngrade(oldPlan → FREE), so a FREE→FREE delete fires nothing. Gated on
  // planApplied — a recency-skipped stale delete persists no downgrade, so no alert.
  if (planApplied) {
    const downgradeAlertEffect = await handleDowngradeAlert({
      account,
      newPricingPlan: PricingPlanValue.FREE,
      preloadedEmail: user?.email ?? null,
      ...(tx && { tx }),
    });
    if (downgradeAlertEffect) {
      effects.push(downgradeAlertEffect);
    }
  }

  return { effects };
};
