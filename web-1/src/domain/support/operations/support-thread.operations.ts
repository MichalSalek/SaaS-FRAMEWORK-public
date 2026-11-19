/**
 * Support Thread Operations — User-facing (WRITE)
 *
 * - createSupportThread_IO: Creates thread + first message + admin alert
 * - addSupportMessage_IO: Adds message to existing thread
 *
 * Read operations (list threads, list messages) live in
 * support-thread-queries.operations.ts.
 */

import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { TIME } from '@kernel/application/constants.config';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type {
  DatabaseError,
  SerializationConflictError,
} from '@kernel/application/common-errors.types';
import type {
  SupportThreadNotFoundError,
  SupportThreadNotAuthorizedError,
  SupportThreadClosedError,
  SupportRateLimitedError,
} from '@kernel/domain/support/support-errors.types';
import {
  SupportSenderTypeValue,
  SupportThreadStatusValue,
} from '@kernel/models/support/support.dto';
import type { SupportThreadCategory } from '@kernel/models/support/support.dto';
import { deriveSupportSubject } from '@domain/support/support-subject.resolver';
import { lockUserRow } from '@app/db/lock-rows';
import { lockSupportThreadRow } from './support-thread-lock.helper';

// DECISION: per-user hourly quotas on thread creation and USER messages. Every create/add-message
// schedules an unconditional fire-and-forget admin-alert e-mail, so without a limit one authed user could
// flood the queue and the inbox. Same count-in-window pattern as moderation-report.operation.ts. Limits
// are local to web-1 (a kernel SSOT is the intended home). Threads are stricter than messages: a new
// thread means a new alert and queue inflation.
const SUPPORT_THREAD_RATE_LIMIT = 5; // threads per hour per user
const SUPPORT_MESSAGE_RATE_LIMIT = 30; // USER messages per hour per user
const RATE_LIMIT_WINDOW_MS = TIME.MS_PER_HOUR;

// ── Create Thread ──

type CreateThreadParams = {
  userId: string;
  category: SupportThreadCategory;
  firstMessage: string;
};

type CreateThreadResult = {
  thread_id: string;
  /** Title derived from the first message; the admin alert mail needs it. */
  subject: string;
};

export const createSupportThread_IO = async (
  params: CreateThreadParams
): Promise<
  OperationResult<
    CreateThreadResult,
    DatabaseError | SerializationConflictError | SupportRateLimitedError
  >
> => {
  const { userId, category, firstMessage } = params;
  // The request carries no subject (see deriveSupportSubject).
  const subject = deriveSupportSubject(firstMessage);

  try {
    // DECISION: count + create run in a SERIALIZABLE transaction. Under READ COMMITTED, N parallel creates
    // at count=4 all see 4 < 5 and commit (measured: 25 parallel = 25x201). Under Serializable the count
    // is a serialization point (SIReadLock), the concurrent inserts form an rw-antidependency and
    // Postgres aborts the losers with 40001, so never more than SUPPORT_THREAD_RATE_LIMIT commit. Same as
    // moderation-report.operation.ts.
    return await DB_CLIENT.use.$transaction(
      async tx => {
        const oneHourAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
        const recentThreadCount = await tx.supportThread.count({
          where: { user_id: userId, created_at: { gte: oneHourAgo } },
        });

        if (recentThreadCount >= SUPPORT_THREAD_RATE_LIMIT) {
          reportIssueBackend({
            namespace: 'SUPPORT_RATE_LIMITED',
            message: `User ${userId} exceeded support thread rate limit: ${recentThreadCount}/${SUPPORT_THREAD_RATE_LIMIT} in last hour`,
            payload: { userId, currentCount: recentThreadCount },
            mode: 'info',
          });
          return failure({
            type: 'SUPPORT_RATE_LIMITED' as const,
            currentCount: recentThreadCount,
            limit: SUPPORT_THREAD_RATE_LIMIT,
          });
        }

        const thread = await tx.supportThread.create({
          data: {
            user_id: userId,
            subject,
            category,
            messages: {
              create: {
                sender_type: SupportSenderTypeValue.USER,
                content: firstMessage,
              },
            },
          },
          select: { id: true },
        });

        reportIssueBackend({
          namespace: 'SUPPORT_THREAD_CREATED',
          message: `Support thread created: ${thread.id} by user ${userId}`,
          payload: { threadId: thread.id, category },
          mode: 'info',
        });

        return success({ thread_id: thread.id, subject });
      },
      { isolationLevel: 'Serializable' }
    );
  } catch (error) {
    // 40001: a concurrent create lost the Serializable rate-limit race. The transaction
    // rolled back, so the thread was not inserted and the limit still holds. Retryable
    // 409 via isSerializationConflict, not P2034 alone: under adapter-pg, 40001 is a
    // DriverAdapterError with no .code. Same pattern as moderation-report.
    if (isSerializationConflict(error)) {
      reportIssueBackend({
        namespace: 'SUPPORT_RATE_LIMITED',
        message: `Support create-thread serialization conflict for user ${userId} — rolled back (retryable 409). Limit: ${SUPPORT_THREAD_RATE_LIMIT}`,
        payload: { userId, limit: SUPPORT_THREAD_RATE_LIMIT },
        mode: 'info',
      });
      return failure({ type: 'SERIALIZATION_CONFLICT' });
    }
    return databaseFailure('createSupportThread', error);
  }
};

