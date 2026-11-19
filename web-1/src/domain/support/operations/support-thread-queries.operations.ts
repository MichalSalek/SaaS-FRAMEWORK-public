/**
 * Support Thread Query Operations — User-facing (READ-ONLY)
 *
 * - getSupportThreads_IO: Lists user's threads with last message preview
 * - getSupportThreadMessages_IO: All messages in a thread (ownership verified)
 *
 * Write operations (create thread, add message) live in support-thread.operations.ts.
 */

import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { resolveSupportThreadCursor } from './support-cursor.helper';
import { fetchSupportThreadAggregates } from './support-thread-aggregates.helper';
import type {
  SupportThreadNotFoundError,
  SupportThreadNotAuthorizedError,
} from '@kernel/domain/support/support-errors.types';
import {
  assertType,
  isSupportThreadStatusNarrower,
  isSupportSenderTypeNarrower,
} from '@kernel/models/type_narrowing';
import type {
  SupportThreadListItem,
  SupportMessageDTO,
  SupportThreadCategory,
  SupportThreadStatus,
} from '@kernel/models/support/support.dto';

// ── Get My Threads ──

type GetThreadsResult = {
  threads: SupportThreadListItem[];
  nextCursor: string | null;
};

/**
 * Get support threads for a user with cursor pagination (default 50, max 100).
 * Cursor by SupportThread.id; orderBy id desc for stable traversal.
 */
export const getSupportThreads_IO = async (
  userId: string,
  pagination?: { cursor?: string | undefined; take?: number | undefined }
): Promise<
  OperationResult<GetThreadsResult, DatabaseError | ValidationError>
> => {
  const cursor = pagination?.cursor;
  const take = pagination?.take ?? 50;
  const effectiveTake = Math.min(Math.max(take, 1), 100);

  try {
    const whereClause = { user_id: userId };

    // DECISION: the cursor goes through the shared resolveSupportThreadCursor (support-cursor.helper.ts),
    // same as the admin endpoint, so the "format gate -> existence" contract has one copy. `invalid` =>
    // VALIDATION_ERROR 400 'Invalid cursor'; `useCursor` => whether to apply the Prisma cursor spread.
    // Existence is checked in the same filter as the main query (whereClause = { user_id }), and a foreign
    // or unknown cursor is IGNORED (first page, 200): one answer for both means no enumeration of other
    // users' ids.
    const cursorState = await resolveSupportThreadCursor(cursor, whereClause);
    if (cursorState.invalid) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }

    const threads = await DB_CLIENT.use.supportThread.findMany({
      where: whereClause,
      orderBy: { id: 'desc' },
      take: effectiveTake + 1,
      ...(cursor && cursorState.useCursor
        ? { cursor: { id: cursor }, skip: 1 }
        : {}),
      // Last-message preview and count are not nested here. Prisma applies a
      // nested to-many `take` in Node, and a relational `_count` is an
      // uncorrelated GROUP BY over the whole table. One correlated LATERAL
      // follows. See support-thread-aggregates.helper.ts.
      select: {
        id: true,
        subject: true,
        category: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });

    const hasMore = threads.length > effectiveTake;
    const pageItems = hasMore ? threads.slice(0, effectiveTake) : threads;
    const nextCursor =
      hasMore && pageItems.length > 0
        ? (pageItems[pageItems.length - 1]?.id ?? null)
        : null;

    const aggregates = await fetchSupportThreadAggregates(
      pageItems.map(t => t.id)
    );

    const mapped: SupportThreadListItem[] = pageItems.map(t => {
      // Wątek skasowany między zapytaniem strony a agregatem = pusty podgląd,
      // nigdy 500 ani zgubiony wiersz listy.
      const aggregate = aggregates.get(t.id);
      const senderType = aggregate?.last_message_sender_type ?? null;
      return {
        id: t.id,
        subject: t.subject,
        category: t.category,
        status: assertType(
          t.status,
          isSupportThreadStatusNarrower,
          'SupportThread.status'
        ),
        created_at: t.created_at,
        updated_at: t.updated_at,
        last_message_preview: aggregate?.last_message_preview ?? null,
        last_message_sender_type:
          senderType !== null
            ? assertType(
                senderType,
                isSupportSenderTypeNarrower,
                'SupportMessage.sender_type'
              )
            : null,
        message_count: aggregate?.message_count ?? 0,
        // No aggregate (thread deleted between the two queries) = nothing to read.
        has_unread_reply: aggregate?.has_unread_reply ?? false,
      };
    });

    return success({ threads: mapped, nextCursor });
  } catch (error) {
    return databaseFailure('getSupportThreads', error);
  }
};

// ── Get Thread Messages ──

type GetMessagesResult = {
  messages: SupportMessageDTO[];
  thread: {
    id: string;
    subject: string;
    category: SupportThreadCategory | null;
    status: SupportThreadStatus;
  };
};

export const getSupportThreadMessages_IO = async (
  userId: string,
  threadId: string
): Promise<
  OperationResult<
    GetMessagesResult,
    SupportThreadNotFoundError | SupportThreadNotAuthorizedError | DatabaseError
  >
> => {
  try {
    // DD3-F10 (2026-05-26): cap nested messages at 200. See support-admin.operations.ts
    // for rationale — pathological thread protection, 200 covers >99% real cases.
    // DECISION: a thread over 200 messages shows the NEWEST 200 (active tail), not the oldest: fetch desc
    // with take 200, then reverse so the output stays chronological.
    const thread = await DB_CLIENT.use.supportThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        user_id: true,
        subject: true,
        category: true,
        status: true,
        messages: {
          orderBy: { created_at: 'desc' },
          take: 200,
          select: {
            id: true,
            thread_id: true,
            sender_type: true,
            content: true,
            created_at: true,
          },
        },
      },
    });

    if (!thread) {
      return failure({ type: 'SUPPORT_THREAD_NOT_FOUND', threadId });
    }

    if (thread.user_id !== userId) {
      return failure({
        type: 'SUPPORT_THREAD_NOT_AUTHORIZED',
        threadId,
        userId,
      });
    }

    // Fetched DESC (newest 200); reverse to chronological ASC for the frontend.
    return success({
      messages: thread.messages
        .slice()
        .reverse()
        .map(m => ({
          id: m.id,
          thread_id: m.thread_id,
          sender_type: assertType(
            m.sender_type,
            isSupportSenderTypeNarrower,
            'SupportMessage.sender_type'
          ),
          content: m.content,
          created_at: m.created_at,
        })),
      thread: {
        id: thread.id,
        subject: thread.subject,
        category: thread.category,
        status: assertType(
          thread.status,
          isSupportThreadStatusNarrower,
          'SupportThread.status'
        ),
      },
    });
  } catch (error) {
    return databaseFailure('getSupportThreadMessages', error);
  }
};
