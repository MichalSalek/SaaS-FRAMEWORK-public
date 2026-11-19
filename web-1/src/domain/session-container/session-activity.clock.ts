import type { Prisma } from '../../prisma/js-client';
import { lockConversation } from '@app/db/lock-rows';

/** Millisecond precision matches the wire cursor and PostgreSQL timestamp(3). */
export const nextConversationActivity = async (
  tx: Prisma.TransactionClient,
  pairId: string
): Promise<Date> => {
  const pair = await lockConversation(tx, pairId);
  if (!pair) {
    throw new Error('Conversation no longer available');
  }
  return new Date(
    Math.max(Date.now(), (pair.last_message_at?.getTime() ?? 0) + 1)
  );
};
