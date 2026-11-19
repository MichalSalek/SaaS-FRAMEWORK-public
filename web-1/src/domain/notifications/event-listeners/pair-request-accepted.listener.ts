/**
 * PAIR_REQUEST_ACCEPTED to the client: „{stylist} przyjęła Twoją prośbę”.
 * The client used to learn nothing. The stylist's name is read here (PII stays
 * off the bus). The row leads to her gallery, which the client can then open.
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
  APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_ACCEPTED,
  async payload => {
    const stylist = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { account_id: payload.stylistAccountId },
      select: {
        display_name: true,
        business_name: true,
        created_by_user: { select: { name: true } },
      },
    });
    await notifyUser_IO({
      userId: payload.clientUserId,
      recipientRole: AccountTypeValue.CLIENT,
      type: NotificationTypeValue.PAIR_REQUEST_ACCEPTED,
      dedupKey: notificationDedupKey(
        NotificationTypeValue.PAIR_REQUEST_ACCEPTED,
        payload.pairId
      ),
      actorUserId: payload.stylistUserId,
      actorName: stylist ? resolveStylistActorName(stylist) : null,
      targetPath: NOTIFICATION_TARGETS.pairRequestAccepted(
        payload.stylistAccountId
      ),
      rearm: true,
    });
  }
);
