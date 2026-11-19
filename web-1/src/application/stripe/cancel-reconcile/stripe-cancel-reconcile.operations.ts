import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getStripe } from '../adapters/stripe.adapter';
import { dispatchCriticalAlert } from '../webhooks/stripe-webhooks.utils';
import {
  CANCEL_RECONCILE_BATCH_SIZE,
  CANCEL_RECONCILE_EVENT_TYPE,
  CANCEL_RECONCILE_MAX_RETRIES,
  extractStripeErrorShape,
  isAlreadyCanceledCancelError,
  isCancelRetryDue,
  parseCancelReconcileEventId,
  truncateReconcileError,
} from './stripe-cancel-reconcile.resolver';
import {
  CANCEL_EXEMPTION_MESSAGES,
  findCancelExemption,
} from './stripe-cancel-reconcile.exemption';

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
 * Concurrency: cross-instance exclusion is the optimistic claim
 * (`UPDATE … WHERE retry_count = N`; the loser matches 0 rows and skips), as in the
 * stripe-event-janitor. No advisory lock: a double-cancel lands in the already-canceled
 * classification and resolves the row. Tests pin that classification
 * (stripe-cancel-reconcile.resolver.test.ts), not two instances racing for one claim.
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
      // DECISION: least recently ATTEMPTED first, not oldest created. Ordered by created_at, rows
      // failing their way through a long Stripe outage held every batch slot for ~31h and starved
      // newer obligations (a bulk downgrade writes up to 100 rows at once). A just-tried row moves
      // to the back.
      orderBy: { last_attempt_at: 'asc' },
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
          // DECISION: the two flavors describe DIFFERENT users to the on-call operator. A
          // 'duplicate' target is a LIVE PAYING stylist by design (only the OLD duplicate sub must
          // die), so telling the operator to hunt for a "deleted user" sends them on a wrong
          // trail. The alert copy branches, and `flavor` is carried in both the diagnostic and
          // details payloads.
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

        // Exemptions (reactivation guard, paying-owner guard) close the row
        // without touching Stripe; DECISIONs in stripe-cancel-reconcile.exemption.ts.
        const exemption = await findCancelExemption(target);
        if (exemption !== null) {
          await markReconcileResolved(candidate.event_id);
          result.succeeded += 1;
          reportIssueBackend({
            namespace: 'STRIPE_CANCEL_RECONCILE_RESOLVED',
            message: CANCEL_EXEMPTION_MESSAGES[exemption.resolution],
            payload: {
              subscriptionId: target.subscriptionId,
              userId: target.userId,
              flavor: target.flavor,
              ...exemption,
            },
            mode: 'warn',
          });
          continue;
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
