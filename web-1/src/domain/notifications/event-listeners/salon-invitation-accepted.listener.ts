/**
 * SALON_STAFF_INVITATION_ACCEPTED → the salon owner: „{member} dołączyła do
 * Twojego zespołu”. Re-armed when the same person rejoins after leaving.
 */
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { NotificationTypeValue } from '@kernel/models/notifications/notifications.dto';
import { DB_CLIENT } from '@app/db/db.client';
import { subscribeToInfoEvent } from '@app/events/event-bus';
import { notifyUser_IO } from '@domain/notifications/notify-user.service';
import { notificationDedupKey } from '@domain/notifications/notification-dedup';
import { resolveStylistActorName } from '@domain/notifications/notification-actor.resolver';
import { NOTIFICATION_TARGETS } from '@domain/notifications/notification-target.resolver';

subscribeToInfoEvent(
  APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_ACCEPTED,
  async payload => {
    const [salon, member] = await Promise.all([
      DB_CLIENT.use.stylistAccount.findUnique({
        where: { account_id: payload.salonAccountId },
        select: { created_by_user_id: true },
      }),
      DB_CLIENT.use.user.findUnique({
        where: { id: payload.memberUserId },
        select: {
          name: true,
          stylist_account: {
            select: { display_name: true, business_name: true },
          },
        },
      }),
    ]);
    if (!salon || salon.created_by_user_id === payload.memberUserId) {
      return;
    }
    await notifyUser_IO({
      userId: salon.created_by_user_id,
      recipientRole: AccountTypeValue.STYLIST,
      type: NotificationTypeValue.SALON_INVITATION_ACCEPTED,
      dedupKey: notificationDedupKey(
        NotificationTypeValue.SALON_INVITATION_ACCEPTED,
        payload.salonAccountId,
        payload.memberUserId
      ),
      actorUserId: payload.memberUserId,
      actorName: member
        ? resolveStylistActorName({
            display_name: member.stylist_account?.display_name ?? null,
            business_name: member.stylist_account?.business_name ?? null,
            created_by_user: { name: member.name },
          })
        : null,
      targetPath: NOTIFICATION_TARGETS.salonInvitationAccepted(),
      rearm: true,
    });
  }
);
