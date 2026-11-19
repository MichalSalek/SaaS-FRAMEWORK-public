import { getFeatureFlags } from '@app/feature-flags/feature-flags.cache';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { renderNotificationCopy } from '@kernel/domain/notifications/notification-copy.config';
import { PushPlatformValue } from '@kernel/models/notifications/notifications.dto';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { activityEmailsAllowed_IO } from '@app/email-handler/activity-email-consent';
import { batchResolveLocales } from '@app/email-handler/lifecycle/email-locale-batch.resolver';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { NOTIFICATION_CONFIG } from '@kernel/domain/notifications/notification.config';
import type { PushDispatchSummary } from '@kernel/domain/notifications/push-delivery';
import type { NotificationRow } from '@domain/notifications/operations/notification-write.operations';
import {
  deletePushSubscriptionByEndpoint_IO,
  getPushSubscriptionsForUser_IO,
  markPushSubscriptionDelivered_IO,
  markPushSubscriptionFailed_IO,
} from '@domain/notifications/operations/push-subscription.operations';
import { isFcmConfigured, sendFcmPush } from './fcm.adapter';
import { isWebPushConfigured, sendWebPush } from './web-push.adapter';
import type { PushPayload } from './push-payload.types';

let warnedUnconfigured = false;

/**
 * Push every device of the recipient about a NEW (or re-armed) notification row.
 *
 * DECISION:
 * Push is a channel OUTSIDE the app, like activity mail, so it obeys the same
 * switch, `users.notifications_enabled`, through the same predicate
 * (activity-email-consent.ts, fail closed; a soft-deleted or disabled account
 * gets nothing). The in-app row was already written regardless of that switch.
 * The text is rendered here in the recipient's preferred language (the e-mail
 * locale resolver), from the same copy table the front uses for the row.
 * Best-effort, never throws: a push service outage must not reach the event bus.
 */
export const dispatchPushForNotification_IO = async (params: {
  userId: string;
  notification: NotificationRow;
  copy?: { title: string; body: string };
}): Promise<PushDispatchSummary> => {
  const summary: PushDispatchSummary = {
    sent: 0,
    failed: 0,
    gone: 0,
    skipped: null,
  };
  try {
    const subscriptions = await getPushSubscriptionsForUser_IO(params.userId);
    if (!subscriptions.success) {
      return { ...summary, skipped: 'lookup-failed' };
    }
    if (subscriptions.data.length === 0) {
      return { ...summary, skipped: 'no-devices' };
    }
    const webPushOn = isWebPushConfigured();
    const fcmOn = isFcmConfigured();
    if (!webPushOn && !fcmOn) {
      if (!warnedUnconfigured) {
        warnedUnconfigured = true;
        reportIssueBackend({
          namespace: 'PUSH_NOT_CONFIGURED',
          message:
            'Push devices are registered but neither WEB_PUSH_VAPID_* nor FIREBASE_SERVICE_ACCOUNT_JSON is set; pushes are skipped',
          payload: null,
          mode: 'warn',
        });
      }
      return { ...summary, skipped: 'provider-unconfigured' };
    }
    if (!(await activityEmailsAllowed_IO(params.userId))) {
      return { ...summary, skipped: 'notifications-disabled' };
    }

    const locales = params.copy
      ? undefined
      : await batchResolveLocales([params.userId]);
    const locale = getLocaleOrDefault(locales?.get(params.userId));
    const text =
      params.copy ??
      renderNotificationCopy(
        locale,
        params.notification.type,
        params.notification.actor_name,
        params.notification
      );
    const openerEnabled =
      (await getFeatureFlags()).get(
        FEATURE_FLAG_KEYS.NOTIFICATION_OPEN_ENABLED
      ) ?? false;
    const payload: PushPayload = {
      title: Array.from(text.title)
        .slice(0, NOTIFICATION_CONFIG.PUSH_TITLE_MAX_LENGTH)
        .join(''),
      body: Array.from(text.body)
        .slice(0, NOTIFICATION_CONFIG.PUSH_BODY_MAX_LENGTH)
        .join(''),
      url: openerEnabled
        ? `${ROUTES_FRONT.NOTIFICATION_OPEN}?id=${encodeURIComponent(params.notification.id)}`
        : ROUTES_FRONT.NOTIFICATIONS,
      tag: params.notification.dedup_key,
      notificationId: params.notification.id,
    };

    const deliveries = await Promise.allSettled(
      subscriptions.data.map(async subscription => {
        const outcome =
          subscription.platform === PushPlatformValue.WEBPUSH
            ? webPushOn
              ? await sendWebPush(subscription, payload)
              : 'failed'
            : fcmOn
              ? await sendFcmPush(subscription.endpoint, payload)
              : 'failed';
        if (outcome === 'sent') {
          summary.sent += 1;
          await markPushSubscriptionDelivered_IO(subscription.endpoint);
        } else if (outcome === 'gone') {
          summary.gone += 1;
          await deletePushSubscriptionByEndpoint_IO(subscription.endpoint);
        } else {
          summary.failed += 1;
          await markPushSubscriptionFailed_IO(subscription.endpoint);
        }
      })
    );
    if (deliveries.some(delivery => delivery.status === 'rejected')) {
      throw new Error('Unexpected push dispatch failure');
    }
    return summary;
  } catch {
    reportIssueBackend({
      namespace: 'PUSH_DISPATCH_FAILED',
      message: 'Unexpected push dispatch failure',
      payload: {
        userId: params.userId,
        notificationId: params.notification.id,
      },
      mode: 'error',
    });
    return { ...summary, skipped: 'dispatch-failed' };
  }
};
