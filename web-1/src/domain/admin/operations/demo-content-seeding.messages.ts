import { DB_CLIENT } from '@app/db/db.client';
import {
  StylistClientMessageSenderValue,
  type StylistClientMessageSender,
} from '@kernel/models/db_models.generated.dto';
import {
  resolveDemoTime,
  type DemoMessageSpec,
} from './demo-content-seeding.clients-data';

export interface MessageThreadTarget {
  clientUserId: string;
  stylistAccountId: string;
  messages: readonly DemoMessageSpec[];
  /** Which side has not read the other side's latest message. `null` means both have read it. */
  unreadFor: 'CLIENT' | 'STYLIST' | null;
  /**
   * Exact sentences this thread's seed no longer uses. The match key is
   * (pair, content), so a changed sentence would insert a new message beside
   * the old one. Retired sentences are deleted from this pair before insert.
   * Text someone typed by hand on dev is left alone.
   */
  retiredContents?: readonly string[];
}

export const seedMessageThreads_IO = async ({
  targets,
  now,
  results,
}: {
  targets: readonly MessageThreadTarget[];
  now: Date;
  results: string[];
}): Promise<void> => {
  if (targets.length === 0) {
    return;
  }

  const pairs = await Promise.all(
    targets.map(t =>
      DB_CLIENT.use.clientStylistPair.findUnique({
        where: {
          client_user_id_stylist_account_id: {
            client_user_id: t.clientUserId,
            stylist_account_id: t.stylistAccountId,
          },
        },
        select: { id: true },
      })
    )
  );

  const resolvedTargets = targets
    .map((t, i) => ({ ...t, pairId: pairs[i]?.id }))
    .filter(
      (t): t is MessageThreadTarget & { pairId: string } =>
        t.pairId !== undefined
    );
  if (resolvedTargets.length === 0) {
    return;
  }

  const pairIds = resolvedTargets.map(t => t.pairId);
  for (const target of resolvedTargets) {
    if (target.retiredContents && target.retiredContents.length > 0) {
      await DB_CLIENT.use.stylistClientMessage.deleteMany({
        where: {
          pair_id: target.pairId,
          content: { in: [...target.retiredContents] },
        },
      });
    }
  }
  const existing = await DB_CLIENT.use.stylistClientMessage.findMany({
    where: { pair_id: { in: pairIds } },
    select: { pair_id: true, content: true },
  });
  const existingKeys = new Set(existing.map(m => `${m.pair_id}::${m.content}`));

  const rows: {
    pair_id: string;
    sender_type: StylistClientMessageSender;
    content: string;
    created_at: Date;
  }[] = [];

  for (const target of resolvedTargets) {
    for (const message of target.messages) {
      const key = `${target.pairId}::${message.content}`;
      if (existingKeys.has(key)) {
        continue;
      }
      rows.push({
        pair_id: target.pairId,
        sender_type:
          message.sender === 'CLIENT'
            ? StylistClientMessageSenderValue.CLIENT
            : StylistClientMessageSenderValue.STYLIST,
        content: message.content,
        created_at: resolveDemoTime(now, message.hoursAgo, message.clockUtc),
      });
    }
  }

  if (rows.length > 0) {
    await DB_CLIENT.use.stylistClientMessage.createMany({
      data: rows,
      skipDuplicates: true,
    });
    results.push(`Demo messages created (${rows.length})`);
  }

  // DECISION: last_message_at is read from the latest message actually stored, not recomputed from
  // hoursAgo + now. Messages are frozen by the content dedup (existingKeys), so a recomputed value
  // drifts after a dev restart on another day and the conversation list would show a different
  // "last message" age than the thread itself.
  const latestByPair = await DB_CLIENT.use.stylistClientMessage.findMany({
    where: { pair_id: { in: pairIds } },
    orderBy: [{ created_at: 'desc' }],
    distinct: ['pair_id'],
    select: { pair_id: true, created_at: true },
  });
  const latestAtByPairId = new Map(
    latestByPair.map(m => [m.pair_id, m.created_at])
  );

  for (const target of resolvedTargets) {
    const lastMessageAt = latestAtByPairId.get(target.pairId);
    if (!lastMessageAt) {
      continue;
    }
    // unreadFor=X sets that side's last_read_at just before the other side's
    // latest message (1s earlier: unread_count > 0 without pulling earlier
    // messages from the same side into the window).
    // With no unread, both sides are read up to `now`.
    const oneSecondBefore = new Date(lastMessageAt.getTime() - 1000);
    const stylistLastReadAt =
      target.unreadFor === 'STYLIST' ? oneSecondBefore : now;
    const clientLastReadAt =
      target.unreadFor === 'CLIENT' ? oneSecondBefore : now;
    await DB_CLIENT.use.clientStylistPair.update({
      where: { id: target.pairId },
      data: {
        last_message_at: lastMessageAt,
        stylist_last_read_at: stylistLastReadAt,
        client_last_read_at: clientLastReadAt,
      },
    });
  }
};
