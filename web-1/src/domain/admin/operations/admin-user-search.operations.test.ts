/**
 * ADMIN USER-SEARCH unit tests (finding F2).
 *
 * `_count: { sessions: { where: ... } }` w findMany kompilował się do
 * NIESKORELOWANEGO agregatu po całej tabeli "Session" (GROUP BY bez zawężenia do id
 * ze strony). Liczba aktywnych sesji przychodzi teraz ze skorelowanego LATERAL-a
 * ograniczonego do userów bieżącej strony.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import { adminGetUsersPaginated_IO } from './admin-user-search.operations';

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;

const adminCaller = makeStylistCurrentUser({
  user: { id: 'usr_admin_000000000000001', role_id: SystemRoleId.MASTER_ADMIN },
});

const userRow = (id: string) => ({
  id,
  email: `${id}@test.local`,
  emailVerified: true,
  name: 'Test',
  account_type: 'STYLIST',
  role_id: SystemRoleId.STYLIST_ROLE,
  is_active: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  stylist_account: null,
});

describe('adminGetUsersPaginated_IO — licznik aktywnych sesji', () => {
  it('nie selektuje relacyjnego _count i mapuje licznik z LATERAL-a', async () => {
    const findMany = vi.fn(async (_args: unknown) => [
      userRow('usr_a_000000000000000001'),
      userRow('usr_b_000000000000000002'),
    ]);
    const queryRaw = vi.fn(async () => [
      { user_id: 'usr_a_000000000000000001', active_sessions: 3 },
      // usr_b bez wiersza — user bez żadnej aktywnej sesji.
    ]);
    mockDb({ user: { findMany }, $queryRaw: rawStub(queryRaw) });

    const result = await adminGetUsersPaginated_IO({
      currentUser: adminCaller,
      params: {},
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const selectArg = (
      findMany.mock.calls[0]?.[0] as { select: Record<string, unknown> }
    ).select;
    expect(selectArg).not.toHaveProperty('_count');
    expect(result.data.records[0]?._count).toEqual({ sessions: 3 });
    expect(result.data.records[1]?._count).toEqual({ sessions: 0 });
  });

  it('pusta strona → zero zapytań o sesje', async () => {
    const queryRaw = vi.fn(async () => []);
    mockDb({
      user: { findMany: async () => [] },
      $queryRaw: rawStub(queryRaw),
    });

    const result = await adminGetUsersPaginated_IO({
      currentUser: adminCaller,
      params: {},
    });

    expect(result.success).toBe(true);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
