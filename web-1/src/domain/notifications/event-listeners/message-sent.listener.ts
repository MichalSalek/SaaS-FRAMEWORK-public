/**
 * MESSAGING_MESSAGE_SENT → the other side: „{sender} napisała do Ciebie”. ONE
 * row per conversation, re-armed by each message that passes the 15-minute
 * send throttle (the handler emits only then, and never when the recipient
 * muted the conversation). Opening the thread marks it read (mark-read handler).
 */
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  AccountTypeValue,
  StylistClientMessageSenderValue,
} from '@kernel/models/db_models.generated.dto';
import { NotificationTypeValue } from '@kernel/models/notifications/notifications.dto';
import { subscribeToInfoEvent } from '@app/events/event-bus';
import { notifyUser_IO } from '@domain/notifications/notify-user.service';
import { notificationDedupKey } from '@domain/notifications/notification-dedup';
import { NOTIFICATION_TARGETS } from '@domain/notifications/notification-target.resolver';

subscribeToInfoEvent(
  APP_EVENTS.INFO.MESSAGING.MESSAGING_MESSAGE_SENT,
  async payload => {
    await notifyUser_IO({
      userId: payload.recipientUserId,
      recipientRole:
        payload.recipientSide === StylistClientMessageSenderValue.STYLIST
          ? AccountTypeValue.STYLIST
          : AccountTypeValue.CLIENT,
      type: NotificationTypeValue.MESSAGE_RECEIVED,
      dedupKey: notificationDedupKey(
        NotificationTypeValue.MESSAGE_RECEIVED,
        payload.pairId
      ),
      actorUserId: payload.senderUserId,
      actorName: payload.senderName,
      targetPath: NOTIFICATION_TARGETS.messageReceived(payload.pairId),
      rearm: true,
    });
  }
);
