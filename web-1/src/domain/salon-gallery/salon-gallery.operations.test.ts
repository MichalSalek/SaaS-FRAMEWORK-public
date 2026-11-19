import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
import { getSalonGallery_IO } from './salon-gallery.operations';
vi.mock('@domain/pairing/salon-access.resolver', () => ({
  resolveSalonAccess_IO: vi.fn(async () => null),
}));
const owner = {
  account_id: 'salon',
  created_by_user_id: 'owner',
  pricing_plan: 'STUDIO',
  subscription_status: 'ACTIVE',
  payment_status: 'PAID',
  account_status: 'ACTIVE',
  account_expiration_date: null,
  salon_profile_name: 'Salon',
  display_name: 'Owner',
  avatar_url: null,
  vanity_url: null,
  created_by_user: { image: null },
};
const member = { ...owner, account_id: 'member', display_name: 'Member' };
const work = (id: string, author = 'member') => ({
  gallery_record_id: id,
  created_by_account_id: author,
  asset_url: 'https://example.com/' + id,
  created_at: new Date('2026-10-11'),
  nail_length: 'SHORT',
  colors: [],
  traits: [],
});
type GalleryQuery = { where: Record<string, unknown> };
let gallery: ReturnType<
  typeof vi.fn<(query: GalleryQuery) => Promise<ReturnType<typeof work>[]>>
