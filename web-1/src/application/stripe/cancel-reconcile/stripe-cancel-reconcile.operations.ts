/**
 * STRIPE SUBSCRIPTION-CANCEL RECONCILE — dead-letter queue + retry sweep (IO).
 *
 * PROBLEM: `cancelStripeSubscriptionIfExists` is best-effort BY CONTRACT — account
 * deletion (GDPR/self/admin/90d-MOVE) MUST proceed even when Stripe is down. Until
 * now a final cancel failure only produced an operator alert; if the alert was
 * missed, the orphaned subscription kept billing a user whose account no longer
 * exists. This module adds the safety net WITHOUT changing the trade-off: the
 * deletion still never blocks — the failed cancel is recorded as a dead-letter
 * entry and retried automatically in the background.
 *
 * Pattern mirror: stripe-event-janitor (optimistic claim via
 * `UPDATE … WHERE retry_count = N`, bounded retries, dead-letter + critical alert
 * on exhaustion). Storage & key format: see the DECISION in
 * stripe-cancel-reconcile.resolver.ts (synthetic StripeEvent rows, no new schema).
 *
 * DECISION (nie usuwaj tego komentarza):
 * The reconcile targets the SPECIFIC subscription id whose cancel was requested at
 * deletion time (encoded in event_id) — it can never cancel a newer subscription
 * the user might create later (a re-subscribe mints a new sub id). It is enqueued
 * from INSIDE cancelStripeSubscriptionIfExists' final-failure branch, so every
 * caller (self-GDPR, confirm-delete, admin delete/ban, 90d MOVE) gets the net for
 * free. The "unexpected error" catch branch does NOT enqueue — there we may not
 * even know whether a subscription exists (the DB lookup itself may have failed),
 * so the existing critical alert remains the only channel for that edge.
 */

import type { Prisma } from '../../../prisma/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getStripe } from '../adapters/stripe.adapter';
import { dispatchCriticalAlert } from '../webhooks/stripe-webhooks.utils';
import {
  CANCEL_RECONCILE_BATCH_SIZE,
  CANCEL_RECONCILE_EVENT_TYPE,
  CANCEL_RECONCILE_MAX_RETRIES,
  type CancelReconcileFlavor,
  buildCancelReconcileEventId,
  extractStripeErrorShape,
  isAlreadyCanceledCancelError,
  isCancelRetryDue,
  parseCancelReconcileEventId,
  truncateReconcileError,
} from './stripe-cancel-reconcile.resolver';

/** Create-or-re-arm shape shared by both enqueue paths (fresh retry budget). */
const reconcileRowUpsert = (eventId: string, storedReason: string) => {
  const now = new Date();
  return {
    where: { event_id: eventId },
    create: {
      event_id: eventId,
      event_type: CANCEL_RECONCILE_EVENT_TYPE,
      last_attempt_at: now,
      last_error: storedReason,
    },
    update: {
      processed: false,
      processed_at: null,
      dead_lettered: false,
      retry_count: 0,
      last_attempt_at: now,
      last_error: storedReason,
    },
  };
};

/**
 * Record a failed subscription cancel as a dead-letter entry for the reconcile
 * sweep. Never throws (deletion flows rely on best-effort semantics all the way
 * down) — an enqueue failure is logged; the operator still has the critical
 * alert dispatched by the caller.
 *
 * Idempotent + re-arming: event_id is unique per (subscription, user, flavor), so
 * a repeat failure for the same subscription resets the existing row back to
 * pending (fresh retry budget) instead of duplicating it. Re-arming a previously
 * processed/dead-lettered row is intentional — a NEW failed cancel for the same
 * sub id is fresh evidence that it is still active in Stripe.
 *
 * `flavor` (default 'deletion') selects how the sweep treats a still-live target
 * user: 'deletion' keeps the reactivation guard (never cancel a recovered user's
 * sub), 'duplicate' bypasses it (duplicate-checkout OLD sub must die even for a
 * live paying stylist). See CancelReconcileFlavor in the resolver.
 */
