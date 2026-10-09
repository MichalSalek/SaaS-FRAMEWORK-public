/**
 * Salon-team invitation mail to the INVITED stylist: "X zaprasza Cię do zespołu
 * salonu", with a CTA to her invitations screen (accept / decline).
 *
 * Activity mail: the invitee's `notifications_enabled` decides, fail closed
 * (activity-email-consent.ts). Best-effort, never throws: the invitation row is
 * already committed and the invitations screen shows it without the mail. Called
 * post-response via runAfterResponse from the invite handler, like the messaging
 * notification (no event bus, so nothing depends on the boot-time listener
 * registry). The payload is only the StaffMember id: addresses and names are read
 * here, so no PII travels through the handler.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import {
  ACTIVITY_CONSENT_SELECT,
  acceptsActivityEmail,
} from '@app/email-handler/activity-email-consent';
import { resolveInviterName } from '@domain/salon-staff/salon-staff.utils';

export const sendStaffInvitationNotification = async (params: {
  staffMemberId: string;
}): Promise<void> => {
  try {
    const invitation = await DB_CLIENT.use.staffMember.findUnique({
      where: { id: params.staffMemberId },
      select: {
        user_id: true,
        accepted_at: true,
        is_active: true,
        user: {
          select: { email: true, name: true, ...ACTIVITY_CONSENT_SELECT },
        },
        stylist_account: {
          select: {
            display_name: true,
            business_name: true,
            created_by_user: { select: { name: true } },
          },
        },
      },
    });
    // Gone (she declined, or the owner removed the row before the mail went out)
    // or already answered: nothing to invite to any more.
    if (
      !invitation ||
      !invitation.is_active ||
      invitation.accepted_at !== null
    ) {
      return;
    }
    if (!invitation.user.email || !acceptsActivityEmail(invitation.user)) {
      return;
    }
    // A subject that starts with an empty name reads as a broken system mail.
    // Unreachable in practice (Studio onboarding requires display_name), so skip
    // rather than invent a name; the invitation still waits on her screen.
    const inviterName = resolveInviterName(invitation.stylist_account);
    if (inviterName === '') {
      return;
    }

    await sendTransactionalEmail(
      'salon-staff-invitation',
      {
        email: invitation.user.email,
        name: invitation.user.name ?? '',
        id: invitation.user_id,
      },
      APP_EVENTS.INFO.EMAIL.EMAIL_SALON_STAFF_INVITATION_SENT,
      {
        inviterName,
        appUrl: `${BRAND_CONFIG.url}${ROUTES_FRONT.SALON_INVITATIONS}`,
      },
      'email.salonStaffInvitation.subject'
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
