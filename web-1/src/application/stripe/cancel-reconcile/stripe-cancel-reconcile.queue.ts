/**
 * STRIPE SUBSCRIPTION-CANCEL RECONCILE — queue writers (IO).
 *
 * Every way a cancel obligation enters or leaves the reconcile queue, apart from the
 * executor itself (stripe-cancel-reconcile.operations.ts): enqueue after a failed
 * cancel (never throws), write-ahead inside the caller's transaction (throws), and
 * close after a successful cancel (never throws). Storage and key format: DECISION
 * in stripe-cancel-reconcile.resolver.ts.
 */

import type { Prisma } from '../../../prisma/js-client';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  CANCEL_RECONCILE_EVENT_TYPE,
  type CancelReconcileFlavor,
  buildCancelReconcileEventId,
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
 * DECISION: written BEFORE the cancel is attempted, not after it fails. The post-commit effect
 * still cancels at once; the row only matters when the process dies first (SIGTERM on every
 * Render redeploy). The sweep's backoff counts from last_attempt_at = now, so it looks at the row
 * an hour later and closes it on Stripe's "already canceled" answer when the effect
 * got there first (admin bulk downgrade uses the same shape).
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

/**
 * Close a pending reconcile row because the cancel it guards just succeeded (or
 * Stripe answered "already canceled"). Never throws: a failure only means the
 * sweep closes the row itself an hour later on Stripe's "already canceled".
 *
 * DECISION: write-ahead rows (checkout outbox, admin downgrade) exist BEFORE the cancel is
 * attempted. Without this step every successful cancel would cost the sweep one more
 * `subscriptions.cancel` call to discover the work is done. Only `processed: false` rows are
 * touched, so a dead-lettered row keeps its operator trail.
 */
export const resolveSubscriptionCancelReconcile = async ({
  subscriptionId,
  userId,
  flavor,
}: {
  subscriptionId: string;
  userId: string;
  flavor: CancelReconcileFlavor;
}): Promise<void> => {
  const eventId = buildCancelReconcileEventId({
    subscriptionId,
    userId,
    flavor,
  });
  try {
    await DB_CLIENT.use.stripeEvent.updateMany({
      where: { event_id: eventId, processed: false },
      data: { processed: true, processed_at: new Date(), last_error: null },
    });
  } catch (error) {
    reportIssueBackend({
      namespace: 'STRIPE_CANCEL_RECONCILE_RESOLVE_FAILED',
      message:
        'Could not close the reconcile row after a successful cancel — the sweep will close it on its next pass',
      payload: { subscriptionId, userId, flavor, error },
      mode: 'warn',
    });
  }
};
