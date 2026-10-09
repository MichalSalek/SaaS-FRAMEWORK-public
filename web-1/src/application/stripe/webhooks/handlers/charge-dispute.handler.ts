import type Stripe from 'stripe';
import type { Prisma } from '../../../../prisma/js-client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  AccountStatusValue,
  EventLogTypeValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { updateAccountPlanStatus } from '@app/stripe/plan-status-update.operations';
import { findAccountByCustomerId } from '@app/stripe/webhooks/stripe-webhooks.db';
import {
  buildCriticalAlertEffect,
  extractCustomerId,
} from '@app/stripe/webhooks/stripe-webhooks.utils';
import {
  emptyEffectsResult,
  type StripeHandlerResult,
  type StripeWebhookEffect,
} from '@app/stripe/webhooks/stripe-effects.types';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { stripeDashboardLinkProp } from '@app/stripe/stripe-dashboard.links';

/**
 * Resolve the customer behind a dispute's charge.
 *
 * D2-F1 (PRMA) — WOŁAJ TO POZA `$transaction`: the `charges.retrieve` fallback is a Stripe
 * round-trip with a 20s timeout inside a 25s tx budget. Exported so stripe-event-prefetch
 * resolves it before the tx opens; the in-handler call remains only as the fallback for
 * callers that do not prefetch.
 */
export const resolveCustomerIdFromDispute = async (
  dispute: Stripe.Dispute
): Promise<string | undefined> => {
  const charge = dispute.charge;

  if (typeof charge !== 'string') {
    return extractCustomerId({ customer: charge.customer });
  }

  try {
    // d2f1-allow: fallback dla callerów bez prefetchu — webhookowa ścieżka rozwiązuje
    // customera w prefetchStripeEventContext, PRZED transakcją (prefetchedCustomerId).
    const expandedCharge = await getStripe().charges.retrieve(charge);
    return extractCustomerId({ customer: expandedCharge.customer });
  } catch (error) {
    reportIssueBackend({
      namespace: 'STRIPE_DISPUTE_RESOLVE_CUSTOMER',
      message: 'Failed to retrieve charge for dispute',
      payload: { disputeId: dispute.id, chargeId: charge, error },
      mode: 'error',
    });
    return undefined;
  }
};