export const enqueueSubscriptionCancelReconcile = async ({
  subscriptionId,
  userId,
  reason,
  flavor = 'deletion',
}: {
  subscriptionId: string;
  userId: string;
  reason: string;
  flavor?: CancelReconcileFlavor;
}): Promise<void> => {
  const eventId = buildCancelReconcileEventId({
    subscriptionId,
    userId,
    flavor,
  });
  const storedReason = truncateReconcileError(reason);
  try {
    await DB_CLIENT.use.stripeEvent.upsert(
      reconcileRowUpsert(eventId, storedReason)
    );
    reportIssueBackend({
      namespace: 'STRIPE_CANCEL_RECONCILE_ENQUEUED',
      message:
        'Failed subscription cancel recorded for background reconcile retries',
      payload: { subscriptionId, userId, flavor, reason: storedReason },
      mode: 'warn',
    });
  } catch (error) {
    reportIssueBackend({
      namespace: 'STRIPE_CANCEL_RECONCILE_ENQUEUE_FAILED',
      message:
        'Could not record failed subscription cancel for reconcile — operator alert is the only remaining channel',
      payload: { subscriptionId, userId, error },
      mode: 'error',
    });
  }
};

/**
 * Outbox variant: record the cancel obligation INSIDE the caller's transaction, so
 * the commit that makes a subscription redundant also records that it has to die.
 * Unlike enqueueSubscriptionCancelReconcile this THROWS: a commit without the row
 * is exactly the gap this exists to close.
 *
 * DECISION (nie usuwaj tego komentarza): written BEFORE the cancel is attempted,
 * not after it fails. The post-commit effect still cancels at once; the row only
 * matters when the process dies first (SIGTERM on every Render redeploy). The
 * sweep's backoff counts from last_attempt_at = now, so it looks at the row an
 * hour later and closes it idempotently on Stripe's "already canceled" answer
 * when the effect got there first (admin bulk downgrade uses the same shape).
 */
export const enqueueSubscriptionCancelReconcileTx = async (
  tx: Prisma.TransactionClient,
  {
    subscriptionId,
    userId,
    reason,
    flavor,
  }: {
    subscriptionId: string;
    userId: string;
    reason: string;
    flavor: CancelReconcileFlavor;
  }
): Promise<void> => {
  const eventId = buildCancelReconcileEventId({
    subscriptionId,
    userId,
    flavor,
  });
  await tx.stripeEvent.upsert(
    reconcileRowUpsert(eventId, truncateReconcileError(reason))
  );
};

export type CancelReconcileSweepResult = {
  scanned: number;
  eligible: number;
  retried: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
};

/** Mark a reconcile row resolved (subscription no longer active in Stripe). */
const markReconcileResolved = async (eventId: string): Promise<void> => {
  await DB_CLIENT.use.stripeEvent.update({
    where: { event_id: eventId },
    data: { processed: true, processed_at: new Date(), last_error: null },
  });
};

/**
 * Retry pending subscription cancels (dead-letter reconcile sweep).
 *
 * Concurrency: cross-instance safety = the optimistic claim
 * (`UPDATE … WHERE retry_count = N` — loser matches 0 rows and skips), same
 * guarantee the stripe-event-janitor relies on. No advisory lock needed:
 * `subscriptions.cancel` is idempotent for our purposes (a double-cancel lands
 * in the already-canceled classification → resolved).
 */
