// UI/features/support/supportDate.helpers.ts
// SSOT of date formatting in the support views (thread list + chat burst).
// The identical logic used to live in parallel in SupportThreadBurst.tsx and
// SupportThreadListPage.parts.tsx with a hardcoded 'pl-PL'; now the locale flows
// from the active language (useCurrentLang in the calling component).

import type { useTranslations } from 'next-intl';
import { formatDate } from '../../../application/date/date.utils';

export type TSupport = ReturnType<typeof useTranslations<'pages.support'>>;

/**
 * Relative date: "teraz" / "x min" / "x godz." / "x dni" (i18n keys
 * pages.support.relative*), and above a week a date from the project formatter
 * (`formatDate`: "5 wrz 2026"). A bare `toLocaleDateString` gave "5.09.2026" next to
 * "10.09.2026" in pl, so the date column jumped in width and disagreed with the
 * rest of the app.
 */
export function formatRelativeDate(
  dateValue: string | Date,
  t: TSupport,
  locale: string
): string {
  const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMin < 1) {
    return t('relativeNow');
  }
  if (diffMin < 60) {
    return t('relativeMinutes', { count: diffMin });
  }
  if (diffHours < 24) {
    return t('relativeHours', { count: diffHours });
  }
  if (diffDays < 7) {
    return t('relativeDays', { count: diffDays });
  }
  return formatDate(date, locale);
}

/** The message time (HH:mm) in the user's locale. */
export function formatMessageTime(
  dateValue: string | Date,
  locale: string
): string {
  const date = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
  return date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });
}