export const handleChargeDisputeCreated = async ({
  dispute,
  eventCreatedAt,
  prefetchedCustomerId,
  tx,
}: {
  dispute: Stripe.Dispute;
  eventCreatedAt: Date;
  /** `undefined` = nie prefetchowano (rozwiąż sam); `null` = już próbowano bez skutku. */
  prefetchedCustomerId?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  const effects: StripeWebhookEffect[] = [];
  const customerId =
    prefetchedCustomerId !== undefined
      ? (prefetchedCustomerId ?? undefined)
      : await resolveCustomerIdFromDispute(dispute);

  if (!customerId) {
    effects.push(
      buildCriticalAlertEffect({
        context: 'STRIPE_CHARGE_DISPUTE_NO_CUSTOMER',
        diagnostic: { disputeId: dispute.id },
        alert: {
          alertTitle: 'Spór o płatność bez identyfikatora klienta',
          ...stripeDashboardLinkProp('disputes', dispute.id),
          alertMessage:
            'Otwarto spór o płatność, ale nie da się ustalić klienta.',
          details: {
            disputeId: dispute.id,
            chargeId:
              typeof dispute.charge === 'string'
                ? dispute.charge
                : dispute.charge.id,
            amount: dispute.amount,
            currency: dispute.currency,
            reason: dispute.reason,
            timestamp: new Date().toISOString(),
          },
        },
      })
    );
    return { effects };
  }

  const account = await findAccountByCustomerId(customerId, tx);

  if (!account) {
    // DECISION (nie usuwaj tego komentarza):
    // Nie zakładamy, że customer na koncie Stripe należy do tej aplikacji.
    // Null-account (customer nie w naszej DB) = spór spoza zakresu aplikacji,
    // NIE incydent — więc NIE eskalujemy do critical-alert (byłby fałszywy alarm).
    // Mirror decyzji z checkout.session.completed (isOutOfScopeSession w
    // stripe-event-router). Info-log dla widoczności, return bez effects.
    reportIssueBackend({
      namespace: 'STRIPE_CHARGE_DISPUTE_NO_ACCOUNT',
      message:
        'null account — event out of application scope, skipping',
      payload: { disputeId: dispute.id, customerId },
      mode: 'info',
    });
    return emptyEffectsResult();
  }

  // DECISION (nie usuwaj tego komentarza):
  // stripeEventAt poddaje zapis sporu recency-guardowi (zapobiega stale-dispute
  // resurrection: opóźniony `charge.dispute.closed·won` nie przywróci PAID/ACTIVE na
  // koncie anulowanym nowszym eventem — oryginalny finding). Akceptowany trade-off
  // (testy-api closing-review): niezwiązany nowszy `subscription.*` może pominąć zapis
  // suspend/reactivate sporu. To LOW-impact bo (a) `pricing_plan` (jedyne źródło
  // entitlement) NIE jest tu zmieniany — spór rusza tylko payment_status/account_status,
  // które NIE gejtują dostępu do app (gejtuje is_active + pricing_plan); (b) alert
  // sporu (created / lost) odpala BEZWARUNKOWO → operator działa ręcznie w Stripe.
  await updateAccountPlanStatus({
    accountId: account.account_id,
    pricingPlan: account.pricing_plan,
    paymentStatus: PaymentStatusValue.UNPAID,
    accountStatus: AccountStatusValue.NOT_ACTIVE,
    subscriptionStatus: SubscriptionStatusValue.PAST_DUE,
    subscriptionId: account.subscription_id,
    cancelAtPeriodEnd: account.cancel_at_period_end ?? false,
    cancelAt: account.cancel_at,
    currentPeriodEnd: account.current_period_end,
    source: 'stripe',
    createdByUserId: account.created_by_user_id,
    stripeEventAt: eventCreatedAt,
    ...(tx && { tx }),
  });

  effects.push(
    buildCriticalAlertEffect({
      context: 'STRIPE_CHARGE_DISPUTE_CREATED',
      diagnostic: { disputeId: dispute.id, accountId: account.account_id },
      alert: {
        alertTitle: 'Spór o płatność: konto zawieszone',
        ...stripeDashboardLinkProp('disputes', dispute.id),
        alertMessage: `Otwarto spór dla konta ${account.account_id}. Konto ma teraz status UNPAID i NOT_ACTIVE. Sprawdź spór w panelu Stripe.`,
        details: {
          disputeId: dispute.id,
          accountId: account.account_id,
          amount: dispute.amount,
          currency: dispute.currency,
          reason: dispute.reason,
          status: dispute.status,
          timestamp: new Date().toISOString(),
        },
      },
    })
  );

  // DECISION (nie usuwaj tego komentarza):
  // Dispute event log is awaited (not void) — disputes are legally/financially
  // material; this audit row is the durable record of the event. Webhook already
  // performed DB writes (updateAccountPlanStatus), one more await is acceptable
  // vs losing the audit trail if the floating promise is dropped on cold-start.
  await writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.ACCOUNT.STRIPE_CHARGE_DISPUTE_CREATED,
    eventLogType: EventLogTypeValue.ACCOUNT,
    eventPayloadToStringify: {
      disputeId: dispute.id,
      accountId: account.account_id,
      amount: dispute.amount,
      currency: dispute.currency,
      reason: dispute.reason,
    },
    meta: { created_by_user_id: account.created_by_user_id },
    ...(tx && { tx }),
  });

  reportIssueBackend({
    namespace: 'STRIPE_CHARGE_DISPUTE_CREATED',
    message: `Dispute opened: ${dispute.id}, account ${account.account_id} suspended`,
    payload: {
      disputeId: dispute.id,
      accountId: account.account_id,
      amount: dispute.amount,
      reason: dispute.reason,
    },
    mode: 'error',
  });

  return { effects };
};

