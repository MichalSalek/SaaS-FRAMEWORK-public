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
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import { findAccountByCustomerId } from '@app/stripe/webhooks/stripe-webhooks.db';
import { extractCustomerId } from '@app/stripe/webhooks/stripe-webhooks.utils';
import {
  emptyEffectsResult,
  type StripeHandlerResult,
  type StripeWebhookEffect,
} from '@app/stripe/webhooks/stripe-effects.types';
import { DB_CLIENT } from '@app/db/db.client';
import {
  resolveDunningEmail,
  isDunningEmailAlreadySent,
} from '@domain/email/dunning-email.resolver';
import { isEventInfoNarrower } from '@kernel/models/type_narrowing';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { getPlanDisplayName } from '@kernel/domain/pricing/pricing.config';
import { buildGA4PurchaseEffect } from './ga4-purchase-effect';

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
    // DECISION (nie usuwaj tego komentarza):
    // Nie zakładamy, że customer na koncie Stripe należy do tej aplikacji.
    // Null-account (customer nie w naszej DB) = event spoza zakresu aplikacji,
    // NIE incydent — więc NIE eskalujemy do critical-alert (byłby fałszywy alarm).
    // Mirror decyzji z checkout.session.completed (isOutOfScopeSession w
    // stripe-event-router). Info-log dla widoczności, return bez effects.
    reportIssueBackend({
      namespace: 'STRIPE_INVOICE_PAYMENT_SUCCEEDED',
      message:
        'null account — event out of application scope, skipping',
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

  // Ensure payment status is marked as paid (use SSOT function)
  if (account.payment_status !== PaymentStatusValue.PAID) {
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
      ...(tx && { tx }),
    });
  }
  // DECISION (nie usuwaj tego komentarza):
  // NIE bumpujemy recency-watermarka na PAID-skip. invoice.payment_succeeded nie
  // niesie snapshotu subskrypcji, więc fencowanie starszego `subscription.updated`
  // (np. legit `cancel_at_period_end` z opóźnioną PIERWSZĄ dostawą) zdropowałoby
  // realny cancel = dalsze naliczanie. Ryzyko przewyższa zysk (fencing starszego
  // past_due to tylko payment_status, entitlement-safe, self-heal przez sync).
  // Watermark-bump na skip stosujemy TYLKO tam, gdzie event NIESIE aktualny stan
  // (D10 no-op gate w subscription-lifecycle — patrz bumpStripeEventWatermark).

  await writeRawEventLog_IO({
    eventName: APP_EVENTS.INFO.ACCOUNT.STRIPE_INVOICE_PAYMENT_SUCCEEDED,
    eventLogType: EventLogTypeValue.ACCOUNT,
    eventPayloadToStringify: {
      accountId: account.account_id,
      invoiceId: invoice.id,
      amountPaid: invoice.amount_paid,
    },
    meta: {
      created_by_user_id: account.created_by_user_id,
    },
    ...(tx && { tx }),
  });

  // Przychód do GA4 — jako efekt POST-COMMIT, nigdy w transakcji. Wycofana
  // transakcja nie może zaraportować zakupu, którego nie było, a wywołanie
  // sieciowe w środku transakcji trzymałoby ją otwartą na czas rundy do Google.
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

  // Mark payment status as in progress (Stripe will retry) - use SSOT function.
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
    ...(tx && { tx }),
  });

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

  // DECISION (nie usuwaj tego komentarza):
  // Dunning + payment-failed email CELOWO NIE są gejtowane na recency-guard (`applied`),
  // w przeciwieństwie do assertive upgrade/downgrade/churn effectów w checkout/subscription
  // handlerach. Powód (testy-api closing-review): te maile notyfikują o REALNYM zdarzeniu
  // (nieudana próba obciążenia karty), a nie potwierdzają zmianę stanu — więc są poprawne
  // niezależnie od kolejności zapisu. Gejtowanie na `applied` gubiłoby LEGIT przypomnienie
  // dunningowe, gdy niezwiązany, nowszy `subscription.updated(past_due)` (wciąż w dunningu,
  // NIE superseded) ma późniejszy event.created i został przetworzony PRZED tym
  // invoice.payment_failed → recency-skip mimo że user WCIĄŻ powinien dostać monit.
  // Anty-spam zapewnia period-scoped dedup dunningu niżej (created_at >= period_start),
  // NIE recency-guard. Phantom-po-anulowaniu (rzadki, stale invoice po subscription.deleted)
  // jest akceptowalny: przy realnie nieudanej płatności monit „zaktualizuj kartę" jest
  // co najwyżej łagodnie nieaktualny, a utrata realnego dunningu = wyższy involuntary churn.
  const user = await (tx ?? DB_CLIENT.use).user.findUnique({
    where: { id: account.created_by_user_id },
    select: { email: true, name: true },
  });
  if (user?.email) {
    // DECISION (nie usuwaj tego komentarza):
    // Email send is queued as a post-commit effect — Stripe webhook needs <5s
    // response; durability handled by FailedEmail table + EMAIL_DEAD_LETTERED
    // audit. C1: previously called runAfterResponse inline (inside tx) — if the
    // outer $transaction rolled back, the user received a phantom payment-failed
    // email for a state that never persisted. Effect scheduling happens
    // EXCLUSIVELY in the post-commit collector (pages/.../webhooks/stripe/index.ts).
    const userEmail = user.email;
    const userName = user.name;
    // Payment-failure emails fire for ANY paid plan (Pro/Pro+/Studio) — the plan
    // name is interpolated ({{planName}}), never hardcoded 'Pro' (a Studio
    // subscriber must not be told about "your Pro plan").
    const planName = getPlanDisplayName(account.pricing_plan);
    effects.push(async () => {
      try {
        await sendTransactionalEmail(
          'payment-failed',
          { email: userEmail, name: userName, id: account.created_by_user_id },
          APP_EVENTS.INFO.EMAIL.EMAIL_PAYMENT_FAILED_SENT,
          { planName },
          'email.paymentFailed.subject'
        );
      } catch (error: unknown) {
        reportIssueBackend({
          namespace: 'STRIPE_PAYMENT_FAILED_EMAIL_FAILED',
          message: error instanceof Error ? error.message : 'Email rejected',
          payload: {
            userId: account.created_by_user_id,
            invoiceId: invoice.id,
          },
          mode: 'error',
        });
      }
    });

    const attemptCount = invoice.attempt_count ?? 1;
    const dunningRule = resolveDunningEmail(attemptCount);
    if (dunningRule) {
      const sentDunningLogs = await (tx ?? DB_CLIENT.use).eventLog.findMany({
        where: {
          event_type: EventLogTypeValue.EMAIL,
          created_by_user_id: account.created_by_user_id,
          event: dunningRule.infoEvent,
          // Scope dedup to THIS invoice's billing period (interval-agnostic). Without
          // a lower bound "already sent" was PERMANENT: a returning customer whose
          // payment fails again in a later cycle would be suppressed forever and get
          // no dunning email. period_start fences each cycle's dunning to its own period.
          created_at: { gte: new Date(invoice.period_start * 1000) },
        },
        select: { event: true },
        take: 1,
      });
      // Query filters by dunningRule.infoEvent (a typed EVENT_INFO_TYPE),
      // so any row that comes back is by construction the same value — safe to narrow.
      const sentEvents = new Set<EVENT_INFO_TYPE>(
        sentDunningLogs.map(l => l.event).filter(isEventInfoNarrower)
      );

      if (!isDunningEmailAlreadySent(sentEvents, dunningRule)) {
        // dunning-urgent/final bodies interpolate {{galleryCount}}/{{pairedClientsCount}}
        // (endowment framing: "what you lose"). Fetch real counts — same unfiltered
        // semantics as the trial sweep (_count.gallery_record + all stylist_pairings).
        // Without vars the placeholders rendered as empty strings.
        const accountStats = await (
          tx ?? DB_CLIENT.use
        ).stylistAccount.findUnique({
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
        const dunningVars: Record<string, string> = {
          planName,
          galleryCount: String(accountStats?._count.gallery_record ?? 0),
          pairedClientsCount: String(
            accountStats?._count.stylist_pairings ?? 0
          ),
        };
        effects.push(async () => {
          try {
            await sendTransactionalEmail(
              dunningRule.bodyTemplateId,
              {
                email: userEmail,
                name: userName,
                id: account.created_by_user_id,
              },
              dunningRule.infoEvent,
              dunningVars,
              dunningRule.subjectKey
            );
          } catch (error: unknown) {
            reportIssueBackend({
              namespace: 'STRIPE_DUNNING_EMAIL_FAILED',
              message:
                error instanceof Error ? error.message : 'Email rejected',
              payload: {
                userId: account.created_by_user_id,
                attemptCount,
                ruleId: dunningRule.id,
              },
              mode: 'error',
            });
          }
        });

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
