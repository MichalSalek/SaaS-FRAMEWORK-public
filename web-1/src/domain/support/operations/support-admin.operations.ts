/**
 * Support Admin Operations (get-all / reply / change-status / get-messages).
 *
 * DECISION: defense in depth: every operation takes `currentUser` and runs `requireAdminPermission`
 * BEFORE any query. The middleware check is the first line, but reuse (background job, internal API,
 * tests) bypasses it. Same pattern as admin-user-management.operations.ts.
 */

import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type {
  SupportThreadNotFoundError,
  SupportThreadClosedError,
  SupportThreadStaleError,
} from '@kernel/domain/support/support-errors.types';
import {
  assertType,
  isSupportThreadStatusNarrower,
  isSupportSenderTypeNarrower,
} from '@kernel/models/type_narrowing';
import {
  SupportSenderTypeValue,
  SupportThreadStatusValue,
} from '@kernel/models/support/support.dto';
import type {
  SupportThreadAdminListItem,
  SupportThreadStatus,
} from '@kernel/models/support/support.dto';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { ContractHandlerResponse } from '@kernel/application/contracts/contract.types';
import type { SupportContracts } from '@kernel/domain/support/support.contracts';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { lockSupportThreadRow } from './support-thread-lock.helper';
import { applySupportStatusWrite } from './support-status-write.helper';
import { supportDbFailure } from './support-admin-error.helper';
import { resolveSupportThreadCursor } from './support-cursor.helper';
import {
  ADMIN_THREAD_ROW_SELECT,
  buildAdminThreadWhere,
  fetchAwaitingReplyThreadPage,
  toAdminThreadListItems,
  type AdminThreadListFilters,
} from './support-admin-list.helper';

// ── Admin Get All Threads ──

type AdminGetAllThreadsResult = {
  threads: SupportThreadAdminListItem[];
  nextCursor: string | null;
};

/**
 * Get all support threads (admin) with cursor pagination (default 50, max 100).
 * Cursor by SupportThread.id; orderBy id desc for stable traversal.
 */
export const adminGetAllThreads_IO = async (
  currentUser: GetCurrentUserOutputOptimistic['currentUser'],
  filters: AdminThreadListFilters = {},
  pagination?: { cursor?: string | undefined; take?: number | undefined }
): Promise<
  OperationResult<
    AdminGetAllThreadsResult,
    DatabaseError | ValidationError | AdminInsufficientPermissionsError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const cursor = pagination?.cursor;
  const take = pagination?.take ?? 50;
  const effectiveTake = Math.min(Math.max(take, 1), 100);

  try {
    // "Awaiting reply" = the list behind the admin menu badge. Its page is
    // selected by the badge's own SQL predicate (see fetchAwaitingReplyThreadPage);
    // everything after the page selection is shared with the ordinary list.
    if (filters.awaitingReply === true) {
      const page = await fetchAwaitingReplyThreadPage({
        cursor,
        category: filters.category,
        take: effectiveTake,
      });
      if (page.invalidCursor) {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'cursor',
          message: 'Invalid cursor',
        });
      }
      return success({
        threads: await toAdminThreadListItems(page.pageItems),
        nextCursor: page.nextCursor,
      });
    }

    const whereClause = buildAdminThreadWhere(filters);

    // DECISION: the cursor goes through the shared resolveSupportThreadCursor (support-cursor.helper.ts),
    // same as the user endpoint: `invalid` => VALIDATION_ERROR 400; `useCursor` => whether to apply the
    // Prisma cursor spread (existence is checked in the SAME filter as the main query). Without it a
    // null-byte/non-cuid cursor was an unmapped 500 and an unknown one a silent empty page.
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
      // Preview + licznik wiadomości poza tym zapytaniem (patrz niżej): zagnieżdżone
      // `messages.take` Prisma tnie dopiero w Node, a relacyjny `_count` to nieskorelowany
      // GROUP BY po całej tabeli. Rationale: support-thread-aggregates.helper.ts.
      select: ADMIN_THREAD_ROW_SELECT,
    });

    const hasMore = threads.length > effectiveTake;
    const pageItems = hasMore ? threads.slice(0, effectiveTake) : threads;
    const nextCursor =
      hasMore && pageItems.length > 0
        ? (pageItems[pageItems.length - 1]?.id ?? null)
        : null;

    return success({
      threads: await toAdminThreadListItems(pageItems),
      nextCursor,
    });
  } catch (error) {
    return databaseFailure('adminGetAllThreads_IO', error);
  }
};

// ── Admin Reply ──

type AdminReplyParams = {
  threadId: string;
  content: string;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
};

type AdminReplyResult = {
  message_id: string;
  user_email: string;
  subject: string;
  /** The thread owner, or null when her account is gone (orphaned thread). */
  owner_user_id: string | null;
};

export const adminReplyToThread_IO = async (
  params: AdminReplyParams
): Promise<
  OperationResult<
    AdminReplyResult,
    | SupportThreadNotFoundError
    | SupportThreadClosedError
    | DatabaseError
    | AdminInsufficientPermissionsError
  >
