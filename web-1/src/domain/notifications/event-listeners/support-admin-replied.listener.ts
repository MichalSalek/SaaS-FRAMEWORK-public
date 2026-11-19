/**
 * SUPPORT_ADMIN_REPLIED → the thread owner: „Zespół Nailfolio odpowiedział na
 * Twoje zgłoszenie”. ONE row per thread, re-armed by every reply of the team
 * (same shape as a message in a conversation). A support thread belongs to the
 * PERSON, not to a mode of her account, so recipient_role is null. No actor:
 * the sender is the team, never an admin's name (copy table DECISION). Opening
 * the thread marks it read (support/mark-thread-read handler).
 */
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { NotificationTypeValue } from '@kernel/models/notifications/notifications.dto';
import { subscribeToInfoEvent } from '@app/events/event-bus';
import { notifyUser_IO } from '@domain/notifications/notify-user.service';
import { notificationDedupKey } from '@domain/notifications/notification-dedup';
import { NOTIFICATION_TARGETS } from '@domain/notifications/notification-target.resolver';

subscribeToInfoEvent(
  APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_REPLIED,
  async payload => {
    await notifyUser_IO({
      userId: payload.ownerUserId,
      recipientRole: null,
      type: NotificationTypeValue.SUPPORT_REPLY_RECEIVED,
      dedupKey: notificationDedupKey(
        NotificationTypeValue.SUPPORT_REPLY_RECEIVED,
        payload.threadId
      ),
      actorUserId: null,
      actorName: null,
      targetPath: NOTIFICATION_TARGETS.supportReplyReceived(payload.threadId),
      rearm: true,
    });
  }
);
