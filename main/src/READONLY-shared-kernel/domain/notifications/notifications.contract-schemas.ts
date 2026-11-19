import { z } from 'zod';
import { announcementTranslationsSchema } from '../admin/announcement-content';
import { VALIDATION_MESSAGES } from '../i18n/validation.i18n';
import { I18N_CONFIG } from '../i18n/i18n.config';
import { NOTIFICATION_CONFIG } from './notification.config';
import {
  AccountTypeValue,
  NotificationTypeValue,
  PushPlatformValue,
} from '../../models/db_models.generated.dto';
import {
  parsePgSafeDate,
  validateOptionalHttpsUrl,
} from '../../policies/validation/validation.utils';

const V = VALIDATION_MESSAGES;

const newestSeenAt = z
  .string({ error: V.notifications.newestSeenAtRequired })
  .min(1, V.notifications.newestSeenAtRequired)
  .refine(value => parsePgSafeDate(value) !== null, {
    message: V.notifications.newestSeenAtInvalid,
  });

export const notificationsMarkReadSchema = z
  .object({
    newest_seen_at: newestSeenAt.optional(),
    notification_id: z.string().min(1).optional(),
  })
  .refine(value => Boolean(value.newest_seen_at || value.notification_id), {
    path: ['newest_seen_at'],
    message: V.notifications.newestSeenAtRequired,
  });

// DECISION: a WEBPUSH endpoint is a URL the backend will POST to with the user's
// own payload. https only, a DNS name (no IP, localhost, .local, .internal), and
// the column length. An FCM token is an opaque id, never a URL, and needs no keys.
// A forged endpoint can only receive the caller's own notifications, but it must
// not turn the server into a client of an internal host.
const IP_LITERAL = /^(\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;
const PRIVATE_HOST_SUFFIXES = [
  'localhost',
  '.local',
  '.internal',
  '.localdomain',
];
const FCM_TOKEN = /^[A-Za-z0-9_:-]{20,}$/;

const isPublicPushServiceUrl = (value: string): boolean => {
  if (
    !validateOptionalHttpsUrl(
      value,
      NOTIFICATION_CONFIG.PUSH_ENDPOINT_MAX_LENGTH
    )
  ) {
    return false;
  }
  const host = new URL(value).hostname.toLowerCase();
  if (IP_LITERAL.test(host)) {
    return false;
  }
  return !PRIVATE_HOST_SUFFIXES.some(
    suffix => host === suffix || host.endsWith(suffix)
  );
};

const endpoint = z
  .string({ error: V.notifications.endpointRequired })
  .min(1, V.notifications.endpointRequired)
  .max(
    NOTIFICATION_CONFIG.PUSH_ENDPOINT_MAX_LENGTH,
    V.notifications.endpointInvalid
  );

export const pushSubscriptionRegisterSchema = z
  .object({
    platform: z.enum(PushPlatformValue, {
      error: V.notifications.platformInvalid,
    }),
    endpoint,
    p256dh: z
      .string()
      .min(1, V.notifications.keysRequired)
      .max(
        NOTIFICATION_CONFIG.PUSH_KEY_P256DH_MAX_LENGTH,
        V.notifications.keysRequired
      )
      .optional(),
    auth: z
      .string()
      .min(1, V.notifications.keysRequired)
      .max(
        NOTIFICATION_CONFIG.PUSH_KEY_AUTH_MAX_LENGTH,
        V.notifications.keysRequired
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.platform === PushPlatformValue.WEBPUSH) {
      if (!isPublicPushServiceUrl(value.endpoint)) {
        ctx.addIssue({
          code: 'custom',
          path: ['endpoint'],
          message: V.notifications.endpointInvalid,
        });
      }
      if (!value.p256dh || !value.auth) {
        ctx.addIssue({
          code: 'custom',
          path: ['auth'],
          message: V.notifications.keysRequired,
        });
      }
      return;
    }
    if (!FCM_TOKEN.test(value.endpoint)) {
      ctx.addIssue({
        code: 'custom',
        path: ['endpoint'],
        message: V.notifications.endpointInvalid,
      });
    }
  });

export const pushSubscriptionUnregisterSchema = z.object({
  endpoint,
});

export const notificationRowSchema = z.object({
  announcement: z
    .object({
      translations: announcementTranslationsSchema,
      primary_href: z.string().nullable(),
      test_locale: z.enum(I18N_CONFIG.locales).nullable().optional(),
    })
    .nullable()
    .optional(),
  id: z.string(),
  type: z.enum(NotificationTypeValue),
  actor_name: z.string().nullable(),
  target_path: z.string(),
  recipient_role: z.enum(AccountTypeValue).nullable().optional(),
  activity_kind: z
    .enum(['TEXT', 'SESSION_SUBMITTED', 'SESSION_ACCEPTED', 'SESSION_CHANGED'])
    .nullable()
    .optional(),
  session_id: z.string().nullable().optional(),
  change_scope: z
    .enum(['PHOTOS', 'NOTE', 'PHOTOS_AND_NOTE'])
    .nullable()
    .optional(),
  created_at: z.string(),
  read_at: z.string().nullable(),
});

export const recentNotificationsSchema = z.object({
  notifications: z.array(notificationRowSchema),
  unread_count: z.number(),
});

export const unreadCountSchema = z.object({
  unread_count: z.number(),
});

export const markedReadSchema = z.object({
  marked: z.number(),
});

export const subscriptionRegisteredSchema = z.object({
  subscription_id: z.string(),
});

export const subscriptionRemovedSchema = z.object({
  removed: z.boolean(),
});

export const notificationOneSchema = z.object({
  notification: notificationRowSchema.nullable(),
});
