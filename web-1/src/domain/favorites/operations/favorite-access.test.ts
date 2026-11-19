// Access matrix of liked records after a pairing change (F1): read boundary + both racing writers at mock
// level; the real interleaving is proven live in tests/concurrency/favorite-revoke-race.concurrency.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { __setDb as mockDb } from '../../../test-utils/setup';

const resolveSalonAccess = vi.fn();
vi.mock('@domain/pairing/salon-access.resolver', () => ({
  resolveSalonAccess_IO: (...args: unknown[]) => resolveSalonAccess(...args),
}));

import {
  favoriteReadableRecordWhere,
  resolveFavoriteReadScope_IO,
} from './favorite-access';
import {
  addRecordToFavorites_IO,
  getFavoriteRecords_IO,
} from './favorite-records.operations';
import { getFavoriteGrouped_IO } from './favorite-grouping.operations';
import { DB_CLIENT } from '@app/db/db.client';
import type { Prisma } from '../../../prisma/js-client';

const CLIENT = 'usr_client_00000000000001';
const DIRECT = 'acc_direct_00000000000001';
const SALON = 'acc_salon_000000000000001';
const FORMER = 'acc_former_00000000000001';
const PAIR = 'pair_000000000000000000001';

const tx = (): Prisma.TransactionClient =>
  DB_CLIENT.use as unknown as Prisma.TransactionClient;

type Where = Record<string, unknown>;

const scopeDb = (authors: string[], directPairs: string[]) => {
  const authorQuery = vi.fn(async (_args: { where: Where }) =>
    authors.map(account_id => ({ account_id }))
  );
  const pairQuery = vi.fn(async (_args: { where: Where }) =>
    directPairs.map(stylist_account_id => ({ stylist_account_id }))
  );
  return { authorQuery, pairQuery };
};

beforeEach(() => {
  resolveSalonAccess.mockReset();
});

describe('resolveFavoriteReadScope_IO: who may still read an unpinned like', () => {
  it('direct active pair: readable; former stylist with no access: excluded (orphaned like)', async () => {
    const { authorQuery, pairQuery } = scopeDb([DIRECT, FORMER], [DIRECT]);
    mockDb({
      stylistAccount: { findMany: authorQuery },
      clientStylistPair: { findMany: pairQuery },
    });
    resolveSalonAccess.mockResolvedValue(null);

    const scope = await resolveFavoriteReadScope_IO(CLIENT, tx());

    expect(scope.accessibleStylistIds).toEqual([DIRECT]);
    // The former stylist goes through the salon branch of the SAME resolver, never a bare status check.
    expect(resolveSalonAccess).toHaveBeenCalledTimes(1);
    expect(resolveSalonAccess).toHaveBeenCalledWith(CLIENT, FORMER, tx(), true);
  });

  it('salon access (paid owner, active contributing member): readable through the resolver', async () => {
    const { authorQuery, pairQuery } = scopeDb([SALON], [DIRECT]);
    mockDb({
      stylistAccount: { findMany: authorQuery },
      clientStylistPair: { findMany: pairQuery },
    });
    resolveSalonAccess.mockResolvedValue({
      kind: 'SALON',
      salonAccountId: 'acc_owner',
      pairId: null,
    });

    const scope = await resolveFavoriteReadScope_IO(CLIENT, tx());

    expect(scope.accessibleStylistIds).toEqual([SALON]);
  });

  it('salon access lost (membership, plan, visibility switch, explicit stylist disconnect): excluded', async () => {
    const { authorQuery, pairQuery } = scopeDb([SALON], [DIRECT]);
    mockDb({
      stylistAccount: { findMany: authorQuery },
      clientStylistPair: { findMany: pairQuery },
    });
    resolveSalonAccess.mockResolvedValue(null);

    const scope = await resolveFavoriteReadScope_IO(CLIENT, tx());

    expect(scope.accessibleStylistIds).toEqual([]);
  });

  it('revoked by either side and no other direct pair: no seed, salon branch skipped, nothing readable', async () => {
    const { authorQuery, pairQuery } = scopeDb([FORMER], []);
    mockDb({
      stylistAccount: { findMany: authorQuery },
      clientStylistPair: { findMany: pairQuery },
    });

    const scope = await resolveFavoriteReadScope_IO(CLIENT, tx());

    expect(scope.accessibleStylistIds).toEqual([]);
    expect(resolveSalonAccess).not.toHaveBeenCalled();
  });

  it('only authors of her own visible unpinned likes are considered; direct pair needs a visible stylist and an active client', async () => {
    const { authorQuery, pairQuery } = scopeDb([DIRECT], [DIRECT]);
    mockDb({
      stylistAccount: { findMany: authorQuery },
      clientStylistPair: { findMany: pairQuery },
    });

    await resolveFavoriteReadScope_IO(CLIENT, tx());

    expect(authorQuery.mock.calls[0]?.[0].where).toMatchObject({
      account_status: 'ACTIVE',
      created_by_user: { is_active: true },
      gallery_record: {
        some: {
          is_pinned: false,
          is_hidden: false,
          favorited_by: { some: { client_user_id: CLIENT } },
        },
      },
    });
    expect(pairQuery.mock.calls[0]?.[0].where).toMatchObject({
      client_user_id: CLIENT,
      status: 'ACTIVE',
      salon_origin_account_id: null,
      stylist_account: { account_status: 'ACTIVE' },
      client_user: { is_active: true },
    });
  });

  it('no unpinned likes: one query, no pair read', async () => {
    const { authorQuery, pairQuery } = scopeDb([], [DIRECT]);
    mockDb({
      stylistAccount: { findMany: authorQuery },
      clientStylistPair: { findMany: pairQuery },
    });

    const scope = await resolveFavoriteReadScope_IO(CLIENT, tx());

    expect(scope.accessibleStylistIds).toEqual([]);
    expect(pairQuery).not.toHaveBeenCalled();
  });
});

