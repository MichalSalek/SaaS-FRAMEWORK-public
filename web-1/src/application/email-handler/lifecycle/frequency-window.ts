import { type Prisma } from '../../../prisma/js-client';
import { COUNTED_EMAIL_EVENTS } from './email-frequency.guard';
import { lifecycleMessageIdFromAudit } from './ledger-payload';

const DAY = 86_400_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** A bounded, complete-or-unknown view of the two-message weekly policy. */
export async function readLifecycleFrequency(
  db: Pick<Prisma.TransactionClient, 'emailLifecycleMessage' | 'eventLog'>,
  userId: string,
  now: Date
): Promise<
  'weekly_limit' | 'minimum_spacing' | 'frequency_unavailable' | null
> {
  const since = new Date(now.getTime() - 7 * DAY);
  const messages = await db.emailLifecycleMessage.findMany({
    // orderby-exempt: any two rows prove the weekly limit; fewer rows are the complete matching set.
    where: {
      userId,
      nonTransactional: true,
      createdAt: { gte: since },
      status: { in: ['reserved', 'sending', 'accepted', 'unknown'] },
    },
    select: { id: true, createdAt: true },
    take: 2,
  });
  if (messages.length >= 2) {
    return 'weekly_limit';
  }
  const ids = new Set(messages.map(row => row.id));
  let total = messages.length;
  let recent = messages.some(
    row => now.getTime() - row.createdAt.getTime() < 2 * DAY
  );
  let lastId: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const events = await db.eventLog.findMany({
      where: {
        created_by_user_id: userId,
        event: { in: [...COUNTED_EMAIL_EVENTS] },
        created_at: { gte: since },
        ...(lastId ? { event_log_id: { gt: lastId } } : {}),
      },
      select: { event_log_id: true, event_payload: true, created_at: true },
      orderBy: { event_log_id: 'asc' },
      take: PAGE_SIZE,
    });
    for (const event of events) {
      if (ids.has(lifecycleMessageIdFromAudit(event.event_payload) ?? '')) {
        continue;
      }
      total++;
      if (total >= 2) {
        return 'weekly_limit';
      }
      recent ||= now.getTime() - event.created_at.getTime() < 2 * DAY;
    }
    if (events.length < PAGE_SIZE) {
      return recent ? 'minimum_spacing' : null;
    }
    lastId = events.at(-1)?.event_log_id;
    if (!lastId) {
      return 'frequency_unavailable';
    }
  }
  return 'frequency_unavailable';
}
