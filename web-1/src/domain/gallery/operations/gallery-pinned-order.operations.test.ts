/**
 * Pinned order: reorderPinnedGalleryRecords_IO / getPinnedGalleryRecords_IO.
 *
 *  - lock-first on the stylist account (same serialization point as pin/unpin);
 *  - the request must be a permutation of the VISIBLE pinned set of the session's
 *    account: unknown, foreign, unpinned, missing or duplicated ids → STALE, no write;
 *  - one UPDATE ... FROM (VALUES ...) passed as an ARGUMENT, scoped by owner and
 *    is_pinned, positions = list index;
 *  - the read uses the public visibility predicate and the shared order.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  getPinnedGalleryRecords_IO,
  isPermutationOfPinnedSet,
  reorderPinnedGalleryRecords_IO,
} from './gallery-pinned-order.operations';

const ACCOUNT_ID = 'acc_test_0000000000000001';

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;

type SqlLike = { sql: string; values: unknown[] };

const mockReorderScenario = (pinnedIds: string[]) => {
  const findMany = vi.fn(async (_arg: unknown) =>
    pinnedIds.map(id => ({ gallery_record_id: id }))
  );
  const lock = vi.fn(async () => [{ account_id: ACCOUNT_ID }]);
  const executeRaw = vi.fn(async (_query: SqlLike) => pinnedIds.length);
  mockDb({
    galleryRecord: { findMany },
    $queryRaw: rawStub(lock),
    $executeRaw: rawStub(executeRaw),
  });
  return { findMany, lock, executeRaw };
};

describe('isPermutationOfPinnedSet', () => {
  it('accepts the same members in any order', () => {
    expect(isPermutationOfPinnedSet(['c', 'a', 'b'], ['a', 'b', 'c'])).toBe(
      true
    );
  });

  it.each([
    ['missing id', ['a', 'b'], ['a', 'b', 'c']],
    ['extra id', ['a', 'b', 'c', 'd'], ['a', 'b', 'c']],
    ['unknown id swapped in', ['a', 'b', 'x'], ['a', 'b', 'c']],
    ['duplicate id', ['a', 'a', 'b'], ['a', 'b', 'c']],
  ])('refuses: %s', (_label, requested, current) => {
    expect(isPermutationOfPinnedSet(requested, current)).toBe(false);
  });
});

describe('reorderPinnedGalleryRecords_IO', () => {
  it('happy path: lock, read visible pinned of the SESSION account, one scoped UPDATE with list positions', async () => {
    const { findMany, lock, executeRaw } = mockReorderScenario([
      'gr_1',
      'gr_2',
      'gr_3',
    ]);

    const result = await reorderPinnedGalleryRecords_IO({
      stylist_account_id: ACCOUNT_ID,
      gallery_record_ids: ['gr_3', 'gr_1', 'gr_2'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.galleryRecordIds).toEqual(['gr_3', 'gr_1', 'gr_2']);
    }
    expect(lock).toHaveBeenCalledTimes(1);
    const where = (
      findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> }
    ).where;
    expect(where).toEqual({
      created_by_account_id: ACCOUNT_ID,
      is_pinned: true,
      is_hidden: false,
    });
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const query = executeRaw.mock.calls[0]?.[0];
    // Whole query built with Prisma.sql and passed as an argument: values are
    // bind parameters (id, position pairs in list order, then the owner).
    expect(query?.sql).toContain('UPDATE "GalleryRecord"');
    expect(query?.sql).toContain('"created_by_account_id" =');
    expect(query?.sql).toContain('"is_pinned" = true');
    expect(query?.values).toEqual([
      'gr_3',
      0,
      'gr_1',
      1,
      'gr_2',
      2,
      ACCOUNT_ID,
    ]);
  });

  it('an id that is not one of her visible pinned works → STALE, nothing written', async () => {
    const { executeRaw } = mockReorderScenario(['gr_1', 'gr_2']);

    const result = await reorderPinnedGalleryRecords_IO({
      stylist_account_id: ACCOUNT_ID,
      gallery_record_ids: ['gr_1', 'gr_foreign'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toEqual({
        type: 'GALLERY_PINNED_ORDER_STALE',
        expectedCount: 2,
        receivedCount: 2,
      });
    }
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('an incomplete list (a pin added in another tab) → STALE, nothing written', async () => {
    const { executeRaw } = mockReorderScenario(['gr_1', 'gr_2', 'gr_3']);

    const result = await reorderPinnedGalleryRecords_IO({
      stylist_account_id: ACCOUNT_ID,
      gallery_record_ids: ['gr_2', 'gr_1'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_PINNED_ORDER_STALE');
    }
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('database throw → DATABASE_ERROR', async () => {
    mockDb({
      galleryRecord: {
        findMany: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
      $queryRaw: rawStub(vi.fn(async () => [{ account_id: ACCOUNT_ID }])),
    });

    const result = await reorderPinnedGalleryRecords_IO({
      stylist_account_id: ACCOUNT_ID,
      gallery_record_ids: ['gr_1'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});

describe('getPinnedGalleryRecords_IO', () => {
  it('visible pinned works of the account in the public order', async () => {
    const rows = [
      { gallery_record_id: 'gr_2', asset_url: 'u2' },
      { gallery_record_id: 'gr_1', asset_url: 'u1' },
    ];
    const findMany = vi.fn(async (_arg: unknown) => rows);
    mockDb({ galleryRecord: { findMany } });

    const result = await getPinnedGalleryRecords_IO({
      stylist_account_id: ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.records).toEqual(rows);
    }
    const arg = findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      orderBy: unknown;
    };
    expect(arg.where).toEqual({
      created_by_account_id: ACCOUNT_ID,
      is_pinned: true,
      is_hidden: false,
    });
    expect(arg.orderBy).toEqual([
      { pinned_position: { sort: 'asc', nulls: 'last' } },
      { created_at: 'desc' },
      { gallery_record_id: 'desc' },
    ]);
  });
});
