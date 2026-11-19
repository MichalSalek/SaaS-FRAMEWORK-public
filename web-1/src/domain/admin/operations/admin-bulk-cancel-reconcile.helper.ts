import type { Prisma } from '../../../prisma/js-client';
import {
  CANCEL_RECONCILE_EVENT_TYPE,
  buildCancelReconcileEventId,
} from '@app/stripe/cancel-reconcile/stripe-cancel-reconcile.resolver';

export type BulkCancelReconcileTarget = {
  userId: string;
  subscriptionId: string;
};

/** Reason stored in `last_error`, read by the operator during triage. */
const BULK_DOWNGRADE_REASON =
  'Admin bulk downgrade to FREE — subscription cancel pending (enqueued with the plan write)';

export const enqueueBulkCancelReconcileRows = async (
  tx: Prisma.TransactionClient,
  targets: readonly BulkCancelReconcileTarget[]
): Promise<void> => {
  if (targets.length === 0) {
    return;
  }

  const rows = targets.map(target => ({
    event_id: buildCancelReconcileEventId({
      subscriptionId: target.subscriptionId,
      userId: target.userId,
      flavor: 'duplicate' as const,
    }),
    event_type: CANCEL_RECONCILE_EVENT_TYPE,
    last_error: BULK_DOWNGRADE_REASON,
  }));

  await tx.stripeEvent.deleteMany({
    where: { event_id: { in: rows.map(row => row.event_id) } },
  });
  await tx.stripeEvent.createMany({ data: rows, skipDuplicates: true });
};
