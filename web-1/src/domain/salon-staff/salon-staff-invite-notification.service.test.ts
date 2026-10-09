/**
 * sendStaffInvitationNotification — the invitee's activity-mail gate.
 *
 * notifications_enabled decides (fail closed), an answered or removed invitation
 * gets no mail, and the mail carries the inviter's name plus a CTA to the
 * invitee's invitations screen.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

import { sendStaffInvitationNotification } from './salon-staff-invite-notification.service';

const { sendTransactionalEmail } = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(async (..._args: unknown[]) => true),
}));
vi.mock('@app/email-handler/email-transactional', () => ({
  sendTransactionalEmail,
}));

const STAFF_ID = 'stf_0000000000000000001';

const invitation = (
  overrides: {
    accepted_at?: Date | null;
    is_active?: boolean;
    user?: Partial<{
      email: string;
      name: string | null;
      notifications_enabled: boolean;
      is_active: boolean;
      deleted_at: Date | null;
    }>;
    display_name?: string | null;
  } = {}
) => ({
  user_id: 'usr_invitee_000000000001',
  accepted_at: overrides.accepted_at ?? null,
  is_active: overrides.is_active ?? true,
  user: {
    email: 'nowa@example.com',
    name: 'Kasia',
    notifications_enabled: true,
    is_active: true,
    deleted_at: null,
    ...overrides.user,
  },
  stylist_account: {
    display_name:
      overrides.display_name === undefined
        ? 'Ola Nails'
        : overrides.display_name,
    business_name: null,
    created_by_user: { name: null },
  },
});

const installInvitation = (row: ReturnType<typeof invitation> | null) =>
  mockDb({ staffMember: { findUnique: async () => row } });

describe('sendStaffInvitationNotification', () => {
  beforeEach(() => {
    sendTransactionalEmail.mockClear();
  });

  it('sends the invitation mail with the inviter name and a CTA to the invitations screen', async () => {
    installInvitation(invitation());

    await sendStaffInvitationNotification({ staffMemberId: STAFF_ID });

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    const call = sendTransactionalEmail.mock.calls[0] as unknown as [
      string,
      { email: string },
      string,
      Record<string, string>,
      string,
    ];
    expect(call[0]).toBe('salon-staff-invitation');
    expect(call[1].email).toBe('nowa@example.com');
    expect(call[2]).toBe(
      APP_EVENTS.INFO.EMAIL.EMAIL_SALON_STAFF_INVITATION_SENT
    );
    expect(call[3]['inviterName']).toBe('Ola Nails');
    expect(call[3]['appUrl']).toMatch(
      new RegExp(`${ROUTES_FRONT.SALON_INVITATIONS}$`)
    );
    expect(call[4]).toBe('email.salonStaffInvitation.subject');
  });

  it('notifications_enabled=false → no mail', async () => {
    installInvitation(invitation({ user: { notifications_enabled: false } }));

    await sendStaffInvitationNotification({ staffMemberId: STAFF_ID });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('a soft-deleted invitee → no mail', async () => {
    installInvitation(
      invitation({ user: { is_active: false, deleted_at: new Date() } })
    );

    await sendStaffInvitationNotification({ staffMemberId: STAFF_ID });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('the consent cannot be read → fail closed, no mail and no throw', async () => {
    mockDb({
      staffMember: {
        findUnique: async () => {
          throw new Error('db down');
        },
      },
    });

    await expect(
      sendStaffInvitationNotification({ staffMemberId: STAFF_ID })
    ).resolves.toBeUndefined();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('declined or removed before the mail went out → no mail', async () => {
    installInvitation(null);

    await sendStaffInvitationNotification({ staffMemberId: STAFF_ID });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('already accepted → no mail', async () => {
    installInvitation(invitation({ accepted_at: new Date() }));

    await sendStaffInvitationNotification({ staffMemberId: STAFF_ID });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it('no inviter name at all → no mail with a broken subject', async () => {
    installInvitation(invitation({ display_name: null }));

    await sendStaffInvitationNotification({ staffMemberId: STAFF_ID });

    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
