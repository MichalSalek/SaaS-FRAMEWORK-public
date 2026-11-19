// SSOT: Valid log severity levels for the admin send-log endpoint

export const SEND_LOG_TYPES = ['info', 'warn', 'error'] as const;
export type SendLogType = (typeof SEND_LOG_TYPES)[number];

export const isSendLogType = (value: unknown): value is SendLogType =>
  typeof value === 'string' &&
  (SEND_LOG_TYPES as readonly string[]).includes(value);
