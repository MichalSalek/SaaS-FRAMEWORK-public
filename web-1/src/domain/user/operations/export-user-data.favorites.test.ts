import { describe, expect, it, vi } from 'vitest';
import { __setDb as mockDb } from '../../../test-utils/setup';
import { exportClientData } from './export-user-data.collectors';

vi.mock('@domain/pairing/salon-access.resolver', () => ({
  resolveSalonAccess_IO: vi.fn(async () => null),
}));

const like = (id: string, author: string, note: string | null = null) => ({
  id,
  created_at: new Date('2026-10-20T10:00:00Z'),
  note,
  record: {
    asset_url: `https://example.com/${id}.jpg`,
    nail_length: 'SHORT',
    created_by_account: { display_name: author },
  },
});

describe('exportClientData favorite_records', () => {
  it('keeps the orphaned like (date, note, stylist) and nulls only its asset_url', async () => {
    const readableQuery = vi.fn(
      async (_args: { where: Record<string, unknown> }) => [
        { id: 'pinned' },
        { id: 'paired' },
      ]
    );
    mockDb({
      clientAccount: { findUnique: async () => null },
      favoriteStylist: { findMany: async () => [] },
      favoriteGalleryRecord: {
        findMany: async (args: { where: Record<string, unknown> }) =>
          'id' in args.where
            ? readableQuery(args)
            : [
                like('pinned', 'Public'),
                like('orphan', 'Former', 'na wesele'),
                like('paired', 'Direct'),
              ],
      },
      // Liked authors with unpinned works: the direct stylist and the former one.
      stylistAccount: {
        findMany: async () => [
          { account_id: 'acc_direct' },
          { account_id: 'acc_former' },
        ],
      },
      clientStylistPair: {
        findMany: async (args: { where: Record<string, unknown> }) =>
          args.where.status === 'ACTIVE'
            ? [{ stylist_account_id: 'acc_direct' }]
            : [],
      },
      sessionContainer: { findMany: async () => [] },
    });

    const data = await exportClientData('usr_client');
    const records = data.favorite_records as Array<Record<string, unknown>>;

    expect(records).toHaveLength(3);
    expect(records.map(r => r.asset_url)).toEqual([
      'https://example.com/pinned.jpg',
      null,
      'https://example.com/paired.jpg',
    ]);
    expect(records[1]).toMatchObject({
      stylist_name: 'Former',
      note: 'na wesele',
      nail_length: 'SHORT',
      added_at: '2026-10-20T10:00:00.000Z',
    });
    // The mask uses the same SQL predicate as the in-app lists: pinned, or an author in the current scope.
    expect(readableQuery.mock.calls[0]?.[0].where).toMatchObject({
      id: { in: ['pinned', 'orphan', 'paired'] },
      client_user_id: 'usr_client',
      record: {
        OR: [
          { is_pinned: true },
          { created_by_account_id: { in: ['acc_direct'] } },
        ],
      },
    });
  });

  it('no likes: no scope queries', async () => {
    const authors = vi.fn(async () => []);
    mockDb({
      clientAccount: { findUnique: async () => null },
      favoriteStylist: { findMany: async () => [] },
      favoriteGalleryRecord: { findMany: async () => [] },
      stylistAccount: { findMany: authors },
      clientStylistPair: { findMany: async () => [] },
      sessionContainer: { findMany: async () => [] },
    });

    const data = await exportClientData('usr_client');

    expect(data.favorite_records).toEqual([]);
    expect(authors).not.toHaveBeenCalled();
  });
});
