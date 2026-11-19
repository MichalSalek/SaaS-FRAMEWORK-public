import { TRIAL_CONFIG } from './stripe.config';

export const TRIAL_DAYS_TOKEN = '__NF_TRIAL_DAYS__';

/** Only authored policy copy uses this token; user notes are never processed. */
export const resolveTrialText = (value: string): string =>
  value.split(TRIAL_DAYS_TOKEN).join(String(TRIAL_CONFIG.DURATION_DAYS));

/** Resolve authored locale leaves before ICU, SEO or static mirror formatting. */
export function resolveTrialMessages<T>(value: T): T {
  if (typeof value === 'string') {
    return resolveTrialText(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => resolveTrialMessages(item)) as T;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveTrialMessages(item),
      ])
    ) as T;
  }
  return value;
}
