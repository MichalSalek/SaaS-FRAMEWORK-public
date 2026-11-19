/**
 * SESSION_CONTAINER_CLOSED (by the stylist) → the client: „{stylist} zamknęła
 * Twoją sesję”. The handler emits only when the closer is the assigned stylist;
 * a client closing her own session tells nobody.
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
  APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_CLOSED,
  async payload => {
    const [client, stylist] = await Promise.all([
      DB_CLIENT.use.clientAccount.findUnique({
        where: { client_account_id: payload.clientAccountId },
        select: { created_by_user_id: true },
      }),
      DB_CLIENT.use.stylistAccount.findUnique({
        where: { account_id: payload.stylistAccountId },
        select: {
          display_name: true,
          business_name: true,
          created_by_user: { select: { name: true } },
        },
      }),
    ]);
    if (!client) {
      return;
    }
    await notifyUser_IO({
      userId: client.created_by_user_id,
      recipientRole: AccountTypeValue.CLIENT,
      type: NotificationTypeValue.SESSION_CLOSED_BY_STYLIST,
      dedupKey: notificationDedupKey(
        NotificationTypeValue.SESSION_CLOSED_BY_STYLIST,
        payload.sessionId
      ),
      actorUserId: payload.closedByUserId,
      actorName: stylist ? resolveStylistActorName(stylist) : null,
      targetPath: NOTIFICATION_TARGETS.sessionClosedByStylist(
        payload.sessionId
      ),
      rearm: false,
    });
  }
);
