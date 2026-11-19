/**
 * SESSION_CONTAINER_SHARED → the stylist: „{client} udostępniła Ci sesję”.
 * One row per session (a session is shared once); the stylist's user id is
 * read here like the e-mail listener does.
 */
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { NotificationTypeValue } from '@kernel/models/notifications/notifications.dto';
import { DB_CLIENT } from '@app/db/db.client';
import { subscribeToInfoEvent } from '@app/events/event-bus';
import { notifyUser_IO } from '@domain/notifications/notify-user.service';
import { notificationDedupKey } from '@domain/notifications/notification-dedup';
import { resolveClientActorName } from '@domain/notifications/notification-actor.resolver';
import { NOTIFICATION_TARGETS } from '@domain/notifications/notification-target.resolver';

subscribeToInfoEvent(
  APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARED,
  async payload => {
    const stylist = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { account_id: payload.stylistAccountId },
      select: { created_by_user_id: true },
    });
    if (!stylist) {
      return;
    }
    await notifyUser_IO({
      userId: stylist.created_by_user_id,
      recipientRole: AccountTypeValue.STYLIST,
      type: NotificationTypeValue.SESSION_SHARED,
      dedupKey: notificationDedupKey(
        NotificationTypeValue.SESSION_SHARED,
        payload.sessionId
      ),
      actorUserId: payload.clientUserId,
      actorName: resolveClientActorName(payload.clientName),
      targetPath: NOTIFICATION_TARGETS.sessionShared(payload.sessionId),
      rearm: false,
    });
  }
);
