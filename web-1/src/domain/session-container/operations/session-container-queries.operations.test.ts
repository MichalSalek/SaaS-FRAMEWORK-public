/**
 * SessionContainer LIST-QUERY unit tests — getMySessionContainers_IO (domain-unit;
 * sibling file session-container-queries.detail.test.ts covers loadSessionDetail_IO
 * + getSessionContainerById_IO — split to stay under ESLint max-lines).
 *
 * Covered: get-my WHERE scoping (client sees all her rows; stylist only
 * SHARED/ACTIVE and NOT past-TTL — the read-side mirror of the SC-4 expiry filter,
 * s22-adjacent), cursor contract (format gate + SCOPED stale-cursor existence
 * pre-check → VALIDATION_ERROR, never a Prisma throw and never an existence
 * oracle), take clamp + nextCursor pagination, and per-row viewer masking of
 * stylistNote (a reader can be the client of one row and the stylist of another
 * in the SAME page).
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { getMySessionContainers_IO } from './session-container-queries.operations';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';

const SESSION_ID = 'sess_test_000000000000001';
const CLIENT_ACCOUNT_ID = 'cli_test_0000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_stylist_0000000000001';
const OTHER_STYLIST_ID = 'acc_stylist_other_0000001';
// isValidCursorFormat = /^[a-z0-9]{20,40}$/
const VALID_CURSOR = 'a1b2c3d4e5f6a7b8c9d0e1f2';

const makeRow = (overrides: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  client_account_id: CLIENT_ACCOUNT_ID,
  stylist_account_id: STYLIST_ACCOUNT_ID,
  name: null,
  lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
  stylist_note: null,
  client_note: null,
  shared_at: new Date('2026-01-01T00:00:00.000Z'),
  expires_at: new Date(Date.now() + 60 * 60 * 1000),
  closed_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  _count: { photos: 1 },
  ...overrides,
});

describe('getMySessionContainers_IO — cursor contract', () => {
  it('malformed cursor → VALIDATION_ERROR before ANY db access', async () => {
    const findFirst = vi.fn(async () => makeRow());
    const findMany = vi.fn(async () => []);
    mockDb({ sessionContainer: { findFirst, findMany } });

    const result = await getMySessionContainers_IO({
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
      cursor: 'NIE_TAKI_cursor!',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
    }
    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('well-formed but STALE cursor (row gone) → VALIDATION_ERROR, not an empty page', async () => {
    const findMany = vi.fn(async () => [makeRow()]);
    const findFirst = vi.fn(async (_arg: unknown) => null);
    mockDb({
      // Scoped existence pre-check (anti-enumeration) uses findFirst — a stale
      // cursor means the scoped lookup finds nothing.
      sessionContainer: { findFirst, findMany },
    });

    const result = await getMySessionContainers_IO({
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
      cursor: VALID_CURSOR,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
    }
    expect(findMany).not.toHaveBeenCalled();
    // Anti-enumeration: the pre-check is SCOPED to the caller's own set (same OR
    // filter as the list query) — a foreign-but-live session id and a nonexistent
    // id are indistinguishable to the caller.
    const preCheckArg = findFirst.mock.calls[0]?.[0] as unknown as {
      where: { id: string; OR: unknown[] };
    };
    expect(preCheckArg.where.id).toBe(VALID_CURSOR);
    expect(preCheckArg.where.OR).toEqual([
      { client_account_id: CLIENT_ACCOUNT_ID },
    ]);
  });
});

describe('getMySessionContainers_IO — scoping + pagination', () => {
  it('dual-role WHERE: client sees her rows; stylist branch is SHARED/ACTIVE only AND TTL-filtered (SC-4 read mirror)', async () => {
    const findMany = vi.fn(async (_arg: unknown) => [makeRow()]);
    mockDb({ sessionContainer: { findMany } });

    const result = await getMySessionContainers_IO({
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
      take: 999, // clamped to 100
    });

    expect(result.success).toBe(true);
    const arg = findMany.mock.calls[0]?.[0] as unknown as {
      where: {
        OR: [
          { client_account_id: string },
          {
            stylist_account_id: string;
            lifecycle_state: { in: string[] };
            OR: [{ expires_at: null }, { expires_at: { gt: Date } }];
          },
        ];
      };
      take: number;
    };
    expect(arg.where.OR[0]).toEqual({ client_account_id: CLIENT_ACCOUNT_ID });
    const stylistBranch = arg.where.OR[1];
    expect(stylistBranch.stylist_account_id).toBe(STYLIST_ACCOUNT_ID);
    expect(stylistBranch.lifecycle_state.in).toEqual(
      expect.arrayContaining([
        SessionContainerLifecycleStateValue.SHARED,
        SessionContainerLifecycleStateValue.ACTIVE,
      ])
    );
    // Stylist must NOT see expired-but-unswept sessions.
    expect(stylistBranch.OR[0]).toEqual({ expires_at: null });
    expect(stylistBranch.OR[1]?.expires_at.gt).toBeInstanceOf(Date);
    // take clamp: max 100 (+1 sentinel row for hasMore detection).
    expect(arg.take).toBe(101);
  });

  it('client-only caller → single OR branch (no stylist leak into the WHERE)', async () => {
    const findMany = vi.fn(async (_arg: unknown) => []);
    mockDb({ sessionContainer: { findMany } });

    await getMySessionContainers_IO({
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
    });

    const arg = findMany.mock.calls[0]?.[0] as unknown as {
      where: { OR: unknown[] };
    };
    expect(arg.where.OR).toHaveLength(1);
  });

  it('take+1 rows returned → page trimmed to take, nextCursor = last page item', async () => {
    const rows = ['s1', 's2', 's3'].map(id => makeRow({ id }));
    mockDb({ sessionContainer: { findMany: async () => rows } });

    const result = await getMySessionContainers_IO({
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: undefined,
      take: 2,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessions.map(s => s.id)).toEqual(['s1', 's2']);
      expect(result.data.nextCursor).toBe('s2');
    }
  });

  it('per-row viewer masking: stylistNote revealed ONLY on rows where the reader is the assigned stylist', async () => {
    const mineAsStylist = makeRow({
      id: 'sess_stylist_row_00000001',
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_note: 'notka stylistki',
    });
    const mineAsClient = makeRow({
      id: 'sess_client_row_000000001',
      stylist_account_id: OTHER_STYLIST_ID,
      stylist_note: 'cudza notka',
      client_account: { created_by_user: { name: 'Ala' } },
    });
    mockDb({
      sessionContainer: {
        findMany: async () => [mineAsStylist, mineAsClient],
      },
    });

    const result = await getMySessionContainers_IO({
      client_account_id: CLIENT_ACCOUNT_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const [asStylist, asClient] = result.data.sessions;
      expect(asStylist?.stylistNote).toBe('notka stylistki');
      expect(asClient?.stylistNote).toBeNull();
      expect(asClient?.clientName).toBe('Ala');
      expect(result.data.nextCursor).toBeNull();
    }
  });
});