// ── Add Message ──

type AddMessageParams = {
  userId: string;
  threadId: string;
  content: string;
};

type AddMessageResult = {
  message_id: string;
  subject: string;
};

export const addSupportMessage_IO = async (
  params: AddMessageParams
): Promise<
  OperationResult<
    AddMessageResult,
    | SupportThreadNotFoundError
    | SupportThreadNotAuthorizedError
    | SupportThreadClosedError
    | SupportRateLimitedError
    | DatabaseError
  >
> => {
  const { userId, threadId, content } = params;

  try {
    // Wrap ownership check + message insert + status update in one transaction
    // so concurrent requests cannot observe partial state (e.g. message inserted
    // against a thread whose status update lost a race).
    const txResult = await DB_CLIENT.use.$transaction(async tx => {
      // DECISION: lock the USER row (FOR UPDATE) BEFORE lockSupportThreadRow. Order User -> SupportThread
      // follows the global invariant (User lowest, SupportThread highest), so no ABBA. Without it the
      // message cap was soft: parallel messages to DIFFERENT threads of one user (the per-thread lock
      // does not serialize them) read a stale count and all committed, a burst over the cap plus an
      // admin e-mail flood. The user lock serializes all her adds, making the count authoritative.
      await lockUserRow(tx, userId);

      // DECISION: take the pessimistic row lock (FOR UPDATE) BEFORE reading status and inserting. Without
      // it, under Read Committed a parallel admin change-status -> CLOSED commits between the status read
      // and the INSERT and the message lands in a CLOSED thread. The lock works only if every writer takes
      // it: contract with adminChangeThreadStatus_IO and adminReplyToThread_IO, see
      // support-thread-lock.helper.ts.
      const locked = await lockSupportThreadRow(tx, threadId);

      if (locked === null) {
        return { ok: false as const, error: 'NOT_FOUND' as const };
      }

      if (locked.user_id !== userId) {
        return { ok: false as const, error: 'NOT_AUTHORIZED' as const };
      }

      // DECISION: all guards must run BEFORE the create. A $transaction callback's return value commits
      // (only a throw rolls back), so a create before the CLOSED guard would store a ghost message in a
      // closed thread and count it in _count.messages despite {ok:false}. Under the row lock this read sees
      // a competing admin close that won the lock race.
      if (locked.status === SupportThreadStatusValue.CLOSED) {
        return { ok: false as const, error: 'CLOSED' as const };
      }

      // DECISION: the cap counts USER messages per hour per user across all her threads; it is hard (the
      // count authoritative) because lockUserRow above serializes every add of this user.
      const oneHourAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
      const recentMessageCount = await tx.supportMessage.count({
        where: {
          sender_type: SupportSenderTypeValue.USER,
          created_at: { gte: oneHourAgo },
          thread: { user_id: userId },
        },
      });

      if (recentMessageCount >= SUPPORT_MESSAGE_RATE_LIMIT) {
        reportIssueBackend({
          namespace: 'SUPPORT_RATE_LIMITED',
          message: `User ${userId} exceeded support message rate limit: ${recentMessageCount}/${SUPPORT_MESSAGE_RATE_LIMIT} in last hour`,
          payload: { userId, threadId, currentCount: recentMessageCount },
          mode: 'info',
        });
        return {
          ok: false as const,
          error: 'RATE_LIMITED' as const,
          currentCount: recentMessageCount,
        };
      }

      const message = await tx.supportMessage.create({
        data: {
          thread_id: threadId,
          sender_type: SupportSenderTypeValue.USER,
          content,
        },
        select: { id: true },
      });

      // DECISION: ALWAYS touch the thread (bump updated_at via @updatedAt) on every user message, not only
      // on a status change. Gating on `status !== OPEN` meant a fresh reply to an already OPEN thread did
      // not bump updated_at, so the admin's OCC snapshot (Signal 2 in applySupportStatusWrite) still
      // matched and a stale close passed, trapping the message in CLOSED. Safe because lists sort by `id
      // desc`, not updated_at, and the only consumer of updated_at is that OCC token, for which "last
      // activity" is the right meaning. Prisma emits the UPDATE even when status is already OPEN. The
      // RESOLVED -> OPEN reopen is the same line, atomic under the row lock.
      await tx.supportThread.update({
        where: { id: threadId },
        data: { status: SupportThreadStatusValue.OPEN },
      });

      return {
        ok: true as const,
        messageId: message.id,
        subject: locked.subject,
      };
    });

    if (!txResult.ok) {
      if (txResult.error === 'NOT_FOUND') {
        return failure({ type: 'SUPPORT_THREAD_NOT_FOUND', threadId });
      }
      if (txResult.error === 'CLOSED') {
        return failure({ type: 'SUPPORT_THREAD_CLOSED', threadId });
      }
      if (txResult.error === 'RATE_LIMITED') {
        return failure({
          type: 'SUPPORT_RATE_LIMITED',
          currentCount: txResult.currentCount,
          limit: SUPPORT_MESSAGE_RATE_LIMIT,
        });
      }
      return failure({
        type: 'SUPPORT_THREAD_NOT_AUTHORIZED',
        threadId,
        userId,
      });
    }

    return success({
      message_id: txResult.messageId,
      subject: txResult.subject,
    });
  } catch (error) {
    return databaseFailure('addSupportMessage', error);
  }
};
