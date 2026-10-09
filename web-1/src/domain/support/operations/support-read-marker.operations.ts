/**
 * Support read marker (S126): the unread-reply badge and "mark as read".
 *
 * - getSupportUnreadCount_IO: how many of the caller's threads hold a reply
 *   she has not opened yet.
 * - markSupportThreadRead_IO: stamps the caller's own thread as read now.
 */

import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { SupportThreadNotFoundError } from '@kernel/domain/support/support-errors.types';
import { Prisma } from '../../../prisma/js-client';
import { SUPPORT_UNREAD_REPLY_SQL } from './support-unread-reply.predicate';

type UnreadCountRow = { unread_threads: number };

export const buildSupportUnreadCountQuery = (userId: string): Prisma.Sql =>
  Prisma.sql`
    SELECT COUNT(*)::int AS unread_threads
    FROM "SupportThread" t
    WHERE t."user_id" = ${userId}
      AND ${SUPPORT_UNREAD_REPLY_SQL}
  `;

export const getSupportUnreadCount_IO = async (
  userId: string
): Promise<OperationResult<{ unread_threads: number }, DatabaseError>> => {
  try {
    const rows = await DB_CLIENT.use.$queryRaw<UnreadCountRow[]>(
      buildSupportUnreadCountQuery(userId)
    );
    return success({ unread_threads: rows[0]?.unread_threads ?? 0 });
  } catch (error) {
    return databaseFailure('getSupportUnreadCount', error);
  }
};

/**
 * DECISION (nie usuwaj tego komentarza):
 * ONE raw UPDATE, on purpose, for three reasons.
 *  1. Prisma `update`/`updateMany` would bump `updated_at` (@updatedAt), and
 *     that column is the admin's optimistic-concurrency token
 *     (applySupportStatusWrite, Signal 2). A user merely OPENING her thread
 *     would then reject the admin's close with 409, as if she had replied.
 *     The row lock of lockSupportThreadRow is not needed either: the marker is
 *     a column no other writer touches, so there is no lost update to protect.
 *  2. Ownership is part of the WHERE (`id` AND `user_id`), so a foreign thread
 *     and a missing one are the same "0 rows": no read-then-write window and
 *     no existence oracle. Both end as SUPPORT_THREAD_NOT_FOUND, which the
 *     error mapper answers byte-for-byte like the NOT_AUTHORIZED of
 *     getSupportThreadMessages_IO (404, see its SECURITY comment).
 *  3. `NOW() AT TIME ZONE 'UTC'`, not a JS Date parameter: the column is a
 *     timestamp without time zone kept in UTC (same rule and the same reason
 *     as fetchActiveSessionCounts in admin-user-search.operations.ts).
 */
export const buildMarkSupportThreadReadQuery = (params: {
  userId: string;
  threadId: string;
}): Prisma.Sql => Prisma.sql`
    UPDATE "SupportThread"
    SET "user_last_read_at" = (NOW() AT TIME ZONE 'UTC')
    WHERE "id" = ${params.threadId}
      AND "user_id" = ${params.userId}
  `;

export const markSupportThreadRead_IO = async (params: {
  userId: string;
  threadId: string;
}): Promise<
  OperationResult<
    { thread_id: string },
    SupportThreadNotFoundError | DatabaseError
  >
> => {
  try {
    const updated = await DB_CLIENT.use.$executeRaw(
      buildMarkSupportThreadReadQuery(params)
    );
    if (updated === 0) {
      return failure({
        type: 'SUPPORT_THREAD_NOT_FOUND',
        threadId: params.threadId,
      });
    }
    return success({ thread_id: params.threadId });
  } catch (error) {
    return databaseFailure('markSupportThreadRead', error);
  }
};
