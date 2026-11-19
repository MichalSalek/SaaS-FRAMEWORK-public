import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
import {
  getSalonProfile_IO,
  updateSalonProfile_IO,
  getStylistSalonLink_IO,
  updateSalonProfileVisibility_IO,
} from './salon-profile.operations';
const owner = {
  account_id: 'owner',
  pricing_plan: 'STUDIO',
  subscription_status: 'ACTIVE',
  payment_status: 'PAID',
  account_status: 'ACTIVE',
  account_expiration_date: null,
  salon_profile_name: 'Salon',
  salon_brand_accent_color: null,
  salon_show_team: true,
  display_name: 'Anna',
  business_name: null,
  avatar_url: 'legacy-face',
  salon_logo_url: 'salon-logo',
  vanity_url: 'anna',
  created_by_user: { avatar_url: 'person-photo', image: 'oauth-photo' },
  address_city: 'Warszawa',
  website: null,
  instagram_handle: null,
  phone: null,
};
describe('salon profile boundaries', () => {
  it('public profile exposes selected salon works and no email', async () => {
    const gallery = vi.fn(async () => [
      {
        gallery_record_id: 'work',
        asset_url: 'https://example.com/work.jpg',
        created_by_account_id: 'owner',
      },
    ]);
    const people = vi.fn(async () => []);
    mockDb({
      stylistAccount: { findFirst: async () => owner, findMany: people },
      galleryRecord: { findMany: gallery },
    });
    const result = await getSalonProfile_IO({ accountId: 'owner' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logo_url).toBe('salon-logo');
      expect(result.data.owner.avatar_url).toBe('person-photo');
      expect(result.data.owner.avatar_fallback_url).toBe('oauth-photo');
    }
    expect(gallery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          created_by_account_id: { in: ['owner'] },
          salon_showcase_works: { some: { salon_account_id: 'owner' } },
          is_hidden: false,
        },
        take: 30,
      })
    );
    expect(people).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          created_by_user: expect.objectContaining({
            staff_memberships: {
              some: expect.objectContaining({
                public_profile_visible: true,
                accepted_at: { not: null },
              }),
            },
          }),
        }),
      })
    );
    expect(JSON.stringify(result)).not.toContain('email');
  });
  it('owner switch hides members but still resolves gallery contributors', async () => {
    const people = vi.fn(async () => []);
    mockDb({
      stylistAccount: {
        findFirst: async () => ({ ...owner, salon_show_team: false }),
        findMany: people,
      },
      galleryRecord: { findMany: async () => [] },
    });
    expect((await getSalonProfile_IO({ accountId: 'owner' })).success).toBe(
      true
    );
    expect(people).toHaveBeenCalledTimes(1);
  });
  it('own free account cannot mutate salon with inherited entitlement', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({ ...owner, pricing_plan: 'FREE' }),
      },
    });
    expect(
      (
        await updateSalonProfile_IO({
          accountId: 'owner',
          body: {
            name: 'Salon',
            brand_accent_color: null,
            show_team: true,
            pinned_record_ids: [],
          },
        })
      ).success
    ).toBe(false);
  });
  it('enforces own plan pin quota before writing', async () => {
    mockDb({ stylistAccount: { findUnique: async () => owner } });
    expect(
      (
        await updateSalonProfile_IO({
          accountId: 'owner',
          body: {
            name: 'Salon',
            brand_accent_color: null,
            show_team: true,
            pinned_record_ids: Array.from({ length: 31 }, (_, i) => String(i)),
          },
        })
      ).success
    ).toBe(false);
  });
  it('updates visibility only on accepted own memberships', async () => {
    const write = vi.fn(async () => ({ count: 1 }));
    mockDb({ staffMember: { updateMany: write, findMany: async () => [] } });
    await updateSalonProfileVisibility_IO({ userId: 'member', visible: false });
    expect(write).toHaveBeenCalledWith({
      where: { user_id: 'member', is_active: true, accepted_at: { not: null } },
      data: { public_profile_visible: false },
    });
  });
  it('member opting out has no salon backlink', async () => {
    const read = vi.fn(async () => null);
    mockDb({
      stylistAccount: {
        findUnique: async () => ({ ...owner, pricing_plan: 'FREE' }),
      },
      staffMember: { findFirst: read },
    });
    expect(
      await getStylistSalonLink_IO({
        userId: 'member',
        accountId: 'member-account',
      })
    ).toBeNull();
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ public_profile_visible: true }),
      })
    );
  });
  it('rejects foreign gallery ids without changing any row', async () => {
    const write = vi.fn(async () => owner);
    mockDb({
      stylistAccount: {
        findUnique: async () => owner,
        findMany: async () => [],
        update: write,
      },
      galleryRecord: { count: async () => 0 },
    });
    const result = await updateSalonProfile_IO({
      accountId: 'owner',
      body: {
        name: 'Salon',
        brand_accent_color: null,
        show_team: true,
        pinned_record_ids: ['foreign'],
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
    }
    expect(write).not.toHaveBeenCalled();
  });
  it('rechecks pin quota after acquiring owner lock when Scale downgrades to Studio', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ...owner, pricing_plan: 'SCALE' })
      .mockResolvedValue(owner);
    const write = vi.fn();
    mockDb({ stylistAccount: { findUnique: read, update: write } });
    const result = await updateSalonProfile_IO({
      accountId: 'owner',
      body: {
        name: 'Salon',
        brand_accent_color: null,
        show_team: true,
        pinned_record_ids: Array.from({ length: 31 }, (_, i) => String(i)),
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
    }
    expect(write).not.toHaveBeenCalled();
  });
  it('does not link an owner whose salon has no saved name: that public page answers 404', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          ...owner,
          salon_profile_name: null,
          business_name: 'Studio Bazowe',
        }),
      },
      staffMember: { findFirst: async () => null },
    });
    expect(
      await getStylistSalonLink_IO({ accountId: 'owner', userId: 'owner-user' })
    ).toBeNull();
  });
  it('links an owner once her salon has a saved name', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          ...owner,
          salon_profile_name: 'Studio Ani',
        }),
      },
    });
    expect(
      await getStylistSalonLink_IO({ accountId: 'owner', userId: 'owner-user' })
    ).toEqual(
      expect.objectContaining({
        account_id: 'owner',
        name: 'Studio Ani',
        role: 'owner',
      })
    );
  });
  it('owner can showcase a contributing member work without modifying her personal pins', async () => {
    const member = { ...owner, account_id: 'member', display_name: 'Maria' };
    const createPins = vi.fn(async () => ({ count: 1 }));
    const memberWork = {
      gallery_record_id: 'member-work',
      asset_url: 'https://example.com/member.jpg',
      created_by_account_id: 'member',
    };
    const count = vi.fn(async () => 1);
    mockDb({
      stylistAccount: {
        findUnique: async () => owner,
        findFirst: async () => owner,
        findMany: async () => [member],
        update: async () => owner,
      },
      galleryRecord: { count, findMany: async () => [memberWork] },
      salonShowcaseWork: {
        deleteMany: async () => ({ count: 0 }),
        createMany: createPins,
      },
    });
    const result = await updateSalonProfile_IO({
      accountId: 'owner',
      body: {
        name: 'Salon',
        brand_accent_color: null,
        show_team: true,
        pinned_record_ids: ['member-work'],
      },
    });
    expect(result.success).toBe(true);
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          created_by_account_id: { in: ['owner', 'member'] },
          is_hidden: false,
        }),
      })
    );
    expect(createPins).toHaveBeenCalledWith({
      data: [{ salon_account_id: 'owner', gallery_record_id: 'member-work' }],
      skipDuplicates: true,
    });
    if (result.success) {
      expect(result.data.works[0]?.author?.name).toBe('Maria');
    }
  });
  it('a retained showcase relation disappears from the read when its author opts out', async () => {
    let contributing = true;
    const member = { ...owner, account_id: 'member', display_name: 'Maria' };
    const members = vi.fn(async () => (contributing ? [member] : []));
    const records = vi.fn(
      async (query: { where: { created_by_account_id: { in: string[] } } }) =>
        query.where.created_by_account_id.in.includes('member')
          ? [
              {
                gallery_record_id: 'member-work',
                created_by_account_id: 'member',
                asset_url: 'https://example.com/member.jpg',
              },
            ]
          : []
    );
    mockDb({
      stylistAccount: { findFirst: async () => owner, findMany: members },
      galleryRecord: { findMany: records },
    });
    const before = await getSalonProfile_IO({ accountId: 'owner' });
    expect(before.success && before.data.works.length).toBe(1);
    contributing = false;
    const after = await getSalonProfile_IO({ accountId: 'owner' });
    expect(after.success && after.data.works.length).toBe(0);
    expect(members).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          created_by_user: expect.objectContaining({
            staff_memberships: {
              some: expect.objectContaining({
                public_profile_visible: true,
                is_active: true,
                accepted_at: { not: null },
              }),
            },
          }),
        }),
      })
    );
  });
  it('does not read showcase works when the owner plan ends between owner and contributor reads', async () => {
    const readOwner = vi
      .fn()
      .mockResolvedValueOnce(owner)
      .mockResolvedValue({ ...owner, subscription_status: 'CANCELED' });
    const records = vi.fn();
    mockDb({
      stylistAccount: { findFirst: readOwner },
      galleryRecord: { findMany: records },
    });
    expect((await getSalonProfile_IO({ accountId: 'owner' })).success).toBe(
      false
    );
    expect(records).not.toHaveBeenCalled();
  });
});
