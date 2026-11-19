import { SESSION_CONTAINER_CONFIG } from './session-container.config';

export const SESSION_EXPIRY_DAYS_TOKEN = '__NF_SESSION_EXPIRY_DAYS__';

/** Only authored policy copy uses this token; user notes are never processed. */
export const resolveSessionExpiryText = (value: string): string =>
  value
    .split(SESSION_EXPIRY_DAYS_TOKEN)
    .join(String(SESSION_CONTAINER_CONFIG.SESSION_EXPIRY_DAYS));

/** Resolve authored locale leaves before ICU, SEO or static mirror formatting. */
export function resolveSessionExpiryMessages<T>(value: T): T {
  if (typeof value === 'string') {
    return resolveSessionExpiryText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveSessionExpiryMessages(item)) as T;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveSessionExpiryMessages(item),
      ])
    ) as T;
  }
  return value;
}
