import type Stripe from 'stripe';
import type { Prisma } from '../../../../prisma/js-client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  AccountStatusValue,
  PairingStatusValue,
  EventLogTypeValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { updateAccountPlanStatus } from '@app/stripe/plan-status-update.operations';
import {
  enqueueEmailOutboxTx,
  kickEmailOutbox,
} from '@app/email-handler/outbox/email-outbox';
import { findAccountByCustomerId } from '@app/stripe/webhooks/stripe-webhooks.db';
import { extractCustomerId } from '@app/stripe/webhooks/stripe-webhooks.utils';
import {
  emptyEffectsResult,
  type StripeHandlerResult,
  type StripeWebhookEffect,
} from '@app/stripe/webhooks/stripe-effects.types';
import { DB_CLIENT } from '@app/db/db.client';
import { lifecycleMessageIdFromAudit } from '@app/email-handler/lifecycle/ledger-payload';
import {
  resolveDunningEmail,
  isDunningEmailAlreadySent,
} from '@domain/email/dunning-email.resolver';
import { isEventInfoNarrower } from '@kernel/models/type_narrowing';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { getPlanDisplayName } from '@kernel/domain/pricing/pricing.config';
import { buildGA4PurchaseEffect } from './ga4-purchase-effect';

/**
 * Subscription that generated this invoice, from the payload already in hand.
 * No Stripe retrieve: the webhook transaction must not do external IO.
 * A missing parent (legacy or non-subscription invoice) leaves the audit row
 * without subscriptionId; those rows can prove a historical sale only.
 */
const subscriptionIdFromInvoice = (invoice: Stripe.Invoice): string | null => {
  const parent = invoice.parent;
  if (parent?.type !== 'subscription_details') {
    return null;
  }
  const subscription = parent.subscription_details?.subscription;
  if (typeof subscription === 'string') {
    const id = subscription.trim();
    return id.length > 0 ? id : null;
  }
  if (subscription && typeof subscription.id === 'string') {
    const id = subscription.id.trim();
    return id.length > 0 ? id : null;
  }
  return null;
};

/**
 * Handle invoice.payment_succeeded event
 */
