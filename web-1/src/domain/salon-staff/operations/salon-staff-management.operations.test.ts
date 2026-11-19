import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  inviteStaffMember_IO,
  removeStaffMember_IO,
  updateStaffPermissions_IO,
} from './salon-staff-management.operations';
const accountId = 'salon_test';
const invitation = {
  id: 'invite_test',
  salon_account_id: accountId,
  email: 'new@example.com',
  role: 'EMPLOYEE',
  created_at: new Date(),
  accepted_at: null,
  declined_at: null,
};
const input = {
  accountId,
  email: invitation.email,
  role: 'EMPLOYEE' as const,
  pricingPlan: 'STUDIO' as const,
};
const install = (
  members = 0,
  pending = 0,
  recent = 0,
  currentPlan: 'STUDIO' | 'FREE' = 'STUDIO'
) => {
  const create = vi.fn(async () => invitation);
  mockDb({
    clientStylistPair: { findMany: async () => [] },
    stylistAccount: {
      findUnique: async () => ({
        paid_staff_seats: 0,
        pricing_plan: currentPlan,
        created_by_user: { email: 'owner@example.com' },
      }),
    },
    staffMember: {
      count: async () => members,
      findFirst: async () => null,
      deleteMany: async () => ({ count: 0 }),
    },
    salonInvitation: {
      findFirst: async () => null,
      count: async ({ where }: { where: { created_at?: unknown } }) =>
        where.created_at !== undefined ? recent : pending,
      create,
      updateMany: async () => ({ count: 0 }),
    },
  });
  return create;
};
describe('email salon invitations', () => {
  it('refuses a stale Studio request after the salon has downgraded', async () => {
    const create = install(0, 0, 0, 'FREE');
    const result = await inviteStaffMember_IO(input);
    expect(result).toMatchObject({
      success: false,
      error: { type: 'SALON_STAFF_LIMIT_REACHED', planType: 'FREE' },
    });
    expect(create).not.toHaveBeenCalled();
  });
  it('accepts a stale Free request when the locked salon is already Studio', async () => {
    const create = install();
    expect(
      (await inviteStaffMember_IO({ ...input, pricingPlan: 'FREE' })).success
    ).toBe(true);
    expect(create).toHaveBeenCalledOnce();
  });
  it('accepts any address without looking up its account', async () => {
    const create = install();
    const result = await inviteStaffMember_IO(input);
    expect(result.success).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    if (result.success) {
      expect(result.data.staff.user?.name).toBeNull();
      expect(result.data.invitationToken).toHaveLength(43);
    }
  });
  it('counts existing memberships including inactive user accounts', async () => {
    const create = install(9);
    const result = await inviteStaffMember_IO(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SALON_STAFF_LIMIT_REACHED');
    }
    expect(create).not.toHaveBeenCalled();
  });
  it('counts reserved email invitations against seats', async () => {
    const create = install(8, 1);
    expect((await inviteStaffMember_IO(input)).success).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
  it('rate limits per salon', async () => {
    const create = install(0, 0, 20);
    const result = await inviteStaffMember_IO(input);
    expect(result.success).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
  it('refuses owner self invitation', async () => {
    install();
    const result = await inviteStaffMember_IO({
      ...input,
      email: 'OWNER@example.com',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SALON_STAFF_SELF_INVITE');
    }
  });
  it('refuses privilege escalation', async () => {
    expect(
      (await inviteStaffMember_IO({ ...input, role: 'OWNER' })).success
    ).toBe(false);
  });
  it('owner removal is idempotent with invitation cancellation', async () => {
    install();
    expect(
      await removeStaffMember_IO({
        staffId: invitation.id,
        accountId,
        pricingPlan: 'FREE',
      })
    ).toEqual({ success: true, data: { success: true } });
  });
});

it('returns the profile name after a permissions update without adding a profile link', async () => {
  const findUnique = vi.fn(async (..._args: unknown[]) => ({
    id: 'staff',
    stylist_account_id: accountId,
    user_id: 'member',
    role: 'EMPLOYEE',
    permissions: [],
    is_active: true,
    invited_at: new Date('2026-08-01T00:00:00Z'),
    accepted_at: new Date('2026-08-02T00:00:00Z'),
    user: {
      id: 'member',
      name: '',
      email: 'member@example.com',
      image: null,
      stylist_account: { display_name: 'Profile name', business_name: null },
    },
  }));
  mockDb({
    staffMember: { updateMany: async () => ({ count: 1 }), findUnique },
  });
  const result = await updateStaffPermissions_IO({
    staffId: 'staff',
    accountId,
    pricingPlan: 'STUDIO',
    role: 'MANAGER',
  });
  expect(result.success).toBe(true);
  expect(findUnique.mock.calls[0]?.[0]).toMatchObject({
    include: {
      user: {
        select: {
          stylist_account: {
            select: { display_name: true, business_name: true },
          },
        },
      },
    },
  });
  if (result.success) {
    expect(result.data.staff.user?.name).toBe('Profile name');
    expect(result.data.staff.public_profile_id).toBeUndefined();
  }
});
