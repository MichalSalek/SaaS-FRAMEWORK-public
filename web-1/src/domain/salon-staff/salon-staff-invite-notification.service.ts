import {
  salonDisplayName,
  stylistDisplayName,
} from '@kernel/domain/salon-profile/salon-names';
/** Transactional invitation for unknown addresses; existing users retain activity-email consent.
 * The bell and invitation list are independent of email consent. Token never authenticates.
 */
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import {
  ACTIVITY_CONSENT_SELECT,
  acceptsActivityEmail,
} from '@app/email-handler/activity-email-consent';

export const sendStaffInvitationNotification = async (params: {
  staffMemberId: string;
  invitationToken?: string;
}): Promise<void> => {
  try {
    if (!params.invitationToken) {
      return;
    }
    const invitation = await DB_CLIENT.use.salonInvitation.findUnique({
      where: { id: params.staffMemberId },
      include: {
        salon: {
          select: {
            business_name: true,
            salon_profile_name: true,
            display_name: true,
            created_by_user: { select: { name: true } },
          },
        },
      },
    });
    if (
      !invitation ||
      invitation.accepted_at ||
      invitation.declined_at ||
      invitation.expires_at <= new Date()
    ) {
      return;
    }
    const user = await DB_CLIENT.use.user.findFirst({
      where: { email: invitation.email },
      select: { id: true, name: true, ...ACTIVITY_CONSENT_SELECT },
    });
    if (user && !acceptsActivityEmail(user)) {
      return;
    }
    // DECISION: the inviter is the owner as a person, else any name the salon has, so the inviter and the salon name are
    // blank TOGETHER or not at all. Both blank (role-only onboarding, owner, User.name '' after a magic link)
    // selects the nameless subject and first sentence; a mail must never open with a blank (" zaprasza Cię do zespołu
    // salonu").
    const salonName = salonDisplayName(invitation.salon).trim();
    const inviterName =
      invitation.salon.created_by_user?.name?.trim() ||
      stylistDisplayName(invitation.salon).trim() ||
      salonName;
    await sendTransactionalEmail(
      'salon-staff-invitation',
      {
        email: invitation.email,
        name: user?.name || '',
        ...(user && { id: user.id }),
      },
      APP_EVENTS.INFO.EMAIL.EMAIL_SALON_STAFF_INVITATION_SENT,
      {
        inviterName,
        salonName: salonName || inviterName,
        invitationUrl: `${BRAND_CONFIG.url}/salon-invitation?token=${encodeURIComponent(params.invitationToken)}`,
      },
      inviterName
        ? 'email.salonStaffInvitation.subject'
        : 'email.salonStaffInvitation.subjectNoName'
    );
  } catch (error) {
    reportIssueBackend({
      namespace: 'SALON_STAFF_INVITATION_NOTIFICATION_FAILED',
      message:
        error instanceof Error
          ? error.message
          : 'salon staff invitation notification failed',
      payload: { staffMemberId: params.staffMemberId },
      mode: 'error',
    });
  }
};
