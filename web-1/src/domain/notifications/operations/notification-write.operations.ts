import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { TIME } from '@kernel/application/constants.config';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import {
  success,
  type OperationResult,
} from '@kernel/application/result.types';
import { NOTIFICATION_CONFIG } from '@kernel/domain/notifications/notification.config';
import type {
  AccountType,
  Notification,
  NotificationType,
} from '@kernel/models/db_models.generated.dto';
import type { Prisma } from '../../../prisma/js-client';

export type NotificationRow = Pick<
  Notification,
  | 'id'
  | 'user_id'
  | 'recipient_role'
  | 'type'
  | 'dedup_key'
  | 'actor_user_id'
  | 'actor_name'
  | 'target_path'
  | 'created_at'
  | 'read_at'
> &
  Partial<Pick<Notification, 'activity_kind' | 'session_id' | 'change_scope'>>;

const NOTIFICATION_SELECT = {
  id: true,
  user_id: true,
  recipient_role: true,
  type: true,
  dedup_key: true,
  actor_user_id: true,
  actor_name: true,
  target_path: true,
  created_at: true,
  read_at: true,
} as const;

export type CreateNotificationInput = {
  userId: string;
  /** null = addressed to the person in any role (salon invitations). */
  recipientRole: AccountType | null;
  type: NotificationType;
  dedupKey: string;
  actorUserId: string | null;
  actorName: string | null;
  targetPath: string;
  /**
   * An existing row with the same key is brought back to the top as unread
   * (a new message in the same conversation, a new request on an old pair).
   * Without it a repeated event is a silent no-op (`created: false`).
   */
  rearm: boolean;
};

export type CreateNotificationResult = {
  /** True when the recipient has something NEW to see (a push may follow). */
  created: boolean;
  notification: NotificationRow;
};

/**
 * Idempotent write of one notification. `createMany` + `skipDuplicates` is the
 * race-safe insert (two listeners for the same event in two processes: one
 * inserts, the other sees count 0, nobody throws); the follow-up read returns
 * the row either way. `rearm` uses an upsert on the same unique key.
 */
export const createOrRearmNotification_IO = async (
  input: CreateNotificationInput,
  transaction?: Prisma.TransactionClient
): Promise<OperationResult<CreateNotificationResult, DatabaseError>> => {
  const data = {
    user_id: input.userId,
    recipient_role: input.recipientRole,
    type: input.type,
    dedup_key: input.dedupKey,
    actor_user_id: input.actorUserId,
    actor_name: input.actorName,
    target_path: input.targetPath,
  };
  const uniqueKey = {
    user_id_dedup_key: { user_id: input.userId, dedup_key: input.dedupKey },
  };
  try {
    const db = transaction ?? DB_CLIENT.use;
    if (input.rearm) {
      const now = new Date();
      const notification = await db.notification.upsert({
        where: uniqueKey,
        create: data,
        update: {
          created_at: now,
          read_at: null,
          actor_user_id: input.actorUserId,
          actor_name: input.actorName,
          target_path: input.targetPath,
        },
        select: NOTIFICATION_SELECT,
      });
      return success({ created: true, notification });
    }

    const inserted = await db.notification.createMany({
      data: [data],
      skipDuplicates: true,
    });
    const notification = await db.notification.findUnique({
      where: uniqueKey,
      select: NOTIFICATION_SELECT,
    });
    if (!notification) {
      // Inserted (or skipped) and gone before the read: a concurrent sweep or
      // account deletion. Nothing to show, nothing to push.
      throw new Error('notification row vanished between insert and read');
    }
    return success({ created: inserted.count > 0, notification });
  } catch (error) {
    // A surrounding transaction must roll back, and its caller may retry a conflict.
    if (transaction) {
      throw error;
    }
    return databaseFailure('createOrRearmNotification_IO', error);
  }
};

/** Role filter shared by every read and write scoped to the ACTIVE role. */
export const recipientRoleWhere = (accountType: AccountType) => ({
  OR: [{ recipient_role: null }, { recipient_role: accountType }],
});

