import type { UpdateAccountPlanStatusParams } from './stripe.types';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { Prisma } from '../../prisma/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { writeRawEventLog_IO } from '@app/event-log/event-log.client';

// DECISION (nie usuwaj tego komentarza):
// Application-layer Stripe mutation StylistAccount — boundary blur intentional.
// Stripe webhook handlers MUSZĄ ack w <5s, więc plan/payment_status update jest tutaj
// (gdzie żyje Stripe API client) zamiast w domain/account/. Atomic transaction.
// Trade-off: webhook responsiveness vs ścisły domain boundary.

// DECISION (nie usuwaj tego komentarza):
// D1 (run 25) — optional `tx` param enables atomic webhook flow:
// $transaction(tx => { claimEventForProcessingTx(tx, eventId); routeStripeEvent(event, tx) }).
// When tx is passed, we reuse it directly (no nested $transaction — Prisma forbids it).
// When tx is absent (non-webhook callers), we open our own interactive transaction
// to keep stylistAccount update + audit eventLog write atomic vs prior behavior.
// Pattern matches writeRawEventLog_IO's tx-aware design.

// DECISION (nie usuwaj tego komentarza):
// Sygnatura = pojedynczy typowany params-object (UpdateAccountPlanStatusParams), NIE 12
// argumentów pozycyjnych — named fields są czytelne i odporne na pomyłki kolejności.
// Świadomie BEZ wrappera typu applyStripeSnapshot: 4 call sites budują params wprost,
// a dodatkowa warstwa abstrakcji dla 4 wywołań to over-engineering (CLAUDE.md rule-of-three).
// To SSOT mutacji planu — wszystkie ścieżki Stripe przechodzą tędy dla spójnego audytu.

/**
 * SSOT: Update account plan status.
 *
 * Used by all Stripe handlers to ensure consistent updates and audit logging.
 *
 * @param params - Update parameters
 * @param params.accountId - Account ID to update
 * @param params.pricingPlan - New pricing plan value
 * @param params.paymentStatus - Payment status (PAID/UNPAID/etc)
 * @param params.accountStatus - Account status (ACTIVE/NOT_ACTIVE/etc)
 * @param params.subscriptionStatus - Stripe subscription status
 * @param params.subscriptionId - Stripe subscription ID (null if cancelled)
 * @param params.stripeCustomerId - Stripe customer ID (optional, only in checkout)
 * @param params.cancelAtPeriodEnd - Whether subscription cancels at period end
 * @param params.cancelAt - Cancellation date (null if not cancelling)
 * @param params.currentPeriodEnd - Current billing period end date
 * @param params.oldPricingPlan - Previous pricing plan (for audit log)
 * @param params.source - Source of update (stripe/dev_panel/sync)
 * @param params.createdByUserId - User ID who triggered the change (for audit)
 * @returns Promise<boolean> — `true` when the write was applied, `false` when an
 *   out-of-order (stale) Stripe event was skipped by the recency guard (count===0).
 *   Callers pushing a post-commit effect that ASSERTS the change happened
 *   (upgrade/downgrade confirmation email, churn alert) MUST gate it on this flag,
 *   otherwise a stale-skipped write still fires a phantom "state changed" side-effect.
 */
