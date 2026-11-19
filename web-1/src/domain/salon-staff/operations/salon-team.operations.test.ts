import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { getMySalonTeams_IO, leaveSalonTeam_IO } from './salon-team.operations';
describe('salon team member access', () => {
  it.each([
    [
      'active Studio',
      {
        pricing_plan: 'STUDIO',
        subscription_status: 'ACTIVE',
        payment_status: 'PAID',
        account_status: 'ACTIVE',
        account_expiration_date: null,
      },
      true,
    ],
    [
      'downgraded salon',
      {
        pricing_plan: 'FREE',
        subscription_status: 'CANCELED',
        payment_status: 'UNPAID',
        account_status: 'ACTIVE',
        account_expiration_date: new Date('2026-11-09'),
      },
      false,
    ],
    [
      'inactive owner account',
      {
        pricing_plan: 'STUDIO',
        subscription_status: 'ACTIVE',
        payment_status: 'PAID',
        account_status: 'EXPIRED',
        account_expiration_date: null,
      },
      false,
    ],
    [
      'expired Studio',
      {
        pricing_plan: 'STUDIO',
        subscription_status: 'ACTIVE',
        payment_status: 'PAID',
        account_status: 'ACTIVE',
        account_expiration_date: new Date('2000-01-01'),
      },
      false,
    ],
    [
      'trial Studio',
      {
        pricing_plan: 'STUDIO',
        subscription_status: 'TRIALING',
        payment_status: 'UNPAID',
        account_status: 'ACTIVE',
        account_expiration_date: null,
      },
      true,
    ],
  ])(
    'reports gallery availability for %s without removing membership',
    async (_label, account, expected) => {
      mockDb({
        clientStylistPair: { findMany: async () => [] },
        user: { findUnique: async () => null },
        staffMember: {
          findMany: async () => [
            {
              stylist_account: {
                ...account,
                account_id: 'salon',
                salon_profile_name: 'Salon',
                display_name: 'Owner',
                business_name: null,
                created_by_user: {
                  id: 'owner',
                  name: 'Owner',
                  image: null,
                  avatar_url: null,
                },
                staff_members: [],
              },
            },
          ],
        },
      });
      const result = await getMySalonTeams_IO('member');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.teams).toHaveLength(1);
        expect(result.data.teams[0]).toHaveProperty(
          'gallery_available',
          expected
        );
      }
    }
  );
  it('reads only session user accepted membership with alive owner', async () => {
    const findMany = vi.fn(async (..._args: unknown[]) => [
      {
        stylist_account: {
          account_id: 'salon',
          account_status: 'ACTIVE',
          pricing_plan: 'STUDIO',
          subscription_status: 'ACTIVE',
          payment_status: 'PAID',
          account_expiration_date: null,
          business_name: 'Salon',
          salon_profile_name: 'Salon brand',
          display_name: 'Owner',
          created_by_user: { id: 'owner', name: null, image: null },
          staff_members: [
            {
              id: 'staff',
              role: 'EMPLOYEE',
              user: {
                id: 'member',
                name: '',
                image: null,
                stylist_account: {
                  account_id: 'profile',
                  account_status: 'ACTIVE',
                  avatar_url: null,
                  display_name: 'Ala Profile',
                  business_name: 'Ala Business',
                },
              },
            },
          ],
        },
      },
    ]);
    mockDb({
      clientStylistPair: { findMany: async () => [] },
      user: { findUnique: async () => null },
      staffMember: { findMany },
    });
    const result = await getMySalonTeams_IO('member');
    expect(result.success).toBe(true);
    expect(findMany.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: 'member',
          accepted_at: { not: null },
          is_active: true,
        }),
      })
    );
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      select: {
        stylist_account: {
          select: {
            staff_members: {
              select: {
                user: {
                  select: {
                    stylist_account: {
                      select: { display_name: true, business_name: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (result.success) {
      expect(result.data.teams[0]?.salon_name).toBe('Salon brand');
      expect(result.data.teams[0]?.owner.name).toBe('Owner');
      expect(result.data.teams[0]?.members[0]?.name).toBe('Ala Profile');
      expect(result.data.teams[0]?.members[0]?.public_profile_id).toBe(
        'profile'
      );
    }
  });
  it('falls back to account names for an owner and member without profile names', async () => {
    mockDb({
      clientStylistPair: { findMany: async () => [] },
      user: { findUnique: async () => null },
      staffMember: {
        findMany: async () => [
          {
            stylist_account: {
              account_id: 'salon',
              account_status: 'ACTIVE',
              pricing_plan: 'STUDIO',
              subscription_status: 'ACTIVE',
              payment_status: 'PAID',
              account_expiration_date: null,
              display_name: null,
              business_name: null,
              created_by_user: {
                id: 'owner',
                name: 'Owner legacy',
                image: null,
              },
              staff_members: [
                {
                  id: 'staff',
                  role: 'EMPLOYEE',
                  user: {
                    id: 'member',
                    name: 'Member legacy',
                    image: null,
                    stylist_account: {
                      account_id: 'profile',
                      account_status: 'ACTIVE',
                      display_name: null,
                      business_name: null,
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    });
    const result = await getMySalonTeams_IO('member');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.teams[0]?.owner.name).toBe('Owner legacy');
      expect(result.data.teams[0]?.members[0]?.name).toBe('Member legacy');
    }
  });
  it('leave removes only the caller membership and prevents invitation reattachment', async () => {
    const remove = vi.fn(async (..._args: unknown[]) => ({ count: 1 }));
    const cancel = vi.fn(async (..._args: unknown[]) => ({ count: 1 }));
    mockDb({
      clientStylistPair: { findMany: async () => [] },
      staffMember: { deleteMany: remove },
      salonInvitation: { updateMany: cancel },
    });
    expect((await leaveSalonTeam_IO('member', 'salon')).success).toBe(true);
    expect(remove).toHaveBeenCalledWith({
      where: {
        user_id: 'member',
        stylist_account_id: 'salon',
        accepted_at: { not: null },
      },
    });
    expect(cancel.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        where: { attached_user_id: 'member', salon_account_id: 'salon' },
      })
    );
  });
  it('keeps accepted client-only invitation pending and tells her which salon awaits activation', async () => {
    mockDb({
      clientStylistPair: { findMany: async () => [] },
      user: {
        findUnique: async () => ({
          id: 'client',
          email: 'CLIENT@example.com',
          stylist_account: null,
        }),
      },
      staffMember: { findMany: async () => [] },
      salonInvitation: {
        findMany: async () => [
          {
            salon: {
              salon_profile_name: 'Salon',
              business_name: null,
              display_name: 'Anna',
            },
          },
        ],
      },
    });
    const result = await getMySalonTeams_IO('client');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.awaiting_stylist_salon_names).toEqual(['Salon']);
    }
  });
});
