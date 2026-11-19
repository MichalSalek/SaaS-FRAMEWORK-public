import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  createOrRearmNotification_IO,
  type CreateNotificationInput,
} from '@domain/notifications/operations/notification-write.operations';
import { dispatchPushForNotification_IO } from './push/push-dispatch.service';

/**
 * The one entry every notification listener calls: write the row (idempotent),
 * and when the recipient really has something new, push it to her devices.
 * Never throws (the event bus would report it, but the row is the product;
 * a failed push must not read as a failed notification).
 */
export const notifyUser_IO = async (
  input: CreateNotificationInput
): Promise<boolean> => {
  const written = await createOrRearmNotification_IO(input);
  if (!written.success) {
    reportIssueBackend({
      namespace: 'NOTIFICATION_WRITE_FAILED',
      message: `Could not store notification ${input.type} for ${input.userId}`,
      payload: { type: input.type, dedupKey: input.dedupKey },
      mode: 'error',
    });
    return false;
  }
  if (!written.data.created) {
    // The row already exists (dedup): the recipient has the in-app signal.
    return true;
  }
  await dispatchPushForNotification_IO({
    userId: input.userId,
    notification: written.data.notification,
  });
  return true;
};
