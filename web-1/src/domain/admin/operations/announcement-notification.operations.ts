import { VALIDATION_MESSAGES as V } from '@kernel/domain/i18n/validation.i18n';
import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { withWriteTx } from '@app/db/with-write-tx';
import { lockAnnouncementForBroadcast } from '@app/db/lock-rows';
import {
  success,
  failure,
  type OperationResult,
} from '@kernel/application/result.types';
import type {
  DatabaseError,
  ValidationError,
  AnnouncementNotFoundError,
} from '@kernel/application/common-errors.types';
import type { AdminError } from '@kernel/domain/admin/admin-errors.types';
import {
  announcementTranslation,
  readAnnouncementTranslations,
  type AnnouncementTranslations,
} from '@kernel/domain/admin/announcement-content';
import { announcementPlainText } from '@kernel/domain/admin/announcement-links';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { batchResolveLocales } from '@app/email-handler/lifecycle/email-locale-batch.resolver';
import { dispatchPushForNotification_IO } from '@domain/notifications/push/push-dispatch.service';

const BATCH_SIZE = 500;
type SendResult = {
  created: boolean;
  id: string;
  translations: AnnouncementTranslations;
  sentAt: string;
};
type SendError =
  AdminError | DatabaseError | ValidationError | AnnouncementNotFoundError;

export const sendAnnouncementNotification_IO = async (params: {
  id: string;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<OperationResult<SendResult, SendError>> => {
  const admin = requireAdminPermission(params.currentUser);
  if (!admin.success) {
    return admin;
  }
  try {
    // The row lock serializes send/edit/delete. The marker and bell inserts commit together.
    // Test: tests/postgres/announcement-broadcast.test.ts (two concurrent sends and rollback; not provider delivery).
    return await withWriteTx(
      async tx => {
        await lockAnnouncementForBroadcast(tx, params.id);
        const announcement = await tx.announcement.findUnique({
          where: { id: params.id },
        });
        if (!announcement) {
          return failure({
            type: 'ANNOUNCEMENT_NOT_FOUND',
            announcementId: params.id,
          });
        }
        const translations = readAnnouncementTranslations(
          announcement.translations,
          announcement
        );
        if (announcement.notification_sent_at) {
          return success({
            id: params.id,
            created: false,
            translations,
            sentAt: announcement.notification_sent_at.toISOString(),
          });
        }
        if (
          (!announcement.audience_client && !announcement.audience_stylist) ||
          !announcementTranslation(translations, 'pl', true)
        ) {
          return failure({
            type: 'VALIDATION_ERROR',
            field: 'audience_client',
            message: V.announcement.notificationAudienceRequired,
          });
        }
        const recipientRole =
          announcement.audience_client && announcement.audience_stylist
            ? null
            : announcement.audience_client
              ? 'CLIENT'
              : 'STYLIST';
        let cursor: string | undefined;
        for (;;) {
          const users = await tx.user.findMany({
            where: {
              is_active: true,
              deleted_at: null,
              disabled_at: null,
              OR: [
                ...(announcement.audience_client
                  ? [{ client_account: { isNot: null } }]
                  : []),
                ...(announcement.audience_stylist
                  ? [{ stylist_account: { isNot: null } }]
                  : []),
              ],
            },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (users.length === 0) {
            break;
          }
          const locales = await batchResolveLocales(
            users.map(user => user.id),
            { strict: true }
          );
          const recipients = users.filter(
            user =>
              translations[getLocaleOrDefault(locales.get(user.id))] !==
              undefined
          );
          if (recipients.length > 0) {
            await tx.notification.createMany({
              skipDuplicates: true,
              data: recipients.map(user => ({
                user_id: user.id,
                recipient_role: recipientRole,
                type: 'SYSTEM_ANNOUNCEMENT',
                dedup_key: `ANNOUNCEMENT:${params.id}`,
                announcement_id: params.id,
                target_path: ROUTES_FRONT.NOTIFICATIONS,
              })),
            });
          }
          cursor = users.at(-1)?.id;
          if (users.length < BATCH_SIZE) {
            break;
          }
        }
        const sentAt = new Date();
        await tx.announcement.update({
          where: { id: params.id },
          data: { notification_sent_at: sentAt },
        });
        return success({
          id: params.id,
          created: true,
          translations,
          sentAt: sentAt.toISOString(),
        });
      },
      { timeoutMs: 60_000 }
    );
  } catch (error) {
    return databaseFailure('sendAnnouncementNotification_IO', error);
  }
};

/** Delivery uses the committed bells. Push is best effort, like every other notification type. */
export const pushAnnouncementNotification_IO = async (
  input: SendResult
): Promise<void> => {
  if (!input.created) {
    return;
  }
  let cursor: string | undefined;
  for (;;) {
    const rows = await DB_CLIENT.use.notification.findMany({
      where: {
        announcement_id: input.id,
        dedup_key: `ANNOUNCEMENT:${input.id}`,
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) {
      break;
    }
    const locales = await batchResolveLocales(
      rows.map(row => row.user_id),
      { strict: true }
    );
    // Keep concurrency bounded: the subscription adapter already fans out across one person's devices.
    for (const notification of rows) {
      const text = announcementTranslation(
        input.translations,
        getLocaleOrDefault(locales.get(notification.user_id)),
        true
      );
      if (text) {
        await dispatchPushForNotification_IO({
          userId: notification.user_id,
          notification,
          copy: {
            title: text.title,
            body: announcementPlainText(text.message),
          },
        });
      }
    }
    cursor = rows.at(-1)?.id;
    if (rows.length < BATCH_SIZE) {
      break;
    }
  }
};
