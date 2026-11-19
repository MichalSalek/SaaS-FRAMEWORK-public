import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
import { getClientSalonGroups_IO } from './salon-client-groups.operations';
const account = {
  account_id: 'owner',
  display_name: 'Owner',
  business_name: null,
  avatar_url: null,
  salon_profile_name: 'Salon',
  salon_vanity_url: 'salon',
  pricing_plan: 'STUDIO',
  subscription_status: 'ACTIVE',
  payment_status: 'PAID',
  account_status: 'ACTIVE',
  account_expiration_date: null,
  created_by_user: { image: null },
};
describe('client salon addressees read model', () => {
  it('offers a contributing colleague without creating a contact and excludes inactive salons', async () => {
    const pairReads = vi
      .fn()
      .mockResolvedValueOnce([
        {
          stylist_account_id: 'owner',
          stylist_account: { created_by_user_id: 'owner-user' },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'pair',
          stylist_account_id: 'owner',
          status: 'ACTIVE',
          revoked_by: null,
        },
      ]);
    const ownerRead = vi.fn(async () => [
      {
        ...account,
        staff_members: [
          {
            user: {
              image: null,
              stylist_account: {
                ...account,
                account_id: 'member',
                display_name: 'Member',
              },
            },
          },
        ],
      },
      {
        ...account,
        account_id: 'free',
        pricing_plan: 'FREE',
        staff_members: [],
      },
    ]);
    mockDb({
      clientStylistPair: { findMany: pairReads },
      stylistAccount: { findMany: ownerRead },
    });
    const groups = await getClientSalonGroups_IO('client');
    expect(groups).toEqual([
      {
        account_id: 'owner',
        name: 'Salon',
        slug: 'salon',
        members: [
          {
            account_id: 'owner',
            name: 'Owner',
            avatar_url: null,
            pair_id: 'pair',
          },
          {
            account_id: 'member',
            name: 'Member',
            avatar_url: null,
            pair_id: null,
          },
        ],
      },
    ]);
    expect(ownerRead).toHaveBeenCalledTimes(1);
    expect(pairReads).toHaveBeenCalledTimes(2);
    expect(ownerRead).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          staff_members: expect.objectContaining({
            where: expect.objectContaining({
              is_active: true,
              accepted_at: { not: null },
              public_profile_visible: true,
            }),
          }),
        }),
      })
    );
  });
  it('solo client with no direct contacts gets no salon groups', async () => {
    mockDb({ clientStylistPair: { findMany: async () => [] } });
    expect(await getClientSalonGroups_IO('client')).toEqual([]);
  });
  it('keeps every Scale member and existing contact beyond the hundredth recipient', async () => {
    const staff = Array.from({ length: 101 }, (_, index) => ({
      user: {
        image: null,
        stylist_account: {
          ...account,
          account_id: `member-${index}`,
          display_name: `Member ${index}`,
        },
      },
    }));
    const pairReads = vi
      .fn()
      .mockResolvedValueOnce([
        {
          stylist_account_id: 'owner',
          stylist_account: { created_by_user_id: 'owner-user' },
        },
      ])
      .mockResolvedValueOnce(
        staff.map((member, index) => ({
          id: `pair-${index}`,
          stylist_account_id: member.user.stylist_account.account_id,
          status: 'ACTIVE',
          revoked_by: null,
        }))
      );
    const ownerRead = vi.fn(async (_args: unknown) => [
      { ...account, pricing_plan: 'SCALE', staff_members: staff },
    ]);
    mockDb({
      clientStylistPair: { findMany: pairReads },
      stylistAccount: { findMany: ownerRead },
    });
    const groups = await getClientSalonGroups_IO('client');
    expect(groups[0]?.members).toHaveLength(102);
    expect(groups[0]?.members[101]).toEqual(
      expect.objectContaining({ account_id: 'member-100', pair_id: 'pair-100' })
    );
    expect(ownerRead.mock.calls[0]?.[0]).not.toHaveProperty(
      'include.staff_members.take'
    );
    expect(pairReads.mock.calls[1]?.[0]).not.toHaveProperty('take');
  });
});
