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
  PushPlatform,
  PushSubscription,
} from '@kernel/models/db_models.generated.dto';

export type PushSubscriptionRow = Pick<
  PushSubscription,
  'id' | 'user_id' | 'platform' | 'endpoint' | 'p256dh' | 'auth'
>;

const PUSH_SUBSCRIPTION_SELECT = {
  id: true,
  user_id: true,
  platform: true,
  endpoint: true,
  p256dh: true,
  auth: true,
} as const;

export const registerPushSubscription_IO = async (params: {
  userId: string;
  platform: PushPlatform;
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
  userAgent: string | null;
}): Promise<OperationResult<{ subscription_id: string }, DatabaseError>> => {
  try {
    const now = new Date();
    const row = await DB_CLIENT.use.pushSubscription.upsert({
      where: { endpoint: params.endpoint },
      create: {
        user_id: params.userId,
        platform: params.platform,
        endpoint: params.endpoint,
        p256dh: params.p256dh,
        auth: params.auth,
        user_agent: params.userAgent,
        last_seen_at: now,
      },
      update: {
        user_id: params.userId,
        platform: params.platform,
        p256dh: params.p256dh,
        auth: params.auth,
        user_agent: params.userAgent,
        last_seen_at: now,
        failed_at: null,
      },
      select: { id: true },
    });
    return success({ subscription_id: row.id });
  } catch (error) {
    return databaseFailure('registerPushSubscription_IO', error);
  }
};

/**
 * Logout or switch-off on this device. Scoped to the caller: a foreign
 * endpoint is a no-op (`removed: false`), never an oracle about other users.
 */
export const unregisterPushSubscription_IO = async (params: {
  userId: string;
  endpoint: string;
}): Promise<OperationResult<{ removed: boolean }, DatabaseError>> => {
  try {
    const result = await DB_CLIENT.use.pushSubscription.deleteMany({
      where: { endpoint: params.endpoint, user_id: params.userId },
    });
    return success({ removed: result.count > 0 });
  } catch (error) {
    return databaseFailure('unregisterPushSubscription_IO', error);
  }
};

/** Devices to push to right now (a failed device stays until the sweep). */
export const getPushSubscriptionsForUser_IO = async (
  userId: string
): Promise<OperationResult<PushSubscriptionRow[], DatabaseError>> => {
  try {
    const rows = await DB_CLIENT.use.pushSubscription.findMany({
      where: { user_id: userId },
      select: PUSH_SUBSCRIPTION_SELECT,
    });
    return success(rows);
  } catch (error) {
    return databaseFailure('getPushSubscriptionsForUser_IO', error);
  }
};

/** The push service said the device is gone (404/410, UNREGISTERED). */
export const deletePushSubscriptionByEndpoint_IO = async (
  endpoint: string
): Promise<OperationResult<{ removed: boolean }, DatabaseError>> => {
  try {
    const result = await DB_CLIENT.use.pushSubscription.deleteMany({
      where: { endpoint },
    });
    return success({ removed: result.count > 0 });
  } catch (error) {
    return databaseFailure('deletePushSubscriptionByEndpoint_IO', error);
  }
};

/** A transient delivery failure: remembered, retried next time, swept later. */
export const markPushSubscriptionFailed_IO = async (
  endpoint: string
): Promise<OperationResult<{ marked: boolean }, DatabaseError>> => {
  try {
    const result = await DB_CLIENT.use.pushSubscription.updateMany({
      where: { endpoint },
      data: { failed_at: new Date() },
    });
    return success({ marked: result.count > 0 });
  } catch (error) {
    return databaseFailure('markPushSubscriptionFailed_IO', error);
  }
};

/** A delivery succeeded: the device is alive, an older failure is forgotten. */
export const markPushSubscriptionDelivered_IO = async (
  endpoint: string
): Promise<OperationResult<{ marked: boolean }, DatabaseError>> => {
  try {
    const result = await DB_CLIENT.use.pushSubscription.updateMany({
      where: { endpoint },
      data: { failed_at: null, last_seen_at: new Date() },
    });
    return success({ marked: result.count > 0 });
  } catch (error) {
    return databaseFailure('markPushSubscriptionDelivered_IO', error);
  }
};

/**
 * Retention sweep body: devices that keep failing for PUSH_FAILED_RETENTION_DAYS
 * and devices not seen for PUSH_IDLE_RETENTION_DAYS.
 */
export const cleanupPushSubscriptions_IO = async (): Promise<
  OperationResult<{ deleted: number }, DatabaseError>
> => {
  try {
    const now = Date.now();
    const failedCutoff = new Date(
      now - NOTIFICATION_CONFIG.PUSH_FAILED_RETENTION_DAYS * TIME.MS_PER_DAY
    );
    const idleCutoff = new Date(
      now - NOTIFICATION_CONFIG.PUSH_IDLE_RETENTION_DAYS * TIME.MS_PER_DAY
    );
    const result = await DB_CLIENT.use.pushSubscription.deleteMany({
      where: {
        OR: [
          { failed_at: { lt: failedCutoff } },
          { last_seen_at: { lt: idleCutoff } },
        ],
      },
    });
    return success({ deleted: result.count });
  } catch (error) {
    return databaseFailure('cleanupPushSubscriptions_IO', error);
  }
};
