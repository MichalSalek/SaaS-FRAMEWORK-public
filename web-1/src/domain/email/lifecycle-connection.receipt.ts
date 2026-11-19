import type { Prisma } from '../../prisma/js-client';

/** Confirmation and minimal progress are committed with the actual connection, never with a read or retry. */
export async function confirmLifecycleConnection(
  tx: Pick<
    Prisma.TransactionClient,
    'freeEmailEnrollment' | 'emailLifecycleAction'
  >,
  accountId: string,
  userId: string,
  occurredAt = new Date()
) {
  await tx.freeEmailEnrollment.updateMany({
    where: { accountId, status: 'active' },
    data: {
      status: 'finished',
      finishedAt: occurredAt,
      finishReason: 'completed',
    },
  });
  return tx.emailLifecycleAction.create({
    data: { accountId, userId, kind: 'connection_accepted', occurredAt },
    select: { id: true, occurredAt: true },
  });
}
