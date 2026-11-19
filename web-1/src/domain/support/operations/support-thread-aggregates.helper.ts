import { DB_CLIENT } from '@app/db/db.client';
import { Prisma } from '../../../prisma/js-client';
import { SUPPORT_UNREAD_REPLY_SQL } from './support-unread-reply.predicate';

/**
 * Last-message preview and message count for one page of support threads
 * (user list and admin list), in one round trip.
 */

// Preview length for SupportThreadListItem.last_message_preview.
// Truncate in SQL so the wire carries 100 characters, not the full text column.
export const SUPPORT_PREVIEW_MAX = 100;

// `$queryRaw<T[]>` is only a compile-time cast: sender_type stays `string`
// (the raw Postgres enum). Call sites narrow it with assertType, as on the ORM path.
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
 * DECISION: nested `messages: { orderBy, take: 1 }` + `_count: { messages: true }` in findMany are not
 * what they look like. For a to-many relation Prisma runs a separate query WITHOUT LIMIT and applies
 * `take` in Node, so a list of 100 threads pulled the full @db.Text of every message just for a one-line
 * preview; the relational `_count` compiles to an uncorrelated GROUP BY over the whole SupportMessage
 * table. Hence an explicit parameterized LATERAL: LIMIT 1 reaches Postgres (index [thread_id,
 * created_at]) and COUNT is correlated to the parent row. Same pattern as messaging-query.operations.ts
 * (getConversations_IO); keep both aligned. `threadIds` are server-issued and go as Prisma.join bind
 * parameters.
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