> => {
  const { threadId, content, currentUser } = params;

  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    // DECISION: take the SAME pessimistic row lock (lockSupportThreadRow, FOR UPDATE) as add-message and
    // change-status, as the FIRST step of the tx (cross-file contract with support-thread-lock.helper.ts).
    // Admin reply conditionally reopens (RESOLVED -> OPEN); without the shared lock that reopen could lose
    // a race with a parallel change-status -> CLOSED (last writer wins on `status`). user.email is read
    // after the lock; status/subject come from the locked row.
    const txResult = await DB_CLIENT.use.$transaction(async tx => {
      const locked = await lockSupportThreadRow(tx, threadId);

      if (locked === null) {
        return { ok: false as const, error: 'NOT_FOUND' as const };
      }

      // DECISION: replying to a CLOSED thread is rejected BEFORE the create, mirroring user-side
      // addSupportMessage_IO. CLOSED is final; without the guard the message landed in a thread the user
      // sees as closed and the notification invited her to continue it. A $transaction callback's return
      // value commits (only a throw rolls back), so the guard must precede tx.supportMessage.create or a
      // ghost message is stored and counted in _count.messages despite {ok:false}. Under the row lock this
      // read sees a competing admin close that won the lock race.
      if (locked.status === SupportThreadStatusValue.CLOSED) {
        return { ok: false as const, error: 'CLOSED' as const };
      }

      const owner = await tx.user.findUnique({
        where: { id: locked.user_id },
        select: { email: true },
      });

      const message = await tx.supportMessage.create({
        data: {
          thread_id: threadId,
          sender_type: SupportSenderTypeValue.SUPPORT,
          content,
        },
        select: { id: true },
      });

      // DECISION: ALWAYS touch the thread (bump updated_at) on every admin reply, not only on RESOLVED ->
      // OPEN. Status is OPEN or RESOLVED here (CLOSED was rejected above), so setting OPEN unconditionally
      // is a reopen for RESOLVED and a pure updated_at bump for OPEN (Prisma still emits the UPDATE with
      // @updatedAt). Otherwise the OCC token was asymmetric: a fresh reply by admin B to an OPEN thread did
      // not bump updated_at, so admin A's stale close passed and buried B's reply in CLOSED. Mirrors the
      // always-bump in addSupportMessage_IO.
      await tx.supportThread.update({
        where: { id: threadId },
        data: { status: SupportThreadStatusValue.OPEN },
      });

      return {
        ok: true as const,
        messageId: message.id,
        userEmail: owner?.email ?? '',
        ownerUserId: owner ? locked.user_id : null,
        subject: locked.subject,
      };
    });

    if (!txResult.ok) {
      if (txResult.error === 'CLOSED') {
        return failure({ type: 'SUPPORT_THREAD_CLOSED', threadId });
      }
      return failure({ type: 'SUPPORT_THREAD_NOT_FOUND', threadId });
    }

    return success({
      message_id: txResult.messageId,
      user_email: txResult.userEmail,
      subject: txResult.subject,
      owner_user_id: txResult.ownerUserId,
    });
  } catch (error) {
    return supportDbFailure(error, {
      namespace: 'SUPPORT_ADMIN_REPLY_ERROR',
      prefix: 'Failed to reply to support thread',
      operation: 'adminReplyToThread',
      payload: { threadId },
    });
  }
};

// ── Admin Change Status ──

type ChangeStatusParams = {
  threadId: string;
  status: SupportThreadStatus;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  // Optimistic-concurrency token (finding support-1): the thread `updated_at` the
  // admin last saw. When provided, the status change becomes CONDITIONAL — a fresh
  // user reply that arrived after this snapshot rejects the (stale) close. Absent OR
  // null => unconditional change (backward-compat, no guard). ISO 8601 string or Date.
  // `| undefined` is explicit (exactOptionalPropertyTypes) so the handler can pass the
  // optional DTO field straight through without omitting the key when absent.
  // `| null` (finding support-l2-2): JSON `null` realnie dociera z body (validator pomija
  // null jako "absent"); helper applySupportStatusWrite normalizuje null≡undefined.
  expectedUpdatedAt?: string | Date | null | undefined;
};

type ChangeStatusResult = {
  thread_id: string;
  status: SupportThreadStatus;
  // support-2: true gdy transition byl no-op (status docelowy == biezacy). applySupportStatusWrite
  // pomija wtedy DB-write; handler pomija audit-event (EventLog). Response zostaje 200 idempotent.
  noop: boolean;
};

export const adminChangeThreadStatus_IO = async (
  params: ChangeStatusParams
): Promise<
  OperationResult<
    ChangeStatusResult,
    | SupportThreadNotFoundError
    | SupportThreadStaleError
    | DatabaseError
    | AdminInsufficientPermissionsError
  >
