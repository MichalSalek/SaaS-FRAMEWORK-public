import { describe, it, expect, vi } from 'vitest';
import { geocodeAddress } from '@app/maps/geocoding.utils';
import { salonProfileUpdateSchema } from '@kernel/models/salon-profile/salon-profile.validation';
import { mockDb } from '../../test-utils/mockApiHandler';
import {
  getSalonProfile_IO,
  updateSalonProfile_IO,
} from './salon-profile.operations';

vi.mock('@app/maps/geocoding.utils', () => ({
  geocodeAddress: vi.fn(async () => ({ latitude: 50.06, longitude: 19.94 })),
}));
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
  avatar_url: null,
  vanity_url: 'anna',
  created_by_user: { image: null },
  address_city: 'Warszawa',
  address_country: 'PL',
  website: null,
  instagram_handle: null,
  phone: null,
};
describe('salon settings ownership and retention', () => {
  it('rejects unsafe links and malformed contact without accepting arbitrary account fields', () => {
    const base = {
      name: 'Salon',
      brand_accent_color: null,
      show_team: true,
      pinned_record_ids: [],
    };
    expect(
      salonProfileUpdateSchema.safeParse({
        ...base,
        contact: { website: 'javascript:alert(1)' },
      }).success
    ).toBe(false);
    expect(
      salonProfileUpdateSchema.safeParse({
        ...base,
        contact: { phone: 'call me' },
      }).success
    ).toBe(false);
    expect(
      salonProfileUpdateSchema.safeParse({
        ...base,
        contact: { instagram_handle: '@salon' },
      }).success
    ).toBe(false);
    const parsed = salonProfileUpdateSchema.parse({
      ...base,
      contact: { address_city: 'Kraków', pricing_plan: 'SCALE' },
    });
    expect(parsed.contact).toEqual({ address_city: 'Kraków' });
    expect(
      salonProfileUpdateSchema.safeParse({
        ...base,
        contact: { address_street: 'ul. Mokotowska 12' },
      }).success
    ).toBe(true);
    expect(salonProfileUpdateSchema.safeParse({}).success).toBe(false);
    expect(salonProfileUpdateSchema.safeParse({ contact: {} }).success).toBe(
      false
    );
    expect(
      salonProfileUpdateSchema.safeParse({ show_team: false }).success
    ).toBe(true);
    expect(
      salonProfileUpdateSchema.safeParse({
        pinned_record_ids: ['same', 'same'],
      }).success
    ).toBe(false);
    const withStreet = salonProfileUpdateSchema.parse({
      ...base,
      contact: {
        address_city: 'Kraków',
        address_street: 'ul. Mokotowska 12',
      },
    });
    expect(withStreet.contact).toEqual({
      address_city: 'Kraków',
      address_street: 'ul. Mokotowska 12',
    });
  });
  it('inactive owner can read preserved settings while the public profile stays unavailable', async () => {
    const inactive = {
      ...owner,
      pricing_plan: 'FREE',
      subscription_status: 'CANCELED',
    };
    mockDb({
      stylistAccount: {
        findFirst: async () => inactive,
        findMany: async () => [],
      },
      galleryRecord: { findMany: async () => [] },
    });
    expect((await getSalonProfile_IO({ accountId: 'owner' })).success).toBe(
      false
    );
    const result = await getSalonProfile_IO({
      accountId: 'owner',
      management: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_active).toBe(false);
      expect(result.data.name_configured).toBe(true);
      expect(result.data.name).toBe('Salon');
      expect(result.data.contact.address_country).toBe('PL');
    }
  });
  it('a partial team edit preserves contact and saved pins', async () => {
    const write = vi.fn(async () => owner);
    const deletePins = vi.fn(async () => ({ count: 0 }));
    mockDb({
      stylistAccount: {
        findUnique: async () => owner,
        findFirst: async () => owner,
        findMany: async () => [],
        update: write,
      },
      galleryRecord: { count: async () => 0, findMany: async () => [] },
      salonShowcaseWork: { deleteMany: deletePins },
    });
    const result = await updateSalonProfile_IO({
      accountId: 'owner',
      body: { show_team: false },
    });
    expect(result.success).toBe(true);
    expect(write).toHaveBeenCalledWith({
      where: { account_id: 'owner' },
      data: { salon_show_team: false },
    });
    expect(deletePins).not.toHaveBeenCalled();
  });
  it('saves contact together with the salon settings on the owner row', async () => {
    const write = vi.fn(async (_args: unknown) => owner);
    mockDb({
      stylistAccount: {
        findUnique: async () => owner,
        findFirst: async () => owner,
        findMany: async () => [],
        update: write,
      },
      galleryRecord: { count: async () => 0, findMany: async () => [] },
      salonShowcaseWork: { deleteMany: async () => ({ count: 0 }) },
    });
    const contact = {
      address_city: 'Kraków',
      address_country: 'DE' as const,
      pricing_plan: 'SCALE',
      website: 'https://example.com',
      instagram_handle: 'salon',
      phone: '+48 123 456 789',
    };
    const result = await updateSalonProfile_IO({
      accountId: 'owner',
      body: {
        name: 'Salon',
        brand_accent_color: null,
        show_team: true,
        pinned_record_ids: [],
        contact,
      },
    });
    expect(result.success).toBe(true);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { account_id: 'owner' },
        data: expect.objectContaining({
          address_city: contact.address_city,
          address_country: contact.address_country,
          website: contact.website,
          instagram_handle: contact.instagram_handle,
          phone: contact.phone,
        }),
      })
    );
    expect(write.mock.calls[0]?.[0]).not.toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ pricing_plan: 'SCALE' }),
      })
    );
    expect(geocodeAddress).toHaveBeenCalled();
  });
  it('refuses a street when the salon has no city and writes nothing', async () => {
    const write = vi.fn(async () => owner);
    mockDb({
      stylistAccount: {
        findUnique: async () => ({ ...owner, address_city: null }),
        findFirst: async () => owner,
        findMany: async () => [],
        update: write,
      },
      galleryRecord: { count: async () => 0, findMany: async () => [] },
      salonShowcaseWork: { deleteMany: async () => ({ count: 0 }) },
    });
    const result = await updateSalonProfile_IO({
      accountId: 'owner',
      body: {
        name: 'Salon',
        brand_accent_color: null,
        show_team: true,
        pinned_record_ids: [],
        contact: { address_street: 'ul. Mokotowska 12' },
      },
    });
    expect(result.success).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
  it('revalidates the merged partial address against the locked row', async () => {
    const write = vi.fn(async () => owner);
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(owner)
      .mockResolvedValueOnce({ ...owner, address_city: 'A' });
    mockDb({
      stylistAccount: { findUnique, update: write },
      galleryRecord: { count: async () => 0 },
      salonShowcaseWork: { deleteMany: async () => ({ count: 0 }) },
    });
    const result = await updateSalonProfile_IO({
      accountId: 'owner',
      body: { contact: { address_street: 'Długa 1' } },
    });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'VALIDATION_ERROR', field: 'address_city' },
    });
    expect(write).not.toHaveBeenCalled();
  });
  it('clears stored coordinates when the city is removed', async () => {
    vi.mocked(geocodeAddress).mockClear();
    const write = vi.fn(async () => owner);
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          ...owner,
          address_street: 'Ul. Długa 1',
          address_city: 'Warszawa',
          latitude: 52.23,
          longitude: 21.01,
        }),
        findFirst: async () => owner,
        findMany: async () => [],
        update: write,
      },
      galleryRecord: { count: async () => 0, findMany: async () => [] },
      salonShowcaseWork: { deleteMany: async () => ({ count: 0 }) },
    });
    const result = await updateSalonProfile_IO({
      accountId: 'owner',
      body: {
        name: 'Salon',
        brand_accent_color: null,
        show_team: true,
        pinned_record_ids: [],
        contact: { address_city: null, address_street: null },
      },
    });
    expect(result.success).toBe(true);
    expect(geocodeAddress).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          address_city: null,
          address_street: null,
          latitude: null,
          longitude: null,
        }),
      })
    );
  });
});
