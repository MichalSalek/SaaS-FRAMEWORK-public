import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
import { sendStaffInvitationNotification } from './salon-staff-invite-notification.service';
const { sendTransactionalEmail } = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(async (..._args: unknown[]) => true),
}));
vi.mock('@app/email-handler/email-transactional', () => ({
  sendTransactionalEmail,
}));
const invitation = {
  id: 'invite_test',
  email: 'new@example.com',
  accepted_at: null,
  declined_at: null,
  expires_at: new Date(Date.now() + 10000),
  salon: {
    business_name: 'Salon',
    salon_profile_name: null,
    display_name: 'Owner',
    created_by_user: { name: 'Anna' },
  },
};
const params = {
  staffMemberId: invitation.id,
  invitationToken: 'a'.repeat(43),
};
beforeEach(() => sendTransactionalEmail.mockClear());
describe('salon invitation delivery', () => {
  it('sends transactional invitation to an unregistered address', async () => {
    mockDb({
      salonInvitation: { findUnique: async () => invitation },
      user: { findFirst: async () => null },
    });
    await sendStaffInvitationNotification(params);
    expect(sendTransactionalEmail).toHaveBeenCalledOnce();
    const variables = sendTransactionalEmail.mock.calls[0]?.[3] as Record<
      string,
      string
    >;
    expect(variables['salonName']).toBe('Salon');
    expect(variables['inviterName']).toBe('Anna');
    expect(variables['invitationUrl']).toContain('/salon-invitation?token=');
  });
  it('owner with no name anywhere gets the nameless subject, never a leading blank', async () => {
    mockDb({
      salonInvitation: {
        findUnique: async () => ({
          ...invitation,
          salon: {
            business_name: null,
            salon_profile_name: '  ',
            display_name: null,
            created_by_user: { name: '' },
          },
        }),
      },
      user: { findFirst: async () => null },
    });
    await sendStaffInvitationNotification(params);
    const call = sendTransactionalEmail.mock.calls[0];
    const variables = call?.[3] as Record<string, string>;
    expect(variables['inviterName']).toBe('');
    expect(variables['salonName']).toBe('');
    expect(call?.[4]).toBe('email.salonStaffInvitation.subjectNoName');
  });
  it('a salon name stands in for an owner without a personal name', async () => {
    mockDb({
      salonInvitation: {
        findUnique: async () => ({
          ...invitation,
          salon: {
            business_name: null,
            salon_profile_name: 'Studio Ani',
            display_name: null,
            created_by_user: { name: '' },
          },
        }),
      },
      user: { findFirst: async () => null },
    });
    await sendStaffInvitationNotification(params);
    const call = sendTransactionalEmail.mock.calls[0];
    const variables = call?.[3] as Record<string, string>;
    expect(variables['inviterName']).toBe('Studio Ani');
    expect(variables['salonName']).toBe('Studio Ani');
    expect(call?.[4]).toBe('email.salonStaffInvitation.subject');
  });
  it('honors existing account activity consent', async () => {
    mockDb({
      salonInvitation: { findUnique: async () => invitation },
      user: {
        findFirst: async () => ({
          id: 'u',
          name: 'Anna',
          is_active: true,
          deleted_at: null,
          notifications_enabled: false,
        }),
      },
    });
    await sendStaffInvitationNotification(params);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
  it('does not email answered invitations', async () => {
    mockDb({
      salonInvitation: {
        findUnique: async () => ({ ...invitation, accepted_at: new Date() }),
      },
    });
    await sendStaffInvitationNotification(params);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
  it('does not email expired invitations', async () => {
    mockDb({
      salonInvitation: {
        findUnique: async () => ({ ...invitation, expires_at: new Date(0) }),
      },
    });
    await sendStaffInvitationNotification(params);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
  it('fails closed if database consent read fails', async () => {
    mockDb({
      salonInvitation: {
        findUnique: async () => {
          throw new Error('database unavailable');
        },
      },
    });
    await expect(
      sendStaffInvitationNotification(params)
    ).resolves.toBeUndefined();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