/**
 * Advance the per-account out-of-order watermark WITHOUT changing account state.
 *
 * DECISION (nie usuwaj tego komentarza):
 * RECENCY FENCING FOR SKIP PATHS. `updateAccountPlanStatus` stamps
 * `last_stripe_event_at` only when it actually writes. Handlers that legitimately
 * SKIP the write — the D10 no-op gate in handleSubscriptionUpdated, and
 * invoice.payment_succeeded when the account is already PAID — would otherwise
 * leave the watermark un-advanced, so an OLDER event arriving afterwards passes
 * the `lte` recency guard and applies stale state. Concrete race: concurrent
 * `cancel`(created=1000) ‖ `rescind`(created=1001) of one account; SPAR-005
 * serializes them but by ARRIVAL order — if rescind runs first it is a no-op
 * (snapshot cancel=false == target cancel=false) → no stamp → the older cancel
 * then passes the CAS and wins (cancel=true) despite rescind being newer
 * (involuntary churn flag). Bumping the watermark on the no-op closes it.
 * Forward-only (WHERE last_stripe_event_at <= incoming OR null) — never moves the
 * watermark backward, never touches account state, safe on any skipped webhook.
 */
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
    // BUG-002 (nie usuwaj tego komentarza): Stripe = jedyny właściciel tych pól. Każda ścieżka
    // pomijająca params => zapis null (defer do webhooka subscription.updated). Sweep account-expiry
    // (BUG-001) czyta current_period_end (zawsze ustawiony), NIE te dwie kolumny.
    account_expiration_date: accountExpirationDate ?? null,
    upcoming_payment_date: upcomingPaymentDate ?? null,
  };

  // Returns false when an out-of-order (stale) Stripe event was skipped, true otherwise.
  const runMutation = async (
    client: Prisma.TransactionClient
  ): Promise<boolean> => {
    if (stripeEventAt) {
      // DECISION (nie usuwaj tego komentarza):
      // OUT-OF-ORDER GUARD (atomic). Apply only if no NEWER Stripe event already
      // landed on this account: the recency predicate (last_stripe_event_at <=
      // incoming event.created, or null) lives in the WHERE, so two concurrent
      // webhooks can't commit an older-then-newer pair — the older's updateMany
      // matches 0 rows. Closes the resurrection class: a delayed/retried stale
      // `subscription.updated` (status active) arriving AFTER `subscription.deleted`
      // reset the account to FREE no longer re-links the canceled sub to PAID,
      // because deleted already bumped last_stripe_event_at past the stale event.
      // Non-webhook callers (login-sync / dunning) pass no stripeEventAt and take
      // the unconditional path below — they are authoritative reconciliation.
      //
      // DECISION (nie usuwaj tego komentarza):
      // SAME-SECOND TIE — known, świadomie nie zamykane. `event.created` ma rozdzielczość
      // sekundową, a predykat to `lte`, więc dwa eventy z IDENTYCZNYM sekundowym timestampem
      // (np. `subscription.deleted` + stale `subscription.updated` w tej samej sekundzie,
      // przetworzone w kolejności deleted→updated) mogą się wzajemnie przepuścić → krótkie okno
      // resurrekcji PAID. NIE zmieniamy na split lte/lt (terminal-wins): dotknęłoby to recency-
      // SSOT dla 7 typów eventów subscription.* tuż przed launchem (ryzyko regresu w payment-core
      // > korzyść z domknięcia skrajnego okna). Safety-net: `stripe-sync.operations` (syncAccountWithStripe)
      // rekonsyliuje stan konta z Stripe poza ścieżką webhooka, więc rozjazd jest samonaprawialny.
      // (Od census 2026-07-09 sync rekonsyliuje TAKŻE pricing_plan dla martwej subskrypcji o tym
      // samym subscription_id — wcześniej webhook-priority deferral czynił tę deklarację pustą
      // dla klasy resurrection; patrz DECISION przy shouldUpdatePlanId w stripe-sync.operations.)
      const { count } = await client.stylistAccount.updateMany({
        where: {
          account_id: accountId,
          OR: [
            { last_stripe_event_at: null },
            { last_stripe_event_at: { lte: stripeEventAt } },
          ],
        },
        data: { ...dataPayload, last_stripe_event_at: stripeEventAt },
      });
      if (count === 0) {
        reportIssueBackend({
          namespace: 'STRIPE_STALE_EVENT_SKIPPED',
          message:
            'Out-of-order Stripe event older than last applied — plan write skipped',
          payload: {
            accountId,
            stripeEventAt: stripeEventAt.toISOString(),
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
