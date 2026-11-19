/**
 * SALON_STAFF_INVITED → the invited person, when the address already belongs
 * to an account: „Zaproszenie do zespołu salonu {salon}”. The invitation is
 * addressed to the PERSON (recipient_role null: visible in either mode), the
 * same rule as the invitations screen and the drawer badge. An unknown
 * address gets the e-mail only; the row has nobody to belong to yet.
 */
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  salonDisplayName,
  stylistDisplayName,
} from '@kernel/domain/salon-profile/salon-names';
import { NotificationTypeValue } from '@kernel/models/notifications/notifications.dto';
import { DB_CLIENT } from '@app/db/db.client';
import { subscribeToInfoEvent } from '@app/events/event-bus';
import { notifyUser_IO } from '@domain/notifications/notify-user.service';
import { notificationDedupKey } from '@domain/notifications/notification-dedup';
import { NOTIFICATION_TARGETS } from '@domain/notifications/notification-target.resolver';

subscribeToInfoEvent(
  APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITED,
  async payload => {
    const invitation = await DB_CLIENT.use.salonInvitation.findUnique({
      where: { id: payload.invitationId },
      select: {
        email: true,
        accepted_at: true,
        declined_at: true,
        salon: {
          select: {
            business_name: true,
            salon_profile_name: true,
            display_name: true,
            created_by_user_id: true,
            created_by_user: { select: { name: true } },
          },
        },
      },
    });
    if (!invitation || invitation.accepted_at || invitation.declined_at) {
      return;
    }
    const invitee = await DB_CLIENT.use.user.findFirst({
      where: { email: invitation.email },
      select: { id: true },
    });
    if (!invitee) {
      return;
    }
    const salonName =
      salonDisplayName(invitation.salon).trim() ||
      stylistDisplayName(invitation.salon).trim();
    await notifyUser_IO({
      userId: invitee.id,
      recipientRole: null,
      type: NotificationTypeValue.SALON_INVITATION_RECEIVED,
      dedupKey: notificationDedupKey(
        NotificationTypeValue.SALON_INVITATION_RECEIVED,
        payload.invitationId
      ),
      actorUserId: invitation.salon.created_by_user_id,
      actorName: salonName.length > 0 ? salonName : null,
      targetPath: NOTIFICATION_TARGETS.salonInvitationReceived(),
      rearm: false,
    });
  }
);