> => {
  const { threadId, status, currentUser, expectedUpdatedAt } = params;

  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    // DECISION: take the SAME row lock as addSupportMessage_IO (lockSupportThreadRow, FOR UPDATE) BEFORE
    // the status write; it also replaces findUnique as the existence check (null = no thread). Without it
    // both transactions read OPEN concurrently and both committed (message + CLOSED), trapping the message
    // in CLOSED. The lock alone cannot close the user-first order (add-message commits to a legally OPEN
    // thread, then this close commits CLOSED): that needs optimistic concurrency, so when the admin sends
    // expectedUpdatedAt, applySupportStatusWrite rejects a close of a changed thread (two staleness
    // signals, see support-status-write.helper.ts). The lock must be taken before that helper, in the same tx.
    const txResult = await DB_CLIENT.use.$transaction<
      | { ok: true; noop?: true }
      | { ok: false; reason: 'NOT_FOUND' }
      | { ok: false; reason: 'STALE' }
    >(async tx => {
      const locked = await lockSupportThreadRow(tx, threadId);

      if (locked === null) {
        return { ok: false, reason: 'NOT_FOUND' };
      }

      // NOT_FOUND handled above; helper returns { ok:true } | { ok:false; reason:'STALE' }.
      return applySupportStatusWrite(tx, threadId, status, expectedUpdatedAt);
    });

    if (!txResult.ok) {
      if (txResult.reason === 'STALE') {
        return failure({ type: 'SUPPORT_THREAD_STALE', threadId });
      }
      return failure({ type: 'SUPPORT_THREAD_NOT_FOUND', threadId });
    }

    // support-2: skip the audit log for no-op transitions (e.g. CLOSED->CLOSED).
    // The helper already suppressed the redundant DB write and signals it via
    // `noop`; gating the audit here removes the cosmetic "status changed" noise
    // while the response stays a 200 idempotent success.
    const isNoop = txResult.noop === true;
    if (!isNoop) {
      reportIssueBackend({
        namespace: 'SUPPORT_STATUS_CHANGED',
        message: `Support thread ${threadId} status changed to ${status}`,
        payload: { threadId, status },
        mode: 'info',
      });
    }

    return success({ thread_id: threadId, status, noop: isNoop });
  } catch (error) {
    return supportDbFailure(error, {
      namespace: 'SUPPORT_CHANGE_STATUS_ERROR',
      prefix: 'Failed to change support thread status',
      operation: 'adminChangeThreadStatus',
      payload: { threadId, status },
    });
  }
};

// ── Admin Get Thread Messages ──

// DECISION: the success payload is bound to the API contract (SUPPORT_ADMIN_GET_THREAD_MESSAGES RESPONSE),
// not a local type: the DTO extends the user RESPONSE with thread.updated_at, the optimistic-concurrency
// token the admin UI sends back as CHANGE_STATUS.expected_updated_at so a stale close gets 409. Binding to
// the DTO enforces its presence end to end.
export const adminGetThreadMessages_IO = async (
  threadId: string,
  currentUser: GetCurrentUserOutputOptimistic['currentUser']
): Promise<
  OperationResult<
    ContractHandlerResponse<
      SupportContracts['SUPPORT_ADMIN_GET_THREAD_MESSAGES']
    >,
    | SupportThreadNotFoundError
    | DatabaseError
    | AdminInsufficientPermissionsError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    // DD3-F10 (2026-05-26): cap nested messages at 200. Pathological threads (long-running
    // conversation, abuse, runaway bot) would otherwise pull thousands of messages into
    // memory + payload. 200 covers >99% of real cases; UI can paginate older messages on demand.
    // DECISION: on truncation the admin sees the NEWEST 200 (fetch desc, reverse before mapping so the
    // payload stays chronological), exactly like user-side getSupportThreadMessages_IO. With asc + take
    // the operator read the oldest 200 while the user saw the newest.
    const thread = await DB_CLIENT.use.supportThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        subject: true,
        category: true,
        status: true,
        updated_at: true,
        user_id: true,
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

    // Tozsamosc autora watku. `user_id` jest soft-FK (konto mogло zostac
    // usuniete albo przeniesione po 90 dniach), wiec rozwiazujemy je OSOBNYM
    // zapytaniem i akceptujemy brak wiersza — dokladnie ta sama zasada, co
    // w hydrateAdminThreadListItems dla listy watkow. Pusty string zamiast null,
    // bo DTO obiecuje string, a UI ma wlasny fallback na "Klient".
    const owner = await DB_CLIENT.use.user.findUnique({
      where: { id: thread.user_id },
      select: { email: true, name: true },
    });

    // Pobrane DESC (najnowsze 200) — odwracamy do chronologicznego ASC dla frontendu.
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
        updated_at: thread.updated_at,
        user_email: owner?.email ?? '',
        user_name: owner?.name ?? '',
      },
    });
  } catch (error) {
    return supportDbFailure(error, {
      namespace: 'SUPPORT_ADMIN_GET_MESSAGES_ERROR',
      prefix: 'Failed to get thread messages (admin)',
      operation: 'adminGetThreadMessages',
      payload: { threadId },
    });
  }
};
