// Full salon gallery for a non-member client: private works only of authors she can reach herself (F1 review).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __setDb as mockDb } from '../../test-utils/setup';
import { getSalonGallery_IO } from './salon-gallery.operations';

const resolveSalonAccess = vi.fn();
vi.mock('@domain/pairing/salon-access.resolver', () => ({
  resolveSalonAccess_IO: (...args: unknown[]) => resolveSalonAccess(...args),
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
type GalleryQuery = { where: Record<string, unknown> };
let gallery: ReturnType<typeof vi.fn<(query: GalleryQuery) => Promise<[]>>>;
let staffMember: unknown;
let directAuthors: string[];

const showcase = {
  salon_showcase_works: { some: { salon_account_id: 'salon' } },
};
const privateWhere = (ids: string[]) => [
  { is_pinned: true },
  showcase,
  { created_by_account_id: { in: ids } },
];

beforeEach(() => {
  resolveSalonAccess.mockReset();
  staffMember = null;
  directAuthors = ['salon'];
  gallery = vi.fn<(query: GalleryQuery) => Promise<[]>>().mockResolvedValue([]);
  mockDb({
    stylistAccount: {
      findFirst: async () => owner,
      findMany: async () => [member],
    },
    // The client's direct pair is with the owner; the member is reachable only through the salon.
    clientStylistPair: {
      findMany: async () =>
        directAuthors.map(stylist_account_id => ({ stylist_account_id })),
    },
    staffMember: { findFirst: async () => staffMember },
    galleryRecord: { findMany: gallery },
  });
});

describe('salon gallery: private works per author', () => {
  it('keeps a connected contributor accessible when the owner disconnected the client', async () => {
    directAuthors = ['member'];
    resolveSalonAccess.mockResolvedValue(null);
    const result = await getSalonGallery_IO({
      props: { salon_account_id: 'salon' },
      viewerUserId: 'client',
    });
    expect(result.success).toBe(true);
    expect(gallery.mock.calls[0]?.[0].where.OR).toEqual(
      privateWhere(['member'])
    );
  });

  it('denies private gallery access when no contributor remains accessible', async () => {
    directAuthors = [];
    resolveSalonAccess.mockResolvedValue(null);
    const result = await getSalonGallery_IO({
      props: { salon_account_id: 'salon' },
      viewerUserId: 'client',
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'ACCOUNT_NOT_FOUND' },
    });
    expect(gallery).not.toHaveBeenCalled();
  });
  it('member who disconnected the client (REVOKED by STYLIST): only her public works remain', async () => {
    resolveSalonAccess.mockImplementation(
      async (_client: string, author: string) =>
        author === 'salon' ? { kind: 'DIRECT', pairId: 'p' } : null
    );

    const result = await getSalonGallery_IO({
      props: { salon_account_id: 'salon' },
      viewerUserId: 'client',
    });

    expect(result.success).toBe(true);
    for (const call of gallery.mock.calls) {
      expect(call[0].where.OR).toEqual(privateWhere(['salon']));
    }
    expect(resolveSalonAccess).toHaveBeenCalledWith(
      'client',
      'member',
      expect.anything(),
      true
    );
  });

  it('member reachable through the salon: her private works are readable', async () => {
    resolveSalonAccess.mockImplementation(async () => ({
      kind: 'SALON',
      salonAccountId: 'salon',
      pairId: null,
    }));

    await getSalonGallery_IO({
      props: { salon_account_id: 'salon' },
      viewerUserId: 'client',
    });

    expect(gallery.mock.calls[0]?.[0].where.OR).toEqual(
      privateWhere(['salon', 'member'])
    );
  });

  it('stylist_account_id filter on a disconnected member goes through the same restriction', async () => {
    resolveSalonAccess.mockImplementation(
      async (_client: string, author: string) =>
        author === 'salon' ? { kind: 'DIRECT', pairId: 'p' } : null
    );

    await getSalonGallery_IO({
      props: { salon_account_id: 'salon', stylist_account_id: 'member' },
      viewerUserId: 'client',
    });

    expect(gallery.mock.calls[0]?.[0].where).toEqual(
      expect.objectContaining({
        created_by_account_id: 'member',
        OR: privateWhere(['salon']),
      })
    );
  });

  it('team member: the whole team, no per-author restriction', async () => {
    staffMember = { id: 'staff' };

    await getSalonGallery_IO({
      props: { salon_account_id: 'salon' },
      viewerUserId: 'member-user',
    });

    expect(gallery.mock.calls[0]?.[0].where.OR).toBeUndefined();
    expect(resolveSalonAccess).not.toHaveBeenCalled();
  });
});
