// UI/features/support/supportDate.helpers.ts
// SSOT formatowania dat w widokach supportu (lista watkow + burst chatu).
// Wczesniej identyczna logika zyla rownolegle w SupportThreadBurst.tsx i
// SupportThreadListPage.parts.tsx z hardcoded 'pl-PL' — teraz locale plynie
// z aktywnego jezyka (useCurrentLang w komponencie wolajacym).

import type { useTranslations } from 'next-intl';
import { formatDate } from '../../../application/date/date.utils';

export type TSupport = ReturnType<typeof useTranslations<'pages.support'>>;

/**
 * Relative date: "teraz" / "x min" / "x godz." / "x dni" (klucze i18n
 * pages.support.relative*), a powyzej tygodnia data z projektowego formatera
 * (`formatDate`: "5 wrz 2026"). Gole `toLocaleDateString` dawalo w pl
 * "5.09.2026" obok "10.09.2026", wiec kolumna dat skakala szerokoscia i nie
 * zgadzala sie z reszta aplikacji (S122).
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

/** Godzina wiadomosci (HH:mm) w locale usera. */
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