export const sweepPendingSubscriptionCancels =
  async (): Promise<CancelReconcileSweepResult> => {
    const now = new Date();

    const candidates = await DB_CLIENT.use.stripeEvent.findMany({
      where: {
        event_type: CANCEL_RECONCILE_EVENT_TYPE,
        processed: false,
        dead_lettered: false,
      },
      orderBy: { created_at: 'asc' },
      take: CANCEL_RECONCILE_BATCH_SIZE,
      select: {
        event_id: true,
        retry_count: true,
        last_attempt_at: true,
      },
    });

    const result: CancelReconcileSweepResult = {
      scanned: candidates.length,
      eligible: 0,
      retried: 0,
      succeeded: 0,
      failed: 0,
      deadLettered: 0,
    };

    for (const candidate of candidates) {
      // Per-candidate guard (janitor parity): a transient DB error on one row must
      // not abort the whole sweep — the next sweep re-selects it (self-healing).
      try {
        // Exponential-backoff gate BEFORE the claim so a not-yet-due row does not
        // burn a retry_count increment.
        if (
          !isCancelRetryDue({
            retryCount: candidate.retry_count,
            lastAttemptAt: candidate.last_attempt_at,
            now,
          })
        ) {
          continue;
        }
        result.eligible += 1;

        const target = parseCancelReconcileEventId(candidate.event_id);
        if (!target) {
          // Defensive: unparseable key (should be impossible — enqueue builds it).
          // Dead-letter immediately so the malformed row stops being swept.
          await DB_CLIENT.use.stripeEvent.update({
            where: { event_id: candidate.event_id },
            data: {
              dead_lettered: true,
              last_error: 'MALFORMED_CANCEL_RECONCILE_EVENT_ID',
            },
          });
          result.deadLettered += 1;
          reportIssueBackend({
            namespace: 'STRIPE_CANCEL_RECONCILE_MALFORMED',
            message:
              'Malformed cancel-reconcile event_id — dead-lettered without retry',
            payload: { eventId: candidate.event_id },
            mode: 'error',
          });
          continue;
        }

        // Optimistic claim: bump retry_count atomically. If another instance
        // already bumped this row, our update matches zero rows → skip.
        const claimed = await DB_CLIENT.use.stripeEvent.updateMany({
          where: {
            event_id: candidate.event_id,
            retry_count: candidate.retry_count,
            processed: false,
            dead_lettered: false,
          },
          data: {
            retry_count: candidate.retry_count + 1,
            last_attempt_at: new Date(),
          },
        });
        if (claimed.count === 0) {
          continue;
        }
        result.retried += 1;

        // Dead-letter check AFTER the bump (janitor parity): retry_count then
        // reads "we tried N times and gave up".
        const nextRetryCount = candidate.retry_count + 1;
        if (nextRetryCount > CANCEL_RECONCILE_MAX_RETRIES) {
          await DB_CLIENT.use.stripeEvent.update({
            where: { event_id: candidate.event_id },
            data: {
              dead_lettered: true,
              last_error: `MAX_RETRIES_EXCEEDED (retry_count=${nextRetryCount}, limit=${CANCEL_RECONCILE_MAX_RETRIES})`,
            },
          });
          result.deadLettered += 1;
          reportIssueBackend({
            namespace: 'STRIPE_CANCEL_RECONCILE_DEAD_LETTER',
            message:
              'Subscription cancel reconcile exceeded max retries — dead-lettered',
            payload: {
              subscriptionId: target.subscriptionId,
              userId: target.userId,
              flavor: target.flavor,
              retryCount: nextRetryCount,
            },
            mode: 'error',
          });
          // Final "gave up" alert — the subscription survived the hot-path cancel
          // AND ~31h of background retries; only a manual Stripe Dashboard cancel
          // remains. Sweep runs outside any $transaction → fire-and-forget dispatch
          // is the correct channel (janitor parity).
          // DECISION (nie usuwaj tego komentarza):
          // The two flavors describe DIFFERENT users to the on-call operator. A
          // 'duplicate' target is a LIVE PAYING stylist by design (only the OLD
          // duplicate sub must die) — telling the operator to hunt for a "deleted
          // user" that still exists sends them on a wrong trail. Branch the copy so
          // the alert names the real situation, and carry `flavor` in both the
          // diagnostic and details payloads (parity with the dead-letter log above).
          const isDuplicateFlavor = target.flavor === 'duplicate';
          const alertTitle = isDuplicateFlavor
            ? 'Stripe Duplicate-Subscription Cancel Reconcile Exhausted — Manual Cancel Required'
            : 'Stripe Subscription Cancel Reconcile Exhausted — Manual Cancel Required';
          const alertUserClause = isDuplicateFlavor
            ? `duplicate OLD subscription of live user ${target.userId}`
            : `deleted user ${target.userId}`;
          const alertMessage =
            `Subscription ${target.subscriptionId} (${alertUserClause}) could not be cancelled by the ` +
            `background reconcile sweep after ${CANCEL_RECONCILE_MAX_RETRIES} attempts. It may still be actively ` +
            'billing. Cancel it manually in the Stripe Dashboard immediately.';
          dispatchCriticalAlert({
            context: 'STRIPE_CANCEL_RECONCILE_DEAD_LETTER',
            diagnostic: {
              subscriptionId: target.subscriptionId,
              userId: target.userId,
              flavor: target.flavor,
            },
            alert: {
              alertTitle,
              alertMessage,
              details: {
                subscriptionId: target.subscriptionId,
                userId: target.userId,
                flavor: target.flavor,
                retryCount: nextRetryCount,
                maxRetries: CANCEL_RECONCILE_MAX_RETRIES,
                timestamp: new Date().toISOString(),
              },
            },
          });
          continue;
        }

        // DECISION (nie usuwaj tego komentarza):
        // REACTIVATION GUARD — DELETION FLAVOR ONLY. Two reconcile flavors share this
        // sweep (see CancelReconcileFlavor in the resolver):
        //   • 'deletion'  — the cancel was requested because the account was being
        //     deleted. Model A soft-delete is RECOVERABLE: the user can self-reactivate
        //     within the recovery window while this row is still pending (the hot-path
        //     cancel failed, so their subscription is genuinely alive in Stripe).
        //     Cancelling now would silently cut off a reactivated, paying user hours
        //     after they undid the deletion. A live user + live subscription is a
        //     perfectly consistent state, so the pending cancel is MOOT — resolve the
        //     row without touching Stripe. (Users whose hot-path cancel SUCCEEDED end
        //     up unsubscribed after recovery either way — Stripe cannot resurrect a
        //     cancelled sub. The asymmetry is deliberate: never destroy a recovered
        //     user's active billing relationship.)
        //   • 'duplicate' — the cancel targets the OLD subscription of a DUPLICATE
        //     checkout. Here the user is a LIVE PAYING stylist BY DESIGN (the NEW sub
        //     is what the DB reflects) and the OLD sub genuinely double-bills. The
        //     guard's "live user ⇒ keep the sub" logic is exactly WRONG here, so we
        //     BYPASS it and always proceed to cancel. Idempotency / backoff / dead-
        //     letter exhaustion semantics below are identical for both flavors.
        if (target.flavor === 'deletion') {
          const targetUser = await DB_CLIENT.use.user.findUnique({
            where: { id: target.userId },
            select: { is_active: true, deleted_at: true },
          });
          if (
            targetUser !== null &&
            targetUser.is_active &&
            targetUser.deleted_at === null
          ) {
            await markReconcileResolved(candidate.event_id);
            result.succeeded += 1;
            reportIssueBackend({
              namespace: 'STRIPE_CANCEL_RECONCILE_RESOLVED',
              message:
                'Reconcile resolved without cancel — user reactivated their account while the retry was pending',
              payload: {
                subscriptionId: target.subscriptionId,
                userId: target.userId,
                flavor: target.flavor,
                resolution: 'user_reactivated',
              },
              mode: 'warn',
            });
            continue;
          }
        }

        try {
          await getStripe().subscriptions.cancel(target.subscriptionId);
          await markReconcileResolved(candidate.event_id);
          result.succeeded += 1;
          reportIssueBackend({
            namespace: 'STRIPE_CANCEL_RECONCILE_RESOLVED',
            message:
              'Reconcile sweep cancelled a subscription that survived account deletion',
            payload: {
              subscriptionId: target.subscriptionId,
              userId: target.userId,
              flavor: target.flavor,
              finalRetryCount: nextRetryCount,
            },
            mode: 'info',
          });
        } catch (error) {
          const shape = extractStripeErrorShape(error);
          if (isAlreadyCanceledCancelError(shape)) {
            // Desired end-state already met (cancelled elsewhere / resource gone).
            await markReconcileResolved(candidate.event_id);
            result.succeeded += 1;
            reportIssueBackend({
              namespace: 'STRIPE_CANCEL_RECONCILE_RESOLVED',
              message:
                'Subscription already canceled — reconcile entry resolved idempotently',
              payload: {
                subscriptionId: target.subscriptionId,
                userId: target.userId,
                lastErrorCode: shape.code,
                lastErrorStatus: shape.status,
              },
              mode: 'info',
            });
            continue;
          }
          result.failed += 1;
          const message = truncateReconcileError(
            shape.message ?? 'Unknown Stripe error'
          );
          try {
            await DB_CLIENT.use.stripeEvent.update({
              where: { event_id: candidate.event_id },
              data: { last_error: message },
            });
          } catch (writeError) {
            reportIssueBackend({
              namespace: 'STRIPE_CANCEL_RECONCILE_FAILURE_WRITE_ERROR',
              message: 'Failed to record reconcile retry failure',
              payload: { eventId: candidate.event_id, writeError },
              mode: 'error',
            });
          }
          reportIssueBackend({
            namespace: 'STRIPE_CANCEL_RECONCILE_RETRY_FAILED',
            message: 'Reconcile cancel attempt failed',
            payload: {
              subscriptionId: target.subscriptionId,
              userId: target.userId,
              retryCount: nextRetryCount,
              error: message,
            },
            mode: 'error',
          });
        }
      } catch (candidateError) {
        result.failed += 1;
        reportIssueBackend({
          namespace: 'STRIPE_CANCEL_RECONCILE_CANDIDATE_ERROR',
          message:
            'Reconcile candidate threw outside the processing guard — skipped (self-healing next sweep)',
          payload: { eventId: candidate.event_id, candidateError },
          mode: 'error',
        });
      }
    }

    return result;
  };
