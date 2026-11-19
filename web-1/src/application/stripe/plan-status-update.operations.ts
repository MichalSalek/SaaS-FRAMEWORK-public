import { finishFreeForSalonAccess_IO } from '@app/email-handler/lifecycle/access-grants';
import type { UpdateAccountPlanStatusParams } from './stripe.types';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { Prisma } from '../../prisma/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';

// DECISION: this application-layer Stripe code mutates StylistAccount, a deliberate boundary
// blur: webhook handlers must ack in <5s, so the plan/payment_status update lives here (next to
// the Stripe API client) instead of domain/account/, in one atomic transaction.

// DECISION: the optional `tx` param enables the atomic webhook flow
// $transaction(tx => { claimEventForProcessingTx(tx, eventId); routeStripeEvent(event, tx) }).
// With tx we reuse it directly (Prisma forbids nested $transaction); without it (non-webhook
// callers) we open our own interactive transaction to keep the stylistAccount update and the
// audit eventLog write atomic. Same tx-aware design as writeRawEventLog_IO.

// DECISION: the signature is ONE typed params object (UpdateAccountPlanStatusParams), not 12
// positional arguments (named fields resist argument-order mistakes), and deliberately has no
// applyStripeSnapshot wrapper: 4 call sites build the params directly (rule of three). This is
// the SSOT of plan mutations; every Stripe path goes through here for consistent audit.

export const bumpStripeEventWatermark = async ({
  accountId,
  stripeEventAt,
  tx,
}: {
  accountId: string;
  stripeEventAt: Date;
  tx?: Prisma.TransactionClient;
}): Promise<void> => {
  const client = tx ?? DB_CLIENT.use;
  await client.stylistAccount.updateMany({
    where: {
      account_id: accountId,
      OR: [
        { last_stripe_event_at: null },
        { last_stripe_event_at: { lte: stripeEventAt } },
      ],
    },
    data: { last_stripe_event_at: stripeEventAt },
  });
};

export const updateAccountPlanStatus = async (
  params: UpdateAccountPlanStatusParams & { tx?: Prisma.TransactionClient }
): Promise<boolean> => {
  const {
    accountId,
    pricingPlan,
    paymentStatus,
    accountStatus,
    subscriptionStatus,
    subscriptionId,
    stripeCustomerId,
    cancelAtPeriodEnd,
    cancelAt,
    currentPeriodEnd,
    accountExpirationDate,
    upcomingPaymentDate,
    oldPricingPlan,
    source = 'stripe',
    createdByUserId,
    stripeEventAt,
    expectedSubscriptionId,
    tx,
  } = params;

  const dataPayload = {
    pricing_plan: pricingPlan,
    payment_status: paymentStatus,
    account_status: accountStatus,
    subscription_status: subscriptionStatus,
    subscription_id: subscriptionId,
    ...(stripeCustomerId && { stripe_customer_id: stripeCustomerId }),
    cancel_at_period_end: cancelAtPeriodEnd,
    cancel_at: cancelAt,
    current_period_end: currentPeriodEnd,
    // DECISION: Stripe is the sole owner of these two fields. Any path that omits the params writes
    // null (deferred to the subscription.updated webhook). The account-expiry sweep reads
    // current_period_end (always set), NOT these two columns.
    account_expiration_date: accountExpirationDate ?? null,
    upcoming_payment_date: upcomingPaymentDate ?? null,
  };

  // Returns false when an out-of-order (stale) Stripe event was skipped, true otherwise.
  const runMutation = async (
    client: Prisma.TransactionClient
  ): Promise<boolean> => {
    if (stripeEventAt || expectedSubscriptionId !== undefined) {
      const { count } = await client.stylistAccount.updateMany({
        where: {
          account_id: accountId,
          ...(expectedSubscriptionId !== undefined
            ? { subscription_id: expectedSubscriptionId }
            : {}),
          ...(stripeEventAt
            ? {
                OR: [
                  { last_stripe_event_at: null },
                  { last_stripe_event_at: { lte: stripeEventAt } },
                ],
              }
            : {}),
        },
        data: {
          ...dataPayload,
          ...(stripeEventAt ? { last_stripe_event_at: stripeEventAt } : {}),
        },
      });
      if (count === 0) {
        reportIssueBackend({
          namespace: 'STRIPE_STALE_EVENT_SKIPPED',
          message:
            'Stripe event is stale or its subscription no longer matches — plan write skipped',
          payload: {
            accountId,
            stripeEventAt: stripeEventAt?.toISOString(),
            attemptedPlan: pricingPlan,
          },
          mode: 'info',
        });
        return false;
      }
    } else {
      await client.stylistAccount.update({
        where: { account_id: accountId },
        data: dataPayload,
      });
    }

    if (
      (pricingPlan === 'STUDIO' || pricingPlan === 'SCALE') &&
      subscriptionStatus === 'ACTIVE' &&
      accountStatus === 'ACTIVE'
    ) {
      await finishFreeForSalonAccess_IO(client, accountId);
    }

    if (oldPricingPlan !== undefined && oldPricingPlan !== pricingPlan) {
      await writeRawEventLog_IO({
        eventName: APP_EVENTS.INFO.ADMIN.ADMIN_PRICING_PLAN_CHANGED,
        eventLogType: EventLogTypeValue.ACCOUNT,
        eventPayloadToStringify: {
          accountId,
          oldPricingPlan,
          newPricingPlan: pricingPlan,
          source,
          paymentStatus,
          subscriptionId,
        },
        meta: {
          created_by_user_id: createdByUserId ?? accountId,
        },
        tx: client,
      });
    }
    return true;
  };

  const applied = tx
    ? // Outer caller (e.g. Stripe webhook) already holds an interactive transaction.
      // Reuse it so this mutation commits/aborts atomically with the webhook's
      // claimEventForProcessingTx call — no nested $transaction (Prisma forbids it).
      await runMutation(tx)
    : await DB_CLIENT.use.$transaction(runMutation);

  if (!applied) {
    // Stale out-of-order event: nothing written, skip the success/audit reports.
    // `false` propagates to callers so they skip post-commit "state changed" effects.
    return false;
  }

  reportIssueBackend({
    namespace: 'PLAN_STATUS_UPDATED',
    message: 'Account plan status updated via SSOT function',
    payload: {
      accountId,
      pricingPlan,
      paymentStatus,
      accountStatus,
      subscriptionStatus,
      hasSubscriptionId: Boolean(subscriptionId),
      hasStripeCustomerId: Boolean(stripeCustomerId),
      cancelAtPeriodEnd,
      source,
    },
    mode: 'info',
  });

  if (oldPricingPlan !== undefined && oldPricingPlan !== pricingPlan) {
    reportIssueBackend({
      namespace: 'PLAN_CHANGED_AUDIT',
      message: 'Plan change logged to audit trail',
      payload: {
        accountId,
        oldPricingPlan,
        newPricingPlan: pricingPlan,
        source,
      },
      mode: 'info',
    });
  }

  return true;
};