export const handleInvoicePaymentSucceeded = async ({
  invoice,
  eventCreatedAt,
  tx,
}: {
  invoice: Stripe.Invoice;
  eventCreatedAt: Date;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  const customerId = extractCustomerId({ customer: invoice.customer });

  if (!customerId) {
    reportIssueBackend({
      namespace: 'STRIPE_INVOICE_PAYMENT_SUCCEEDED',
      message: 'No customer ID in invoice',
      payload: { invoiceId: invoice.id },
      mode: 'error',
    });
    return emptyEffectsResult();
  }

  const account = await findAccountByCustomerId(customerId, tx);
  if (!account) {
    // DECISION: we do not assume every customer on the Stripe account belongs to this application.
    // A null account (customer not in our DB) is an out-of-scope event, not an incident: no critical
    // alert (it would be a false alarm). Mirrors checkout.session.completed (isOutOfScopeSession in
    // stripe-event-router). Info log for visibility, return without effects.
    reportIssueBackend({
      namespace: 'STRIPE_INVOICE_PAYMENT_SUCCEEDED',
      message: 'null account — event out of application scope, skipping',
      payload: { customerId, invoiceId: invoice.id },
      mode: 'info',
    });
    return emptyEffectsResult();
  }

  reportIssueBackend({
    namespace: 'STRIPE_INVOICE_PAYMENT_SUCCEEDED',
    message: 'Invoice payment succeeded',
    payload: {
      accountId: account.account_id,
      invoiceId: invoice.id,
      amountPaid: invoice.amount_paid,
    },
    mode: 'info',
  });

  const subscriptionId = subscriptionIdFromInvoice(invoice);
  // Historical invoices remain auditable, but cannot change the current subscription.
  if (
    subscriptionId !== null &&
    subscriptionId === account.subscription_id &&
    account.payment_status !== PaymentStatusValue.PAID
  ) {
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
      // oldPricingPlan: omitted - skip audit log (no plan change)
      source: 'stripe',
      createdByUserId: account.created_by_user_id,
      stripeEventAt: eventCreatedAt,
      expectedSubscriptionId: subscriptionId,
      ...(tx && { tx }),
    });
  }
  // DECISION: do NOT bump the recency watermark on the PAID-skip. invoice.payment_succeeded
  // carries no subscription snapshot, so fencing an older `subscription.updated` (e.g. a
  // legitimate `cancel_at_period_end` with a delayed FIRST delivery) would drop a real cancel =
  // continued billing. The risk outweighs the gain (fencing an older past_due touches only
  // payment_status, entitlement-safe, self-healed by sync). The watermark bump on skip is used
  // ONLY where the event CARRIES current state (the no-op gate in subscription-lifecycle, see
  // bumpStripeEventWatermark).

  await writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.ACCOUNT.STRIPE_INVOICE_PAYMENT_SUCCEEDED,
    eventLogType: EventLogTypeValue.ACCOUNT,
    eventPayloadToStringify: {
      accountId: account.account_id,
      invoiceId: invoice.id,
      amountPaid: invoice.amount_paid,
      ...(typeof invoice.created === 'number'
        ? { invoiceCreatedAt: invoice.created }
        : {}),
      ...(typeof invoice.status_transitions?.paid_at === 'number'
        ? { paymentConfirmedAt: invoice.status_transitions.paid_at }
        : {}),
      // Present only when the invoice names its subscription. A zero amount
      // is still recorded so a later 100% invoice can end "currently paying".
      ...(subscriptionId ? { subscriptionId } : {}),
    },
    meta: {
      created_by_user_id: account.created_by_user_id,
    },
    ...(tx && { tx }),
  });

  // GA4 revenue is a POST-COMMIT effect, never in the transaction: a rolled-back
  // transaction must not report a purchase that did not happen, and a network call
  // inside it would hold it open for a round trip to Google.
  const ga4Effect = buildGA4PurchaseEffect(invoice);

  return ga4Effect ? { effects: [ga4Effect] } : emptyEffectsResult();
};

/**
 * Handle invoice.payment_failed event
 */
