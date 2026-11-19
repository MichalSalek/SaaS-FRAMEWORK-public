export const NOTIFICATION_CONFIG = Object.freeze({
  /** Rows older than this are swept (lazy sweep `notification-cleanup`). */
  RETENTION_DAYS: 90,
  /** Newest rows the list endpoint returns. */
  LIST_LIMIT: 50,
  /** A push subscription whose delivery failed stays this long for diagnosis. */
  PUSH_FAILED_RETENTION_DAYS: 30,
  /** A subscription not seen by its device for this long is dropped. */
  PUSH_IDLE_RETENTION_DAYS: 180,
  /** Web push endpoint and FCM token bounds (DB column VarChar(1000)). */
  PUSH_ENDPOINT_MAX_LENGTH: 1000,
  PUSH_KEY_P256DH_MAX_LENGTH: 200,
  PUSH_KEY_AUTH_MAX_LENGTH: 100,
  /** Push payload bounds: a notification is one line, never a letter. */
  PUSH_TITLE_MAX_LENGTH: 120,
  PUSH_BODY_MAX_LENGTH: 200,
  /** The push payload's `url` is always the notification centre. */
  PUSH_TTL_SECONDS: 24 * 60 * 60,
});
