import { DB_CLIENT } from '@app/db/db.client';
import { TIME } from '@kernel/application/constants.config';
import {
  StylistClientMessageSenderValue,
  type StylistClientMessageSender,
} from '@kernel/models/db_models.generated.dto';
import type { DemoMessageSpec } from './demo-content-seeding.clients-data';

export interface MessageThreadTarget {
  clientUserId: string;
  stylistAccountId: string;
  messages: readonly DemoMessageSpec[];
  /** Strona, która ma nieprzeczytaną ostatnią wiadomość drugiej strony. `null` = obie przeczytane. */
  unreadFor: 'CLIENT' | 'STYLIST' | null;
}

/**
 * Bulk wątki komunikatora dla wielu par naraz (Karolina×2 + 7 nowych klientek
 * z Anią). Naturalny klucz idempotencji = (pair_id, content) — patrz brief.
 * `last_message_at` / `*_last_read_at` na parze aktualizowane w małej pętli
 * (≤10 par, lekki updateMany, nie „bulk rows" w sensie AGENTS.md).
 */
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
        created_at: new Date(
          now.getTime() - message.hoursAgo * TIME.MS_PER_HOUR
        ),
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

  // DECISION (nie usuwaj tego komentarza) — S111: last_message_at CZYTANY Z
  // FAKTYCZNIE ZAPISANEJ wiadomości (nie przeliczony z hoursAgo+now), żeby po
  // restarcie dev-serwera na innym dniu (wiadomości zamrożone przez dedup po
  // content, patrz existingKeys) para nigdy nie rozjechała się z prawdziwym
  // created_at ostatniej wiadomości w wątku — inaczej lista rozmów pokazywałaby
  // inny wiek "ostatniej wiadomości" niż sam wątek.
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
    // unreadFor=X → X-owy last_read_at siedzi TUŻ PRZED ostatnią wiadomością
    // drugiej strony (1s wcześniej — wystarczy, żeby unread_count > 0 bez
    // ryzyka złapania wcześniejszych wiadomości tej samej strony w oknie).
    // Bez unreadu obie strony są "przeczytane" aż do `now`.
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