export const handleInvoicePaymentFailed = async ({
  invoice,
  eventCreatedAt,
  tx,
}: {
  invoice: Stripe.Invoice;
  eventCreatedAt: Date;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  const effects: StripeWebhookEffect[] = [];

  const customerId = extractCustomerId({ customer: invoice.customer });

  if (!customerId) {
    reportIssueBackend({
      namespace: 'STRIPE_INVOICE_PAYMENT_FAILED',
      message: 'No customer ID in invoice',
      payload: { invoiceId: invoice.id },
      mode: 'error',
    });
    return emptyEffectsResult();
  }

  const account = await findAccountByCustomerId(customerId, tx);
  if (!account) {
    reportIssueBackend({
      namespace: 'STRIPE_INVOICE_PAYMENT_FAILED',
      message: 'Account not found for customer',
      payload: { customerId, invoiceId: invoice.id },
      mode: 'warn',
    });
    return emptyEffectsResult();
  }

  reportIssueBackend({
    namespace: 'STRIPE_INVOICE_PAYMENT_FAILED',
    message: 'Invoice payment failed - user should update payment method',
    payload: {
      accountId: account.account_id,
      invoiceId: invoice.id,
      attemptCount: invoice.attempt_count,
    },
    mode: 'warn',
  });

  const subscriptionId = subscriptionIdFromInvoice(invoice);
  // Preserve the actual failed-invoice notification and audit, but do not
  // apply an old subscription's payment state to a different current one.
  if (subscriptionId !== null && subscriptionId === account.subscription_id) {
    await updateAccountPlanStatus({
      accountId: account.account_id,
      pricingPlan: account.pricing_plan,
      paymentStatus: PaymentStatusValue.IN_PROGRESS,
      accountStatus: account.account_status,
      subscriptionStatus:
        account.subscription_status ?? SubscriptionStatusValue.ACTIVE,
      subscriptionId: account.subscription_id,
      cancelAtPeriodEnd: account.cancel_at_period_end ?? false,
      cancelAt: account.cancel_at,
      currentPeriodEnd: account.current_period_end,
      // oldPricingPlan: omitted - skip audit log (no plan change)
      source: 'stripe',
      createdByUserId: account.created_by_user_id,
      stripeEventAt: eventCreatedAt,
      expectedSubscriptionId: subscriptionId,
      ...(tx && { tx }),
    });
  }

  await writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.ACCOUNT.STRIPE_INVOICE_PAYMENT_FAILED,
    eventLogType: EventLogTypeValue.ACCOUNT,
    eventPayloadToStringify: {
      accountId: account.account_id,
      invoiceId: invoice.id,
    },
    meta: {
      created_by_user_id: account.created_by_user_id,
    },
    ...(tx && { tx }),
  });

  // DECISION: dunning and payment-failed emails are deliberately NOT gated on the recency guard
  // (`applied`), unlike the assertive upgrade/downgrade/churn effects. They notify about a REAL
  // event (a failed charge attempt) rather than confirm a state change, so they are correct
  // regardless of write order. Gating on `applied` would lose a legitimate dunning reminder when an
  // unrelated newer `subscription.updated(past_due)` (still in dunning, not superseded) was
  // processed BEFORE this invoice.payment_failed. Anti-spam is the per-invoice outbox key of each
  // dunning rule below, not the recency guard. A phantom email after cancellation
  // (rare stale invoice after subscription.deleted) is acceptable: the "update your card" prompt
  // is at worst mildly outdated, while losing real dunning means higher involuntary churn.
  const db = tx ?? DB_CLIENT.use;
  const user = await db.user.findUnique({
    where: { id: account.created_by_user_id },
    select: { email: true },
  });
  if (user?.email) {
    // DECISION: these mails are DURABLE INTENTS written in this transaction (email outbox,
    // owner D13): the intent commits with processed=true or not at all, and the provider is
    // called after commit (kick below, `email-outbox` job as backstop). A post-commit closure
    // alone was lost when the process died after the commit. Dedup keys: one payment-failed
    // per invoice attempt; one dunning mail per rule and INVOICE (not per billing period: a
    // renewal invoice's period_start is the previous period, so a period key collided across
    // cycles, and the subscription_create invoice shares its period with the first cycle).
    // Payment-failure emails fire for ANY paid plan (Pro/Pro+/Studio) — the plan
    // name is interpolated ({{planName}}), never hardcoded 'Pro' (a Studio
    // subscriber must not be told about "your Pro plan").
    const planName = getPlanDisplayName(account.pricing_plan);
    const attemptCount = invoice.attempt_count ?? 1;
    const queuedIds: string[] = [];
    const paymentFailedId = await enqueueEmailOutboxTx(db, {
      userId: account.created_by_user_id,
      accountId: account.account_id,
      ruleId: 'payment-failed',
      templateId: 'payment-failed',
      occurrence: `invoice:${invoice.id}:attempt:${attemptCount}`,
      subjectKey: 'email.paymentFailed.subject',
      infoEvent: APP_EVENTS.INFO.EMAIL.EMAIL_PAYMENT_FAILED_SENT,
      vars: { planName },
    });
    if (paymentFailedId) {
      queuedIds.push(paymentFailedId);
    }

    const dunningRule = resolveDunningEmail(attemptCount);
    if (dunningRule) {
      // DECISION: legacy dedup ONLY for dunning mails sent before the outbox (their EventLog rows
      // carry no lifecycleMessageId). Rows the outbox writes carry it and are ignored here: the
      // outbox key is their dedup, and counting them suppressed the next cycle's dunning (a
      // renewal invoice's period_start reaches back into the period of the previous mail).
      // Removable once no pre-outbox dunning row is younger than a billing period.
      const sentDunningLogs = await db.eventLog.findMany({
        where: {
          event_type: EventLogTypeValue.EMAIL,
          created_by_user_id: account.created_by_user_id,
          event: dunningRule.infoEvent,
          // Without a lower bound "already sent" was PERMANENT across cycles.
          created_at: { gte: new Date(invoice.period_start * 1000) },
        },
        select: { event: true, event_payload: true },
        take: 20,
      });
      // Query filters by dunningRule.infoEvent (a typed EVENT_INFO_TYPE),
      // so any row that comes back is by construction the same value — safe to narrow.
      const sentEvents = new Set<EVENT_INFO_TYPE>(
        sentDunningLogs
          .filter(
            log => lifecycleMessageIdFromAudit(log.event_payload) === null
          )
          .map(l => l.event)
          .filter(isEventInfoNarrower)
      );

      if (!isDunningEmailAlreadySent(sentEvents, dunningRule)) {
        // dunning-urgent/final bodies interpolate {{galleryCount}}/{{pairedClientsCount}}
        // (endowment framing: "what you lose"). Fetch real counts — same unfiltered
        // semantics as the trial sweep (_count.gallery_record + all stylist_pairings).
        // Without vars the placeholders rendered as empty strings.
        const accountStats = await db.stylistAccount.findUnique({
          where: { account_id: account.account_id },
          select: {
            _count: {
              select: {
                gallery_record: true,
                // Filtr ACTIVE (stały QR 2026-07-11): dunning „stracisz N
                // klientek" nie może liczyć próśb PENDING ani REVOKED.
                stylist_pairings: {
                  where: { status: PairingStatusValue.ACTIVE },
                },
              },
            },
          },
        });
        const dunningId = await enqueueEmailOutboxTx(db, {
          userId: account.created_by_user_id,
          accountId: account.account_id,
          ruleId: dunningRule.id,
          templateId: dunningRule.bodyTemplateId,
          occurrence: `invoice:${invoice.id}`,
          subjectKey: dunningRule.subjectKey,
          infoEvent: dunningRule.infoEvent,
          vars: {
            planName,
            galleryCount: String(accountStats?._count.gallery_record ?? 0),
            pairedClientsCount: String(
              accountStats?._count.stylist_pairings ?? 0
            ),
          },
        });
        if (dunningId) {
          queuedIds.push(dunningId);
          reportIssueBackend({
            namespace: 'DUNNING_EMAIL_SENT',
            message: `Dunning email queued: ${dunningRule.id} (attempt ${attemptCount})`,
            payload: {
              accountId: account.account_id,
              attemptCount,
              ruleId: dunningRule.id,
            },
            mode: 'info',
          });
        }
      }
    }
    if (queuedIds.length > 0) {
      effects.push(kickEmailOutbox(queuedIds));
    }
  }

  return { effects };
};