export const handleChargeDisputeClosed = async ({
  dispute,
  eventCreatedAt,
  prefetchedCustomerId,
  tx,
}: {
  dispute: Stripe.Dispute;
  eventCreatedAt: Date;
  /** `undefined` = nie prefetchowano (rozwiąż sam); `null` = już próbowano bez skutku. */
  prefetchedCustomerId?: string | null;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  const effects: StripeWebhookEffect[] = [];
  const customerId =
    prefetchedCustomerId !== undefined
      ? (prefetchedCustomerId ?? undefined)
      : await resolveCustomerIdFromDispute(dispute);

  if (!customerId) {
    reportIssueBackend({
      namespace: 'STRIPE_CHARGE_DISPUTE_CLOSED',
      message: 'Dispute closed but no customer ID resolved',
      payload: { disputeId: dispute.id, status: dispute.status },
      mode: 'warn',
    });
    return emptyEffectsResult();
  }

  const account = await findAccountByCustomerId(customerId, tx);
  if (!account) {
    reportIssueBackend({
      namespace: 'STRIPE_CHARGE_DISPUTE_CLOSED',
      message: 'Dispute closed but account not found',
      payload: { disputeId: dispute.id, customerId },
      mode: 'warn',
    });
    return emptyEffectsResult();
  }

  const disputeWon = dispute.status === 'won';
  const disputeLost = dispute.status === 'lost';

  if (disputeLost) {
    effects.push(
      buildCriticalAlertEffect({
        context: 'STRIPE_CHARGE_DISPUTE_LOST',
        diagnostic: { disputeId: dispute.id, accountId: account.account_id },
        alert: {
          alertTitle: 'Spór o płatność przegrany: środki pobrane',
          ...stripeDashboardLinkProp('disputes', dispute.id),
          alertMessage: `Spór ${dispute.id} został przegrany i środki zostały pobrane. Potrzebne ręczne działanie.`,
          details: {
            disputeId: dispute.id,
            accountId: account.account_id,
            amount: dispute.amount,
            currency: dispute.currency,
            reason: dispute.reason,
            timestamp: new Date().toISOString(),
          },
        },
      })
    );
  }

  if (disputeWon) {
    await updateAccountPlanStatus({
      accountId: account.account_id,
      pricingPlan: account.pricing_plan,
      paymentStatus: PaymentStatusValue.PAID,
      accountStatus: AccountStatusValue.ACTIVE,
      subscriptionStatus:
        account.subscription_status ?? SubscriptionStatusValue.ACTIVE,
      subscriptionId: account.subscription_id,
      cancelAtPeriodEnd: account.cancel_at_period_end ?? false,
      cancelAt: account.cancel_at,
      currentPeriodEnd: account.current_period_end,
      source: 'stripe',
      createdByUserId: account.created_by_user_id,
      stripeEventAt: eventCreatedAt,
      ...(tx && { tx }),
    });
  }

  // DECISION (nie usuwaj tego komentarza):
  // Dispute close event log is awaited (not void) — disputes are legally/financially
  // material; this audit row is the durable record of resolution. Awaiting blocks
  // webhook ack by ms-tens (single DB INSERT), acceptable trade-off vs losing
  // audit trail if the floating promise is dropped on serverless cold-start.
  await writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.ACCOUNT.STRIPE_CHARGE_DISPUTE_CLOSED,
    eventLogType: EventLogTypeValue.ACCOUNT,
    eventPayloadToStringify: {
      disputeId: dispute.id,
      accountId: account.account_id,
      status: dispute.status,
      disputeWon,
    },
    meta: { created_by_user_id: account.created_by_user_id },
    ...(tx && { tx }),
  });

  reportIssueBackend({
    namespace: 'STRIPE_CHARGE_DISPUTE_CLOSED',
    message: `Dispute ${dispute.id} closed: ${dispute.status}${disputeWon ? ' — account reactivated' : ' — account remains suspended'}`,
    payload: {
      disputeId: dispute.id,
      accountId: account.account_id,
      status: dispute.status,
      disputeWon,
    },
    mode: disputeWon ? 'info' : 'error',
  });

  return { effects };
};
