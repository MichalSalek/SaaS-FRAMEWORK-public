import { finishFreeForSalonAccess_IO } from '@domain/email/operations/free-email.salon-access';
vi.mock('@domain/email/operations/free-email.salon-access', () => ({
  finishFreeForSalonAccess_IO: vi.fn(async () => undefined),
}));
import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
import {
  createInvitationToken,
  hashInvitationToken,
  acceptSalonInvitationToken_IO,
} from './salon-invitation-token.service';
const token = 'a'.repeat(43);
const row = (overrides = {}) => ({
  id: 'inv_test',
  email: 'stylist@example.com',
  expires_at: new Date(Date.now() + 10000),
  accepted_at: null,
  declined_at: null,
  salon: {
    business_name: 'Salon',
    display_name: 'Owner',
    created_by_user: { is_active: true, disabled_at: null },
  },
  ...overrides,
});
describe('salon invitation tokens', () => {
  it('uses random 256-bit tokens and SHA-256 hashes', () => {
    const a = createInvitationToken();
    expect(a).toHaveLength(43);
    expect(a).not.toBe(createInvitationToken());
    expect(hashInvitationToken(a)).toHaveLength(64);
  });
  it('rejects malformed tokens before DB reads', async () => {
    mockDb({});
    expect(await acceptSalonInvitationToken_IO({ token: 'bad' })).toEqual({
      success: false,
      error: { type: 'VALIDATION_ERROR', field: 'token', message: 'INVALID' },
    });
  });
  it('rejects expired tokens', async () => {
    const update = vi.fn();
    mockDb({
      salonInvitation: {
        findUnique: async () => row({ expires_at: new Date(0) }),
        updateMany: update,
      },
    });
    expect(await acceptSalonInvitationToken_IO({ token })).toEqual({
      success: false,
      error: { type: 'VALIDATION_ERROR', field: 'token', message: 'INVALID' },
    });
    expect(update).not.toHaveBeenCalled();
  });
  it('refuses a different signed-in email', async () => {
    const update = vi.fn();
    mockDb({
      salonInvitation: { findUnique: async () => row(), updateMany: update },
    });
    expect(
      await acceptSalonInvitationToken_IO({
        token,
        currentEmail: 'other@example.com',
      })
    ).toEqual({
      success: false,
      error: {
        type: 'VALIDATION_ERROR',
        field: 'token',
        message: 'WRONG_EMAIL',
      },
    });
    expect(update).not.toHaveBeenCalled();
  });
  it('accepts an unknown address without session or user creation', async () => {
    const create = vi.fn();
    let reads = 0;
    mockDb({
      salonInvitation: {
        findUnique: async () =>
          ++reads === 1
            ? row()
            : { accepted_at: new Date(), declined_at: null },
        updateMany: async () => ({ count: 1 }),
      },
      user: { findFirst: async () => null, create },
      session: { create },
    });
    expect((await acceptSalonInvitationToken_IO({ token })).success).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
  it('replaying accepted consent is idempotent after expiry', async () => {
    mockDb({
      salonInvitation: {
        findUnique: async () =>
          row({ accepted_at: new Date(), expires_at: new Date(0) }),
        updateMany: async () => ({ count: 0 }),
      },
      user: { findFirst: async () => null },
    });
    expect((await acceptSalonInvitationToken_IO({ token })).success).toBe(true);
  });
  it('declined tokens cannot accept', async () => {
    mockDb({
      salonInvitation: {
        findUnique: async () => row({ declined_at: new Date() }),
      },
    });
    expect(await acceptSalonInvitationToken_IO({ token })).toEqual({
      success: false,
      error: { type: 'VALIDATION_ERROR', field: 'token', message: 'INVALID' },
    });
  });
});

describe('accepted invitation attachment', () => {
  it('waits while the user has only a client account', async () => {
    const findMany = vi.fn();
    mockDb({
      user: {
        findUnique: async () => ({
          email: 'stylist@example.com',
          is_active: true,
          disabled_at: null,
          stylist_account: null,
        }),
      },
      salonInvitation: { findMany },
    });
    const { attachAcceptedSalonInvitations_IO } =
      await import('./salon-invitation-token.service');
    await attachAcceptedSalonInvitations_IO('user_test');
    expect(findMany).not.toHaveBeenCalled();
  });
  it('attaches accepted consent after stylist onboarding', async () => {
    const invitation = {
      id: 'invite_test',
      salon_account_id: 'salon_test',
      email: 'stylist@example.com',
      accepted_at: new Date(),
      declined_at: null,
      attached_user_id: null,
      role: 'EMPLOYEE',
    };
    const create = vi.fn(async (..._args: unknown[]) => ({ id: 'staff_test' }));
    const update = vi.fn(async (..._args: unknown[]) => ({ count: 1 }));
    mockDb({
      user: {
        findUnique: async () => ({
          email: invitation.email,
          is_active: true,
          disabled_at: null,
          stylist_account: { account_id: 'own_test' },
        }),
      },
      salonInvitation: {
        findMany: async () => [invitation],
        findUnique: async () => invitation,
        update,
      },
      stylistAccount: {
        findFirst: async () => ({ created_by_user_id: 'owner_test' }),
      },
      staffMember: { findUnique: async () => null, create },
    });
    const { attachAcceptedSalonInvitations_IO } =
      await import('./salon-invitation-token.service');
    await attachAcceptedSalonInvitations_IO('user_test');
    expect(create).toHaveBeenCalledOnce();
    expect(finishFreeForSalonAccess_IO).toHaveBeenCalledWith(
      expect.anything(),
      'salon_test',
      'user_test'
    );
    expect(create.mock.calls[0]?.[0]).toEqual({
      data: expect.objectContaining({
        user_id: 'user_test',
        accepted_at: invitation.accepted_at,
      }),
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: invitation.id },
      data: { attached_user_id: 'user_test' },
    });
  });
  it('quiet decline removes an attached membership atomically', async () => {
    const invitation = {
      ...row(),
      salon_account_id: 'salon_test',
      attached_user_id: 'user_test',
      accepted_at: new Date(),
    };
    const remove = vi.fn(async (..._args: unknown[]) => ({ count: 1 }));
    mockDb({
      salonInvitation: {
        findUnique: async () => invitation,
        updateMany: async () => ({ count: 1 }),
      },
      staffMember: { deleteMany: remove },
    });
    expect(
      (await acceptSalonInvitationToken_IO({ token, response: 'DECLINE' }))
        .success
    ).toBe(true);
    expect(remove).toHaveBeenCalledWith({
      where: { stylist_account_id: 'salon_test', user_id: 'user_test' },
    });
  });
});