/**
 * Handle invoice.upcoming event
 */
export const handleInvoiceUpcoming = async ({
  invoice,
  tx,
}: {
  invoice: Stripe.Invoice;
  tx?: Prisma.TransactionClient;
}): Promise<StripeHandlerResult> => {
  const customerId = extractCustomerId({ customer: invoice.customer });
  if (!customerId) {
    reportIssueBackend({
      namespace: 'STRIPE_INVOICE_UPCOMING',
      message: 'No customer ID in invoice',
      payload: { invoiceId: invoice.id },
      mode: 'error',
    });
    return emptyEffectsResult();
  }

  const account = await findAccountByCustomerId(customerId, tx);
  if (!account) {
    return emptyEffectsResult();
  }

  await writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.ACCOUNT.STRIPE_INVOICE_UPCOMING,
    eventLogType: EventLogTypeValue.ACCOUNT,
    eventPayloadToStringify: {
      accountId: account.account_id,
      amountDue: invoice.amount_due,
      dueDate: invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000)
        : null,
    },
    meta: { created_by_user_id: account.created_by_user_id },
    ...(tx && { tx }),
  });

  reportIssueBackend({
    namespace: 'STRIPE_INVOICE_UPCOMING',
    message: 'Upcoming invoice notification processed',
    payload: { accountId: account.account_id, amountDue: invoice.amount_due },
    mode: 'info',
  });

  return emptyEffectsResult();
};
