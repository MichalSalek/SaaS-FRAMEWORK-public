/**
 * Support read marker (S126): unread-reply badge and "mark as read".
 *
 * Pinned behaviour:
 *  - the badge count and the list flag `has_unread_reply` read ONE SQL
 *    predicate (a SUPPORT message newer than SupportThread.user_last_read_at);
 *  - marking a thread read is one raw UPDATE with ownership in its WHERE: it
 *    never goes through the ORM (that would bump `updated_at`, the admin's
 *    optimistic-concurrency token) and a foreign thread is the same
 *    "not found" as a missing one;
 *  - the owner comes from the caller of the operation (the session user),
 *    never from the request body.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import {
  buildMarkSupportThreadReadQuery,
  buildSupportUnreadCountQuery,
  getSupportUnreadCount_IO,
  markSupportThreadRead_IO,
} from './support-read-marker.operations';
import { SUPPORT_UNREAD_REPLY_SQL } from './support-unread-reply.predicate';
import { getSupportThreads_IO } from './support-thread-queries.operations';

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;
type SqlArg = { sql: string; values: unknown[] };

const USER_ID = 'usr_test_0000000000000001';
const THREAD_ID = 'cmt_thread_a000000000001';

describe('unread-reply predicate', () => {
  it('means: a SUPPORT message newer than the owner read marker', () => {
    expect(SUPPORT_UNREAD_REPLY_SQL.sql).toContain('"SupportMessage"');
    expect(SUPPORT_UNREAD_REPLY_SQL.sql).toContain(
      'um."created_at" > t."user_last_read_at"'
    );
    expect(SUPPORT_UNREAD_REPLY_SQL.values).toEqual(['SUPPORT']);
  });

  it('is the same SQL in the badge count and in the list aggregate', async () => {
    const queryRaw = vi.fn(async (_query: SqlArg) => [
      {
        thread_id: THREAD_ID,
        last_message_preview: 'odpowiedź',
        last_message_sender_type: 'SUPPORT',
        message_count: 2,
        has_unread_reply: true,
      },
    ]);
    mockDb({
      supportThread: {
        findMany: async () => [
          {
            id: THREAD_ID,
            subject: 'Temat',
            category: 'BILLING',
            status: 'OPEN',
            created_at: new Date('2026-05-01T10:00:00.000Z'),
            updated_at: new Date('2026-05-02T10:00:00.000Z'),
          },
        ],
        findFirst: async () => null,
      },
      $queryRaw: rawStub(queryRaw),
    });

    const result = await getSupportThreads_IO(USER_ID);

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.threads[0]).toMatchObject({
      id: THREAD_ID,
      category: 'BILLING',
      has_unread_reply: true,
    });
    const aggregateSql = queryRaw.mock.calls[0]?.[0]?.sql ?? '';
    expect(aggregateSql).toContain(SUPPORT_UNREAD_REPLY_SQL.sql);
    expect(buildSupportUnreadCountQuery(USER_ID).sql).toContain(
      SUPPORT_UNREAD_REPLY_SQL.sql
    );
  });

  it('a thread whose aggregate is missing is not unread', async () => {
    mockDb({
      supportThread: {
        findMany: async () => [
          {
            id: THREAD_ID,
            subject: 'Temat',
            category: null,
            status: 'OPEN',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
        findFirst: async () => null,
      },
      $queryRaw: rawStub(async () => []),
    });

    const result = await getSupportThreads_IO(USER_ID);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threads[0]).toMatchObject({
        category: null,
        has_unread_reply: false,
      });
    }
  });
});

describe('getSupportUnreadCount_IO', () => {
  it('counts only the threads of the given user', async () => {
    const queryRaw = vi.fn(async (_query: SqlArg) => [{ unread_threads: 3 }]);
    mockDb({ $queryRaw: rawStub(queryRaw) });

    const result = await getSupportUnreadCount_IO(USER_ID);

    expect(result).toEqual({ success: true, data: { unread_threads: 3 } });
    const query = queryRaw.mock.calls[0]?.[0];
    expect(query?.sql).toContain('t."user_id" =');
    expect(query?.values).toContain(USER_ID);
  });

  it('no row from the aggregate is zero, not a crash', async () => {
    mockDb({ $queryRaw: rawStub(async () => []) });

    const result = await getSupportUnreadCount_IO(USER_ID);

    expect(result).toEqual({ success: true, data: { unread_threads: 0 } });
  });

  it('a database error is DATABASE_ERROR', async () => {
    mockDb({
      $queryRaw: rawStub(async () => {
        throw new Error('connection reset');
      }),
    });

    const result = await getSupportUnreadCount_IO(USER_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});

describe('markSupportThreadRead_IO', () => {
  it('is ONE raw update scoped by thread id AND owner, without touching updated_at', async () => {
    const executeRaw = vi.fn(async (_query: SqlArg) => 1);
    const ormUpdate = vi.fn();
    mockDb({
      supportThread: { update: ormUpdate, updateMany: ormUpdate },
      $executeRaw: rawStub(executeRaw),
    });

    const result = await markSupportThreadRead_IO({
      userId: USER_ID,
      threadId: THREAD_ID,
    });

    expect(result).toEqual({ success: true, data: { thread_id: THREAD_ID } });
    expect(executeRaw).toHaveBeenCalledOnce();
    expect(ormUpdate).not.toHaveBeenCalled();
    const query = executeRaw.mock.calls[0]?.[0];
    expect(query?.sql).toContain('SET "user_last_read_at"');
    expect(query?.sql).not.toContain('updated_at');
    expect(query?.sql).toMatch(/WHERE "id" = \S+\s+AND "user_id" = /);
    expect(query?.values).toEqual([THREAD_ID, USER_ID]);
  });

  it('a foreign or missing thread (0 rows) is SUPPORT_THREAD_NOT_FOUND', async () => {
    mockDb({ $executeRaw: rawStub(async () => 0) });

    const result = await markSupportThreadRead_IO({
      userId: USER_ID,
      threadId: THREAD_ID,
    });

    expect(result).toEqual({
      success: false,
      error: { type: 'SUPPORT_THREAD_NOT_FOUND', threadId: THREAD_ID },
    });
  });

  it('the query builder takes the owner from its argument only', () => {
    const query = buildMarkSupportThreadReadQuery({
      userId: 'usr_owner',
      threadId: 'thr_1',
    });
    expect(query.values).toEqual(['thr_1', 'usr_owner']);
  });
});