export const markConversationNotificationsRead_IO = async (params: {
  userId: string;
  pairId: string;
  readThrough: Date;
}) => {
  try {
    const cards = await DB_CLIENT.use.stylistClientMessage.findMany({
      where: {
        pair_id: params.pairId,
        activity_at: { lte: params.readThrough },
        event_key: { not: null },
      },
      select: { event_key: true },
    });
    const keys = cards.flatMap(card =>
      card.event_key ? [card.event_key] : []
    );
    const result = await DB_CLIENT.use.notification.updateMany({
      where: {
        user_id: params.userId,
        read_at: null,
        created_at: { lte: params.readThrough },
        OR: [
          { dedup_key: { startsWith: `MESSAGE_RECEIVED:${params.pairId}` } },
          { dedup_key: { in: keys } },
        ],
      },
      data: { read_at: new Date() },
    });
    return success({ marked: result.count });
  } catch (error) {
    return databaseFailure('markConversationNotificationsRead', error);
  }
};

/**
 * Opening the list: every unread row the screen could have shown (created at
 * or before the newest row it holds) becomes read. A row that arrived after
 * that moment stays unread, so the badge tells the truth after the next poll.
 */
export const markNotificationsRead_IO = async (params: {
  userId: string;
  accountType: AccountType;
  newestSeenAt?: Date;
  notificationId?: string;
}): Promise<OperationResult<{ marked: number }, DatabaseError>> => {
  if (!params.newestSeenAt && !params.notificationId) {
    return success({ marked: 0 });
  }
  try {
    const result = await DB_CLIENT.use.notification.updateMany({
      where: {
        user_id: params.userId,
        read_at: null,
        ...(params.notificationId
          ? { id: params.notificationId }
          : recipientRoleWhere(params.accountType)),
        ...(params.newestSeenAt
          ? { created_at: { lte: params.newestSeenAt } }
          : {}),
      },
      data: { read_at: new Date() },
    });
    return success({ marked: result.count });
  } catch (error) {
    return databaseFailure('markNotificationsRead_IO', error);
  }
};

/**
 * An action that answers the notification (accepting the request, opening the
 * thread, answering the invitation) closes it without a visit to the list.
 * Best-effort companion of a mutation that already succeeded: the caller
 * schedules it after the response and never blocks on it.
 */
export const markNotificationsReadByKeyPrefix_IO = async (params: {
  userId: string;
  keyPrefix: string;
  readThrough?: Date;
}): Promise<OperationResult<{ marked: number }, DatabaseError>> => {
  try {
    const result = await DB_CLIENT.use.notification.updateMany({
      where: {
        user_id: params.userId,
        read_at: null,
        dedup_key: { startsWith: params.keyPrefix },
        ...(params.readThrough
          ? { created_at: { lte: params.readThrough } }
          : {}),
      },
      data: { read_at: new Date() },
    });
    return success({ marked: result.count });
  } catch (error) {
    return databaseFailure('markNotificationsReadByKeyPrefix_IO', error);
  }
};

/**
 * Hard delete of an account (Art. 17): the person's name must not survive in
 * other people's notification rows. The rows stay (they belong to the
 * recipients) with the role-name fallback.
 */
export const eraseActorFromNotifications_IO = async (
  actorUserId: string
): Promise<OperationResult<{ erased: number }, DatabaseError>> => {
  try {
    const result = await DB_CLIENT.use.notification.updateMany({
      where: { actor_user_id: actorUserId },
      data: { actor_name: null, actor_user_id: null },
    });
    return success({ erased: result.count });
  } catch (error) {
    return databaseFailure('eraseActorFromNotifications_IO', error);
  }
};

/** Retention sweep body: rows older than NOTIFICATION_CONFIG.RETENTION_DAYS. */
export const cleanupOldNotifications_IO = async (): Promise<
  OperationResult<{ deleted: number }, DatabaseError>
> => {
  try {
    const cutoff = new Date(
      Date.now() - NOTIFICATION_CONFIG.RETENTION_DAYS * TIME.MS_PER_DAY
    );
    const result = await DB_CLIENT.use.notification.deleteMany({
      where: { created_at: { lt: cutoff } },
    });
    return success({ deleted: result.count });
  } catch (error) {
    return databaseFailure('cleanupOldNotifications_IO', error);
  }
};