>;
beforeEach(() => {
  gallery = vi
    .fn<(query: GalleryQuery) => Promise<ReturnType<typeof work>[]>>()
    .mockResolvedValueOnce([work('showcase')])
    .mockResolvedValueOnce([work('pinned')]);
  mockDb({
    stylistAccount: {
      findFirst: async () => owner,
      findMany: async () => [member],
    },
    galleryRecord: { findMany: gallery },
    staffMember: { findFirst: async () => null },
  });
});
describe('salon gallery read model', () => {
  it('showcase precedes ordinary pinned works and authors are retained', async () => {
    const result = await getSalonGallery_IO({
      props: { salon_account_id: 'salon' },
      publicOnly: true,
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.records.map(row => row.gallery_record_id)).toEqual([
      'showcase',
      'pinned',
    ]);
    expect(result.data.records[0]?.author.name).toBe('Member');
    expect(gallery).toHaveBeenCalledTimes(2);
    expect(gallery.mock.calls[1]?.[0].where.NOT).toEqual({
      salon_showcase_works: { some: { salon_account_id: 'salon' } },
    });
  });
  it('uses a lookahead cursor without leaking more than requested', async () => {
    gallery.mockReset().mockResolvedValue([work('b'), work('a')]);
    const result = await getSalonGallery_IO({
      props: { salon_account_id: 'salon', take: 1 },
      publicOnly: true,
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.records).toHaveLength(1);
    expect(result.data.nextCursor).toBe('0|2026-10-11T00:00:00.000Z|b');
    expect(gallery).toHaveBeenCalledTimes(1);
  });
  it('ordinary cursor never restarts the showcase', async () => {
    gallery.mockReset().mockResolvedValue([work('a')]);
    await getSalonGallery_IO({
      props: {
        salon_account_id: 'salon',
        cursor: '1|2026-10-11T00:00:00.000Z|b',
      },
      publicOnly: true,
    });
    expect(gallery).toHaveBeenCalledTimes(1);
    expect(gallery.mock.calls[0]?.[0].where.AND).toEqual([
      {
        OR: [
          { created_at: { lt: new Date('2026-10-11') } },
          {
            created_at: new Date('2026-10-11'),
            gallery_record_id: { lt: 'b' },
          },
        ],
      },
    ]);
  });
  it('filters by contributor and excludes hidden works at the database', async () => {
    await getSalonGallery_IO({
      props: { salon_account_id: 'salon', stylist_account_id: 'member' },
      publicOnly: true,
    });
    expect(gallery.mock.calls[0]?.[0].where).toEqual(
      expect.objectContaining({
        created_by_account_id: 'member',
        is_hidden: false,
      })
    );
  });
  it('rejects a foreign stylist filter before record queries', async () => {
    expect(
      (
        await getSalonGallery_IO({
          props: { salon_account_id: 'salon', stylist_account_id: 'other' },
          publicOnly: true,
        })
      ).success
    ).toBe(false);
    expect(gallery).not.toHaveBeenCalled();
  });
  it('denies full gallery without a direct or active salon connection', async () => {
    expect(
      (
        await getSalonGallery_IO({
          props: { salon_account_id: 'salon' },
          viewerUserId: 'stranger',
        })
      ).success
    ).toBe(false);
    expect(gallery).not.toHaveBeenCalled();
  });
  it('allows the owner to read the full gallery', async () => {
    expect(
      (
        await getSalonGallery_IO({
          props: { salon_account_id: 'salon' },
          viewerUserId: 'owner',
        })
      ).success
    ).toBe(true);
    expect(gallery.mock.calls[0]?.[0].where.OR).toBeUndefined();
  });
  it('rejects malformed cursors', async () => {
    expect(
      (
        await getSalonGallery_IO({
          props: { salon_account_id: 'salon', cursor: 'invalid' },
          publicOnly: true,
        })
      ).success
    ).toBe(false);
    expect(gallery).not.toHaveBeenCalled();
  });
  it('owner plan ending hides the entire salon', async () => {
    mockDb({
      stylistAccount: {
        findFirst: async () => ({ ...owner, subscription_status: 'CANCELED' }),
      },
    });
    expect(
      (
        await getSalonGallery_IO({
          props: { salon_account_id: 'salon' },
          publicOnly: true,
        })
      ).success
    ).toBe(false);
  });
  it('crosses the showcase boundary without applying its date cutoff to ordinary works', async () => {
    gallery
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([work('newer'), work('older')]);
    const result = await getSalonGallery_IO({
      props: {
        salon_account_id: 'salon',
        take: 1,
        cursor: '0|2026-10-10T00:00:00.000Z|old-showcase',
      },
      publicOnly: true,
    });
    expect(result.success).toBe(true);
    expect(gallery.mock.calls[0]?.[0].where.AND).toBeDefined();
    expect(gallery.mock.calls[1]?.[0].where.AND).toBeUndefined();
    if (result.success) {
      expect(result.data.nextCursor).toBe('1|2026-10-11T00:00:00.000Z|newer');
    }
  });
  it('does not mix unpinned ordinary works into public reads and applies all supported filters', async () => {
    await getSalonGallery_IO({
      props: {
        salon_account_id: 'salon',
        color_ids: ['pink'],
        trait_ids: ['french'],
        nail_length: 'SHORT',
      },
      publicOnly: true,
    });
    expect(gallery.mock.calls[1]?.[0].where).toEqual(
      expect.objectContaining({
        OR: [
          { is_pinned: true },
          { salon_showcase_works: { some: { salon_account_id: 'salon' } } },
        ],
        NOT: { salon_showcase_works: { some: { salon_account_id: 'salon' } } },
        is_hidden: false,
        nail_length: 'SHORT',
        colors: { some: { color_id: { in: ['pink'] } } },
        traits: { some: { trait_id: { in: ['french'] } } },
      })
    );
  });
  it('includes Scale members beyond the hundredth while keeping work queries paged', async () => {
    const scaleOwner = { ...owner, pricing_plan: 'SCALE' };
    const team = Array.from({ length: 101 }, (_, index) => ({
      ...member,
      account_id: `member-${String(index + 1).padStart(3, '0')}`,
    }));
    const readMembers = vi.fn(async (query: { take?: number }) =>
      query.take === undefined ? team : team.slice(0, query.take)
    );
    gallery
      .mockReset()
      .mockResolvedValueOnce([work('last-member-work', 'member-101')])
      .mockResolvedValueOnce([]);
    mockDb({
      stylistAccount: {
        findFirst: async () => scaleOwner,
        findMany: readMembers,
      },
      galleryRecord: { findMany: gallery },
    });
    const result = await getSalonGallery_IO({
      props: {
        salon_account_id: 'salon',
        stylist_account_id: 'member-101',
        take: 24,
      },
      publicOnly: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contributors).toHaveLength(102);
      expect(result.data.records[0]?.author.account_id).toBe('member-101');
    }
    expect(readMembers).toHaveBeenCalledTimes(1);
    expect(readMembers.mock.calls[0]?.[0].take).toBeUndefined();
    expect(gallery).toHaveBeenCalledTimes(2);
    expect(gallery.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ take: 25 })
    );
  });
});
