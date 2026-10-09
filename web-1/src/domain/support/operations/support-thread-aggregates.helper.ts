import { DB_CLIENT } from '@app/db/db.client';
import { Prisma } from '../../../prisma/js-client';
import { SUPPORT_UNREAD_REPLY_SQL } from './support-unread-reply.predicate';

/**
 * Podgląd ostatniej wiadomości + licznik wiadomości dla STRONY wątków supportu
 * (user-lista i admin-lista) w jednym round-tripie.
 */

// Długość preview na liście wątków (kontrakt SupportThreadListItem.last_message_preview).
// Ucinamy JUŻ W SQL — po drucie z bazy leci 100 znaków zamiast pełnego @db.Text.
export const SUPPORT_PREVIEW_MAX = 100;

// `$queryRaw<T[]>` to WYŁĄCZNIE cast compile-time — sender_type zostaje `string`
// (surowa wartość enuma z Postgresa), narrowing do SupportSenderType robią call-site'y
// przez assertType, tak samo jak przy ścieżce ORM-owej.
export type SupportThreadAggregate = {
  thread_id: string;
  last_message_preview: string | null;
  last_message_sender_type: string | null;
  message_count: number;
  /**
   * A support reply newer than the owner's read marker exists. Read by the
   * user list only; it rides in this round trip because the row is already
   * here (one EXISTS on the [thread_id, created_at] index).
   */
  has_unread_reply: boolean;
};

/**
 * DECISION (nie usuwaj tego komentarza):
 * Zagnieżdżone `messages: { orderBy, take: 1 }` + `_count: { messages: true }` w findMany
 * NIE są tym, na co wyglądają. Prisma emituje dla relacji to-many osobne zapytanie BEZ
 * LIMIT-u (samo OFFSET) i przycina `take` dopiero w Node, więc lista 100 wątków ciągnęła
 * PEŁNĄ TREŚĆ (@db.Text) każdej wiadomości każdego wątku strony tylko po to, by pokazać
 * jednolinijkowy podgląd — nic nie ogranicza liczby wiadomości w wątku. `_count` relacyjny
 * kompiluje się z kolei do NIESKORELOWANEGO GROUP BY po CAŁEJ tabeli SupportMessage (nie
 * zawęża się do id ze strony). Dlatego jawny, parametryzowany LATERAL: LIMIT 1 realnie
 * schodzi do Postgresa (index [thread_id, created_at]), a COUNT jest skorelowany z wierszem
 * rodzica. Ten sam wzorzec i ta sama rationale co messaging-query.operations.ts
 * (getConversations_IO) — trzymaj oba w zgodzie. `threadIds` pochodzą z serwera i idą jako
 * bind-parametry Prisma.join (zero interpolacji tekstowej).
 */
export const fetchSupportThreadAggregates = async (
  threadIds: readonly string[]
): Promise<Map<string, SupportThreadAggregate>> => {
  if (threadIds.length === 0) {
    return new Map();
  }

  const rows = await DB_CLIENT.use.$queryRaw<SupportThreadAggregate[]>(
    Prisma.sql`
      SELECT
        t."id" AS thread_id,
        LEFT(latest."content", ${SUPPORT_PREVIEW_MAX}) AS last_message_preview,
        latest."sender_type"::text AS last_message_sender_type,
        total."message_count" AS message_count,
        ${SUPPORT_UNREAD_REPLY_SQL} AS has_unread_reply
      FROM "SupportThread" t
      LEFT JOIN LATERAL (
        SELECT m."content", m."sender_type"
        FROM "SupportMessage" m
        WHERE m."thread_id" = t."id"
        ORDER BY m."created_at" DESC, m."id" DESC
        LIMIT 1
      ) latest ON true
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::int AS message_count
        FROM "SupportMessage" m
        WHERE m."thread_id" = t."id"
      ) total
      WHERE t."id" IN (${Prisma.join([...threadIds])})
    `
  );

  return new Map(rows.map(row => [row.thread_id, row] as const));
};