describe('favoriteReadableRecordWhere', () => {
  it('pinned stays public; unpinned only for accessible authors; hidden and disabled stylists never', () => {
    expect(
      favoriteReadableRecordWhere({ accessibleStylistIds: [DIRECT] })
    ).toEqual({
      is_hidden: false,
      created_by_account: {
        account_status: 'ACTIVE',
        created_by_user: { is_active: true },
      },
      OR: [{ is_pinned: true }, { created_by_account_id: { in: [DIRECT] } }],
    });
  });
});

describe('getFavoriteRecords_IO: the access filter is SQL, before pagination', () => {
  it('passes the scope predicate, take+1 and the cursor in ONE findMany (no post-filter)', async () => {
    const { authorQuery, pairQuery } = scopeDb([DIRECT, FORMER], [DIRECT]);
    resolveSalonAccess.mockResolvedValue(null);
    const findMany = vi.fn(async (_args: unknown) => [
      {
        id: 'cfav00000000000000000000a',
        gallery_record_id: 'gr_1',
        note: null,
        record: {
          asset_url: 'https://example.com/1.jpg',
          created_by_account_id: DIRECT,
          colors: [],
          traits: [],
          created_by_account: { display_name: 'D' },
        },
      },
    ]);
    mockDb({
      stylistAccount: { findMany: authorQuery },
      clientStylistPair: { findMany: pairQuery },
      favoriteGalleryRecord: { findMany },
    });

    const cursor = 'cfav00000000000000000000z';
    const result = await getFavoriteRecords_IO({ id: CLIENT, cursor, take: 1 });

    expect(result.success).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        client_user_id: CLIENT,
        record: {
          OR: [
            { is_pinned: true },
            { created_by_account_id: { in: [DIRECT] } },
          ],
        },
      },
      take: 2,
      cursor: { id: cursor },
      skip: 1,
    });
    if (result.success) {
      // One row for take=1 → no next page; the page is exactly what SQL returned.
      expect(result.data.records).toHaveLength(1);
      expect(result.data.nextCursor).toBeNull();
    }
  });
});

