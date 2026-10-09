/**
 * "Awaiting reply" (S126): the admin menu badge and the admin list filter are
 * the SAME SQL predicate, so the number in the menu is the number of rows the
 * link shows.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import {
  SUPPORT_AWAITING_REPLY_SQL,
  buildSupportAwaitingReplyCountQuery,
  buildSupportAwaitingReplyPageQuery,
} from './support-awaiting-reply.predicate';
import { adminGetAllThreads_IO } from './support-admin.operations';

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;
type SqlArg = { sql: string; values: unknown[] };

const adminCaller = makeStylistCurrentUser({
  user: { id: 'usr_admin_000000000000001', role_id: SystemRoleId.MASTER_ADMIN },
});
const USER_ID = 'usr_test_0000000000000001';
const THREAD_A = 'cmt0thread0a000000000001';
const THREAD_B = 'cmt0thread0b000000000002';
const THREAD_C = 'cmt0thread0c000000000003';

const threadRow = (id: string) => ({
  id,
  subject: `Subject ${id}`,
  category: 'BUG',
  status: 'OPEN',
  created_at: new Date('2026-05-01T10:00:00.000Z'),
  updated_at: new Date('2026-05-02T10:00:00.000Z'),
  user_id: USER_ID,
});

describe('awaiting-reply predicate', () => {
  it('means: OPEN and the latest message is from the user', () => {
    expect(SUPPORT_AWAITING_REPLY_SQL.sql).toContain('t."status" =');
    expect(SUPPORT_AWAITING_REPLY_SQL.sql).toMatch(
      /ORDER BY m\."created_at" DESC, m\."id" DESC\s+LIMIT 1/
    );
    expect(SUPPORT_AWAITING_REPLY_SQL.values).toEqual(['OPEN', 'USER']);
  });

  it('the badge count is a plain COUNT over the predicate, with no scan cap', () => {
    const count = buildSupportAwaitingReplyCountQuery();
    expect(count.sql).toContain(SUPPORT_AWAITING_REPLY_SQL.sql);
    expect(count.sql).toContain('COUNT(*)');
    expect(count.sql).not.toContain('LIMIT 500');
    expect(count.values).toEqual(SUPPORT_AWAITING_REPLY_SQL.values);
  });

  it('the list page uses the same predicate, id-descending keyset and the limit', () => {
    const page = buildSupportAwaitingReplyPageQuery({
      cursor: THREAD_B,
      category: undefined,
      limit: 21,
    });
    expect(page.sql).toContain(SUPPORT_AWAITING_REPLY_SQL.sql);
    expect(page.sql).toContain('AND t."id" <');
    expect(page.sql).toMatch(/ORDER BY t\."id" DESC\s+LIMIT/);
    expect(page.values).toEqual(['OPEN', 'USER', THREAD_B, 21]);
  });

  it('category narrows the page: one value, or NONE for threads without one', () => {
    const billing = buildSupportAwaitingReplyPageQuery({
      cursor: undefined,
      category: 'BILLING',
      limit: 51,
    });
    expect(billing.sql).toContain('t."category" =');
    expect(billing.values).toEqual(['OPEN', 'USER', 'BILLING', 51]);

    const none = buildSupportAwaitingReplyPageQuery({
      cursor: undefined,
      category: 'NONE',
      limit: 51,
    });
    expect(none.sql).toContain('t."category" IS NULL');
    expect(none.values).toEqual(['OPEN', 'USER', 51]);
  });
});

describe('adminGetAllThreads_IO with awaitingReply', () => {
  const aggregateRows = [THREAD_A, THREAD_B, THREAD_C].map(id => ({
    thread_id: id,
    last_message_preview: 'pytanie',
    last_message_sender_type: 'USER',
    message_count: 1,
    has_unread_reply: false,
  }));

  it('pages the ids with the badge predicate, loads the rows and keeps the id order', async () => {
    const queryRaw = vi
      .fn<(query: SqlArg) => Promise<unknown[]>>()
      // 1st raw call = the id page (take 2 + 1 probe), newest first.
      .mockResolvedValueOnce([
        { id: THREAD_C },
        { id: THREAD_B },
        { id: THREAD_A },
      ])
      // 2nd raw call = the shared aggregate.
      .mockResolvedValueOnce(aggregateRows);
    // The row query returns them in ANOTHER order on purpose.
    const findMany = vi.fn(async (_args: unknown) => [
      threadRow(THREAD_B),
      threadRow(THREAD_C),
    ]);
    mockDb({
      supportThread: { findMany },
      user: { findMany: async () => [] },
      $queryRaw: rawStub(queryRaw),
    });

    const result = await adminGetAllThreads_IO(
      adminCaller,
      { awaitingReply: true, status: 'CLOSED' },
      { take: 2 }
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.threads.map(t => t.id)).toEqual([THREAD_C, THREAD_B]);
    expect(result.data.threads[0]?.category).toBe('BUG');
    expect(result.data.nextCursor).toBe(THREAD_B);

    const idQuery = queryRaw.mock.calls[0]?.[0];
    expect(idQuery?.sql).toContain(SUPPORT_AWAITING_REPLY_SQL.sql);
    // take + 1, and the `status` filter is ignored (the predicate fixes OPEN).
    expect(idQuery?.values).toEqual(['OPEN', 'USER', 3]);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: { in: [THREAD_C, THREAD_B] } },
    });
  });

  it('a last page has no next cursor; a row deleted in between only shortens it', async () => {
    const queryRaw = vi
      .fn<(query: SqlArg) => Promise<unknown[]>>()
      .mockResolvedValueOnce([{ id: THREAD_B }, { id: THREAD_A }])
      .mockResolvedValueOnce(aggregateRows);
    mockDb({
      supportThread: { findMany: async () => [threadRow(THREAD_A)] },
      user: { findMany: async () => [] },
      $queryRaw: rawStub(queryRaw),
    });

    const result = await adminGetAllThreads_IO(
      adminCaller,
      { awaitingReply: true },
      { take: 50 }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.threads.map(t => t.id)).toEqual([THREAD_A]);
      expect(result.data.nextCursor).toBeNull();
    }
  });

  it('an empty set makes no row query and no aggregate', async () => {
    const queryRaw = vi.fn(async (_query: SqlArg) => []);
    const findMany = vi.fn(async () => []);
    mockDb({ supportThread: { findMany }, $queryRaw: rawStub(queryRaw) });

    const result = await adminGetAllThreads_IO(adminCaller, {
      awaitingReply: true,
    });

    expect(result).toEqual({
      success: true,
      data: { threads: [], nextCursor: null },
    });
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('a malformed cursor is a 400, a well-formed unknown one is just a keyset', async () => {
    const queryRaw = vi.fn(async (_query: SqlArg) => []);
    mockDb({ $queryRaw: rawStub(queryRaw) });

    const malformed = await adminGetAllThreads_IO(
      adminCaller,
      { awaitingReply: true },
      { cursor: 'not a cuid\0' }
    );
    expect(malformed.success).toBe(false);
    if (!malformed.success) {
      expect(malformed.error.type).toBe('VALIDATION_ERROR');
    }
    expect(queryRaw).not.toHaveBeenCalled();

    const unknown = await adminGetAllThreads_IO(
      adminCaller,
      { awaitingReply: true },
      { cursor: THREAD_B }
    );
    expect(unknown.success).toBe(true);
    expect(queryRaw.mock.calls[0]?.[0]?.values).toContain(THREAD_B);
  });
});

describe('adminGetAllThreads_IO without awaitingReply', () => {
  it('filters by category through the ordinary ORM path (NONE = no category)', async () => {
    const findMany = vi.fn(async (_args: unknown) => []);
    mockDb({ supportThread: { findMany, findFirst: async () => null } });

    await adminGetAllThreads_IO(adminCaller, {
      status: 'OPEN',
      category: 'IDEA',
    });
    await adminGetAllThreads_IO(adminCaller, { category: 'NONE' });
    await adminGetAllThreads_IO(adminCaller);

    const whereOf = (call: number) =>
      (findMany.mock.calls[call]?.[0] as { where: unknown }).where;
    expect(whereOf(0)).toEqual({ status: 'OPEN', category: 'IDEA' });
    expect(whereOf(1)).toEqual({ category: null });
    expect(whereOf(2)).toEqual({});
  });
});
