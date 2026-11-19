/**
 * PAIRING_SESSION_CLAIMED → the stylist: „{client} połączyła się z Tobą” (QR).
 * The claim is an idempotent find-or-create, so a re-scan re-arms the same row
 * instead of adding a second one.
 */
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { NotificationTypeValue } from '@kernel/models/notifications/notifications.dto';
import { subscribeToInfoEvent } from '@app/events/event-bus';
import { notifyUser_IO } from '@domain/notifications/notify-user.service';
import { notificationDedupKey } from '@domain/notifications/notification-dedup';
import { resolveClientActorName } from '@domain/notifications/notification-actor.resolver';
import { NOTIFICATION_TARGETS } from '@domain/notifications/notification-target.resolver';

subscribeToInfoEvent(
  APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED,
  async payload => {
    await notifyUser_IO({
      userId: payload.stylistUserId,
      recipientRole: AccountTypeValue.STYLIST,
      type: NotificationTypeValue.PAIR_CONNECTED_BY_QR,
      dedupKey: notificationDedupKey(
        NotificationTypeValue.PAIR_CONNECTED_BY_QR,
        payload.stylistAccountId,
        payload.clientUserId
      ),
      actorUserId: payload.clientUserId,
      actorName: resolveClientActorName(payload.clientName),
      targetPath: NOTIFICATION_TARGETS.pairConnectedByQr(payload.clientUserId),
      rearm: true,
    });
  }
);