describe('getFavoriteGrouped_IO: same boundary for rows and counts', () => {
  it('filters the rows with the scope and binds the scope ids into the count', async () => {
    const { authorQuery, pairQuery } = scopeDb([DIRECT], [DIRECT]);
    const findMany = vi.fn(async (_args: unknown) => []);
    const queryRaw = vi.fn(async (..._args: unknown[]) => []);
    mockDb({
      stylistAccount: { findMany: authorQuery },
      clientStylistPair: { findMany: pairQuery },
      favoriteGalleryRecord: { findMany },
      $queryRaw: queryRaw,
    });

    const result = await getFavoriteGrouped_IO({ id: CLIENT });

    expect(result.success).toBe(true);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        record: {
          OR: [
            { is_pinned: true },
            { created_by_account_id: { in: [DIRECT] } },
          ],
        },
      },
    });
    expect(queryRaw.mock.calls[0]).toContainEqual([DIRECT]);
  });
});

describe('addRecordToFavorites_IO: access is evaluated only under the stylist lock', () => {
  const recordFacts = {
    is_pinned: false,
    is_hidden: false,
    created_by_account_id: FORMER,
    created_by_account: { created_by_user_id: 'usr_former' },
  };

  it('locks users (KEY SHARE) then StylistAccount BEFORE reading the mutable access facts', async () => {
    const order: string[] = [];
    const findUnique = vi.fn(async () => {
      order.push('record');
      return recordFacts;
    });
    mockDb({
      galleryRecord: { findUnique },
      favoriteGalleryRecord: {
        create: vi.fn(async () => ({
          id: 'fav',
          client_user_id: CLIENT,
          gallery_record_id: 'gr_1',
        })),
      },
      // lockInOrder issues one Prisma.sql statement per row; tell them apart by the SQL text.
      $queryRaw: vi.fn(async (query: { sql: string }) => {
        order.push(
          query.sql.includes('"users"')
            ? `lockUser ${query.sql.includes('FOR KEY SHARE') ? 'KEY SHARE' : 'other'}`
            : `lockAccount ${query.sql.includes('FOR UPDATE') ? 'UPDATE' : 'other'}`
        );
        return [{ locked: 1 }];
      }),
    });
    resolveSalonAccess.mockImplementation(async () => {
      order.push('access');
      return { kind: 'DIRECT', pairId: PAIR };
    });

    const result = await addRecordToFavorites_IO({
      gallery_record_id: 'gr_1',
      id: CLIENT,
    });

    expect(result.success).toBe(true);

    expect(order).toEqual([
      'record',
      'lockUser KEY SHARE',
      'lockAccount UPDATE',
      'record',
      'access',
    ]);
  });

  it('revoked before the lock was granted: 404 mask, no row, no counter change', async () => {
    const create = vi.fn();
    const executeRaw = vi.fn(async () => 0);
    mockDb({
      galleryRecord: { findUnique: vi.fn(async () => recordFacts) },
      favoriteGalleryRecord: { create },
      $executeRaw: executeRaw,
    });
    resolveSalonAccess.mockResolvedValue(null);

    const result = await addRecordToFavorites_IO({
      gallery_record_id: 'gr_1',
      id: CLIENT,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('RECORD_TO_ADD_NOT_FOUND');
    }
    expect(create).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('pinned record of a visible stylist: allowed without any pair (public channel kept)', async () => {
    mockDb({
      galleryRecord: {
        findUnique: vi.fn(async () => ({ ...recordFacts, is_pinned: true })),
      },
      stylistAccount: {
        findFirst: vi.fn(async () => ({ account_id: FORMER })),
      },
      favoriteGalleryRecord: {
        create: vi.fn(async () => ({
          id: 'fav',
          client_user_id: CLIENT,
          gallery_record_id: 'gr_1',
        })),
      },
    });

    const result = await addRecordToFavorites_IO({
      gallery_record_id: 'gr_1',
      id: CLIENT,
    });

    expect(result.success).toBe(true);
    expect(resolveSalonAccess).not.toHaveBeenCalled();
  });
});
