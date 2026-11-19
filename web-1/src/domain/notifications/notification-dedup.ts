import type { NotificationType } from '@kernel/models/notifications/notifications.dto';

/**
 * Idempotency keys of the notification centre: `TYPE:<event identity>`,
 * unique per recipient (`Notification` @@unique([user_id, dedup_key])).
 *
 * DECISION:
 * The identity is the DURABLE subject of the event (the pair, the session, the
 * invitation), never a timestamp. A repeated emission (retry, two processes,
 * the idempotent re-claim of a QR code, a re-accept after a revoke) then lands
 * on the same row: either silently (nothing changes) or by RE-ARMING it
 * (`rearm` in createOrRearmNotification_IO: created_at = now, read_at = null),
 * which is what a new request on an old pair or the next message in a
 * conversation should do. One row per conversation also keeps the list from
 * filling with "wrote to you" lines (the Messages badge already counts them).
 */
export const notificationDedupKey = (
  type: NotificationType,
  subjectId: string,
  secondaryId?: string
): string =>
  secondaryId === undefined
    ? `${type}:${subjectId}`
    : `${type}:${subjectId}:${secondaryId}`;

/** Prefix that matches every row about one subject, for mark-read on action. */
export const notificationDedupPrefix = (
  type: NotificationType,
  subjectId: string
): string => `${type}:${subjectId}`;
