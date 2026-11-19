import { DB_CLIENT } from '@app/db/db.client';
const STALE_AFTER_MS = 20 * 60 * 1000;

/**
 * A crashed provider attempt is held for reconciliation and is never retried. Outbox rows are
 * excluded: their intent waits for the email-outbox job (a `reserved` outbox row is a pending
 * send, not an expired reservation) and that job reconciles their interrupted sends itself.
 */
export const reconcileStaleLifecycleMessages_IO = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);
  const candidates = await DB_CLIENT.use.emailLifecycleMessage.findMany({
    where: {
      outbox: false,
      OR: [
        { status: 'reserved', createdAt: { lte: cutoff } },
        { status: 'sending', startedAt: { lte: cutoff } },
        { status: 'sending', startedAt: null, createdAt: { lte: cutoff } },
      ],
    },
    select: { id: true, status: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 200,
  });
  let unknown = 0;
  let suppressed = 0;
  for (const candidate of candidates) {
    const next = candidate.status === 'sending' ? 'unknown' : 'suppressed';
    const reason =
      next === 'unknown' ? 'send_interrupted' : 'reservation_expired';
    const changed = await DB_CLIENT.use.$transaction(async tx => {
      const claimed = await tx.emailLifecycleMessage.updateMany({
        where: { id: candidate.id, status: candidate.status, outbox: false },
        data: { status: next, reason },
      });
      if (!claimed.count) {
        return false;
      }
      const message = await tx.emailLifecycleMessage.findUniqueOrThrow({
        where: { id: candidate.id },
      });
      await tx.emailLifecycleOperationalEvent.create({
        data: {
          messageId: message.id,
          kind: 'send_result',
          state: next,
          reason,
          occurredAt: now,
          dimensions: {
            family: message.family,
            templateId: message.templateId,
            ruleId: message.ruleId,
            locale: message.locale,
            cohort: message.cohort,
            transport: message.provider,
          },
        },
      });
      return true;
    });
    if (changed && next === 'unknown') {
      unknown += 1;
    } else if (changed) {
      suppressed += 1;
    }
  }
  return { unknown, suppressed };
};
