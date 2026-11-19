import { DB_CLIENT } from '@app/db/db.client';
import { Prisma } from '../../../prisma/js-client';

/** Detailed observations expire; permanent sequence and send tombstones prevent replay after retention. */
export async function retainLifecycleDetails(now = new Date()) {
  const cutoff = new Date(now.getTime() - 90 * 86400000);
  return DB_CLIENT.use.$transaction(async tx => {
    const entries = await tx.emailLifecycleEntry.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    await tx.emailLifecycleAction.deleteMany({
      where: { occurredAt: { lt: cutoff } },
    });
    const deliveries = await tx.emailDeliveryEvent.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    const operations = await tx.emailLifecycleOperationalEvent.deleteMany({
      where: { occurredAt: { lt: cutoff } },
    });
    // Keep account + occurrence + rule + state even for unknown sends. Deleting that
    // identity would turn a retention run into permission to resend an ambiguous mail.
    const messages = await tx.emailLifecycleMessage.updateMany({
      where: { createdAt: { lt: cutoff }, locale: { not: 'und' } },
      data: {
        locale: 'und',
        cohort: 'retained',
        ctaIds: [],
        provider: null,
        providerMessageId: null,
        reason: null,
        deliveryStatus: null,
        deliveryAt: null,
        sweepId: null,
        // Outbox render inputs (plan name, counts) are not needed once the row is history.
        outboxPayload: Prisma.DbNull,
      },
    });
    return {
      entries: entries.count,
      deliveries: deliveries.count,
      operations: operations.count,
      messages: messages.count,
    };
  });
}
