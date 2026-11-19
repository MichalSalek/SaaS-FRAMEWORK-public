import { withWriteTx } from '@app/db/with-write-tx';
import { lockAnnouncementForBroadcast } from '@app/db/lock-rows';
import { databaseFailure } from '@app/errors/error-result.helpers';
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
} from '@kernel/domain/admin/announcement-content';
import { announcementPlainText } from '@kernel/domain/admin/announcement-links';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { VALIDATION_MESSAGES as V } from '@kernel/domain/i18n/validation.i18n';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { announcementTestKey } from '@kernel/domain/notifications/announcement-test';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { dispatchPushForNotification_IO } from '@domain/notifications/push/push-dispatch.service';
import { requireAdminPermission } from '../admin.guards';

type TestResponse =
  ADMIN_DTO_API_V1['ADMIN_TEST_ANNOUNCEMENT_NOTIFICATION']['RESPONSE'];

export async function testAnnouncementNotification_IO(params: {
  id: string;
  locale: LocaleType;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<
    TestResponse,
    AdminError | DatabaseError | ValidationError | AnnouncementNotFoundError
  >
> {
  const admin = requireAdminPermission(params.currentUser);
  if (!admin.success) {
    return admin;
  }
  try {
    const committed = await withWriteTx(async tx => {
      await lockAnnouncementForBroadcast(tx, params.id);
      const announcement = await tx.announcement.findUnique({
        where: { id: params.id },
      });
      if (!announcement) {
        return failure({
          type: 'ANNOUNCEMENT_NOT_FOUND' as const,
          announcementId: params.id,
        });
      }
      const text = announcementTranslation(
        readAnnouncementTranslations(announcement.translations, announcement),
        params.locale,
        false
      );
      if (!text) {
        return failure({
          type: 'VALIDATION_ERROR' as const,
          field: 'locale',
          message: V.announcement.messageInvalid,
        });
      }
      const dedupKey = announcementTestKey(params.id, params.locale);
      const data = {
        recipient_role: null,
        type: 'SYSTEM_ANNOUNCEMENT' as const,
        announcement_id: params.id,
        target_path: ROUTES_FRONT.NOTIFICATIONS,
      };
      // DECISION: tests target the authenticated admin, never a caller-supplied recipient.
      // A separate key keeps test repeats independent of the one-time public broadcast.
      const notification = await tx.notification.upsert({
        where: {
          user_id_dedup_key: {
            user_id: params.currentUser.id,
            dedup_key: dedupKey,
          },
        },
        create: {
          ...data,
          user_id: params.currentUser.id,
          dedup_key: dedupKey,
        },
        update: { ...data, created_at: new Date(), read_at: null },
      });
      return success({ notification, text });
    });
    if (!committed.success) {
      return committed;
    }
    const push = await dispatchPushForNotification_IO({
      userId: params.currentUser.id,
      notification: committed.data.notification,
      copy: {
        title: committed.data.text.title,
        body: announcementPlainText(committed.data.text.message),
      },
    });
    return success({ notification_id: committed.data.notification.id, push });
  } catch (error) {
    return databaseFailure('testAnnouncementNotification_IO', error);
  }
}
