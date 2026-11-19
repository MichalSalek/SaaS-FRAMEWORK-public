import { notificationForClient } from './notification-client-compatibility';
import { DB_CLIENT } from '@app/db/db.client';
import {
  readAnnouncementTranslations,
  announcementTranslation,
} from '@kernel/domain/admin/announcement-content';
import { announcementPrimaryHref } from '@kernel/domain/admin/announcement-links';
import { announcementTestLocale } from '@kernel/domain/notifications/announcement-test';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import {
  success,
  type OperationResult,
} from '@kernel/application/result.types';
import { NOTIFICATION_CONFIG } from '@kernel/domain/notifications/notification.config';
import type { AccountType } from '@kernel/models/db_models.generated.dto';
import type { NotificationDTO } from '@kernel/models/notifications/notifications.dto';
import { recipientRoleWhere } from './notification-write.operations';

export const notificationToDto = (row: {
  id: string;
  type: NotificationDTO['type'];
  actor_name: string | null;
  target_path: string;
  recipient_role?: NotificationDTO['recipient_role'];
  activity_kind?: NotificationDTO['activity_kind'];
  session_id?: string | null;
  change_scope?: NotificationDTO['change_scope'];
  created_at: Date;
  read_at: Date | null;
  dedup_key?: string;
  announcement?: {
    translations: unknown;
    title: string;
    message: string;
  } | null;
}): NotificationDTO => ({
  id: row.id,
  type: row.type,
  actor_name: row.actor_name,
  target_path: row.target_path,
  recipient_role: row.recipient_role ?? null,
  activity_kind: row.activity_kind ?? null,
  session_id: row.session_id ?? null,
  change_scope: row.change_scope ?? null,
  created_at: row.created_at.toISOString(),
  read_at: row.read_at ? row.read_at.toISOString() : null,
  announcement: row.announcement
    ? {
        test_locale: announcementTestLocale(row.dedup_key),
        translations: readAnnouncementTranslations(
          row.announcement.translations,
          row.announcement
        ),
        primary_href: announcementPrimaryHref(
          announcementTranslation(
            readAnnouncementTranslations(
              row.announcement.translations,
              row.announcement
            ),
            'pl',
            true
          )?.message ?? ''
        ),
      }
    : null,
});

/** The bell: unread rows for the caller's ACTIVE role (plus role-less ones). */
export const getUnreadNotificationsCount_IO = async (params: {
  userId: string;
  accountType: AccountType;
}): Promise<OperationResult<{ unread_count: number }, DatabaseError>> => {
  try {
    const unread = await DB_CLIENT.use.notification.count({
      where: {
        user_id: params.userId,
        read_at: null,
        ...recipientRoleWhere(params.accountType),
      },
    });
    return success({ unread_count: unread });
  } catch (error) {
    return databaseFailure('getUnreadNotificationsCount_IO', error);
  }
};

/**
 * The list: newest first, capped, with the unread count in the same answer so
 * the screen needs one request and can zero the badge it just showed.
 */
export const getRecentNotifications_IO = async (params: {
  userId: string;
  accountType: AccountType;
  notificationSchema?: string | undefined;
}): Promise<
  OperationResult<
    { notifications: NotificationDTO[]; unread_count: number },
    DatabaseError
  >
> => {
  try {
    const where = {
      user_id: params.userId,
      ...recipientRoleWhere(params.accountType),
    };
    const [rows, unread] = await Promise.all([
      DB_CLIENT.use.notification.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: NOTIFICATION_CONFIG.LIST_LIMIT,
        select: {
          id: true,
          type: true,
          actor_name: true,
          target_path: true,
          recipient_role: true,
          activity_kind: true,
          session_id: true,
          change_scope: true,
          created_at: true,
          read_at: true,
          dedup_key: true,
          announcement: {
            select: { translations: true, title: true, message: true },
          },
        },
      }),
      DB_CLIENT.use.notification.count({
        where: { ...where, read_at: null },
      }),
    ]);
    return success({
      notifications: rows.map(row =>
        notificationForClient(notificationToDto(row), params.notificationSchema)
      ),
      unread_count: unread,
    });
  } catch (error) {
    return databaseFailure('getRecentNotifications_IO', error);
  }
};

export const getOneNotification_IO = async (
  userId: string,
  id: string,
  notificationSchema?: string
): Promise<
  OperationResult<{ notification: NotificationDTO | null }, DatabaseError>
> => {
  try {
    const row = await DB_CLIENT.use.notification.findFirst({
      where: { id, user_id: userId },
    });
    return success({
      notification: row
        ? notificationForClient(notificationToDto(row), notificationSchema)
        : null,
    });
  } catch (error) {
    return databaseFailure('getOneNotification', error);
  }
};
