import { SupportSenderTypeValue } from '@kernel/models/support/support.dto';
import { Prisma } from '../../../prisma/js-client';

/**
 * "This thread has a reply its owner has not opened yet" as a SQL condition.
 *
 * DECISION (nie usuwaj tego komentarza):
 * ONE definition, used by the badge count (SUPPORT_GET_UNREAD_COUNT) and by the
 * `has_unread_reply` flag of the thread list, so the badge can never disagree
 * with the dots in the list: a SUPPORT message newer than the owner's read
 * marker (SupportThread.user_last_read_at) exists. The status of the thread
 * does not matter: a reply followed by "resolved" is still an unread reply.
 * The condition expects the thread row under the alias `t` and compares two
 * columns of the same kind, so no JS Date crosses the driver (see the timezone
 * DECISION in admin-user-search.operations.ts). EXISTS stops at the first hit
 * on the [thread_id, created_at] index.
 */
export const SUPPORT_UNREAD_REPLY_SQL: Prisma.Sql = Prisma.sql`EXISTS (
    SELECT 1
    FROM "SupportMessage" um
    WHERE um."thread_id" = t."id"
      AND um."sender_type" = ${SupportSenderTypeValue.SUPPORT}::"SupportSenderType"
      AND um."created_at" > t."user_last_read_at"
  )`;
