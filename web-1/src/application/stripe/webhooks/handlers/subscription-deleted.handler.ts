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
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
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
 * DECISION (nie usuwaj tego komentarza):
 * Split out from subscription-lifecycle.handler.ts (D2-F1, PRMA) so the
 * remaining file stays under the 350-line eslint limit after adding
 * `prefetchedPlanId` plumbing to Updated/Created. Deleted does NOT need
 * `extractPlanIdFromSubscription` (it always resets to FREE) so it has no
 * pre-fetch dependency and remains self-contained.
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

  const account = await findAccountByCustomerId(customerId, tx);
  if (!account) {
    return emptyEffectsResult();
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

  const user = await (tx ?? DB_CLIENT.use).user.findUnique({
    where: { id: account.created_by_user_id },
    select: { email: true, name: true },
  });
  // GATED on planApplied: when the recency guard skips a stale subscription.deleted
  // event (a newer Stripe event already landed), the FREE reset is a no-op, so we must
  // NOT send a "downgrade notification" for a downgrade that never persisted.
  if (planApplied && user?.email) {
    // DECISION (nie usuwaj tego komentarza):
    // Email send is queued as a post-commit effect — Stripe webhook needs <5s
    // response; durability handled by FailedEmail table + EMAIL_DEAD_LETTERED
    // audit. C1: previously called runAfterResponse inline (inside tx) — if the
    // outer $transaction rolled back, the user received a phantom downgrade
    // notification for a state that never persisted. Effect scheduling happens
    // EXCLUSIVELY in the post-commit collector (pages/.../webhooks/stripe/index.ts).
    const userEmail = user.email;
    const userName = user.name;
    effects.push(async () => {
      try {
        await sendTransactionalEmail(
          'downgrade-notification',
          { email: userEmail, name: userName, id: account.created_by_user_id },
          APP_EVENTS.INFO.EMAIL.EMAIL_DOWNGRADE_NOTIFICATION_SENT,
          undefined,
          'email.downgrade.subject'
        );
      } catch (error: unknown) {
        reportIssueBackend({
          namespace: 'STRIPE_DOWNGRADE_NOTIFICATION_EMAIL_FAILED',
          message: error instanceof Error ? error.message : 'Email rejected',
          payload: {
            userId: account.created_by_user_id,
            accountId: account.account_id,
          },
          mode: 'error',
        });
      }
    });
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
