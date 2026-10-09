import {
  SUPPORT_CATEGORY_FILTER_NONE,
  SupportSenderTypeValue,
  SupportThreadStatusValue,
} from '@kernel/models/support/support.dto';
import type { SupportThreadCategoryFilter } from '@kernel/models/support/support.dto';
import { Prisma } from '../../../prisma/js-client';

/**
 * "This thread waits for an answer from support" as a SQL condition.
 *
 * DECISION (nie usuwaj tego komentarza):
 * ONE definition, used by the admin menu badge (`support_awaiting_reply` in
 * admin-attention.operations.ts) and by the admin list filter
 * (`awaiting_reply: true` in adminGetAllThreads_IO), so the number in the menu
 * is the number of rows the link shows: the thread is OPEN and its LATEST
 * message (created_at DESC, id DESC) comes from the USER. OPEN alone is not
 * enough: a thread the admin answered waits for the user, not for support.
 * A thread with no message at all drops out (the scalar subquery yields NULL).
 * The condition expects the thread row under the alias `t`. Only the sender of
 * the newest message is read, on the [thread_id, created_at] index; no message
 * body leaves the database (the reason the count moved to SQL in the first
 * place, see the DECISION in admin-attention.operations.ts).
 */
export const SUPPORT_AWAITING_REPLY_SQL: Prisma.Sql = Prisma.sql`t."status" = ${SupportThreadStatusValue.OPEN}::"SupportThreadStatus"
    AND (
      SELECT m."sender_type"
      FROM "SupportMessage" m
      WHERE m."thread_id" = t."id"
      ORDER BY m."created_at" DESC, m."id" DESC
      LIMIT 1
    ) = ${SupportSenderTypeValue.USER}::"SupportSenderType"`;

/** The badge: a plain COUNT over the predicate, no scan cap. */
export const buildSupportAwaitingReplyCountQuery = (): Prisma.Sql =>
  Prisma.sql`
    SELECT COUNT(*)::int AS awaiting_reply
    FROM "SupportThread" t
    WHERE ${SUPPORT_AWAITING_REPLY_SQL}
  `;

const categoryCondition = (
  category: SupportThreadCategoryFilter | undefined
): Prisma.Sql => {
  if (category === undefined) {
    return Prisma.empty;
  }
  return category === SUPPORT_CATEGORY_FILTER_NONE
    ? Prisma.sql`AND t."category" IS NULL`
    : Prisma.sql`AND t."category" = ${category}::"SupportThreadCategory"`;
};

/**
 * One page of thread ids for the list behind the badge, newest first.
 *
 * Keyset pagination (`id < cursor`), not an offset and not a Prisma cursor:
 * a thread leaves this set the moment support answers it, and a keyset does
 * not need the cursor row to still be in the set (or to exist at all).
 * `limit` is the page size plus one, the caller's "is there more" probe.
 */
export const buildSupportAwaitingReplyPageQuery = (params: {
  cursor: string | undefined;
  category: SupportThreadCategoryFilter | undefined;
  limit: number;
}): Prisma.Sql => Prisma.sql`
    SELECT t."id"
    FROM "SupportThread" t
    WHERE ${SUPPORT_AWAITING_REPLY_SQL}
      ${categoryCondition(params.category)}
      ${params.cursor === undefined ? Prisma.empty : Prisma.sql`AND t."id" < ${params.cursor}`}
    ORDER BY t."id" DESC
    LIMIT ${params.limit}
  `;
