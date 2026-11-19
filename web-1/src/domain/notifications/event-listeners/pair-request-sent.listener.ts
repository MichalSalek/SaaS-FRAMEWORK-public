/**
 * PAIR_REQUEST_SENT → the stylist: „{client} prosi o połączenie”. One row per
 * pair, re-armed when the same client asks again after the reassert window
 * (the handler emits only for a request that counts as new, `created: true`).
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
  APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT,
  async payload => {
    await notifyUser_IO({
      userId: payload.stylistUserId,
      recipientRole: AccountTypeValue.STYLIST,
      type: NotificationTypeValue.PAIR_REQUEST_RECEIVED,
      dedupKey: notificationDedupKey(
        NotificationTypeValue.PAIR_REQUEST_RECEIVED,
        payload.pairId
      ),
      actorUserId: payload.clientUserId,
      actorName: resolveClientActorName(payload.clientName),
      targetPath: NOTIFICATION_TARGETS.pairRequestReceived(),
      rearm: true,
    });
  }
);
