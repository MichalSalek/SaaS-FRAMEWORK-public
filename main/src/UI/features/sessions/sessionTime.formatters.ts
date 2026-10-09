// UI/features/sessions/sessionTime.formatters.ts
// SSOT for the session expiry-remaining + time-since-shared logic that was
// triplicated across ClientSessionsPage.formatters (formatDaysRemaining),
// ClientSessionDetailPage.formatters (tFormatDaysRemaining/tFormatTimeSinceShared)
// and SessionDetailPage.parts.molecule (tFormatSessionTimer/tFormatTimeSinceShared)
// — a rule-of-three SSOT violation. The per-surface exports stay as thin adapters
// (parameterized empty-label) so call sites + their tests are untouched; the diff/
// floor/branch logic lives ONCE here. Pure functions, zero React.

import type { useTranslations } from 'next-intl';
import { TIME } from '@kernel/application/constants.config';

const MS_DAY = TIME.MS_PER_DAY;
const MS_HOUR = TIME.MS_PER_HOUR;

export type TSessions = ReturnType<typeof useTranslations<'pages.sessions'>>;

/**
 * How the remaining time is worded.
 *  - `sentence`: it stands alone, as one fact among others („Aktywna jeszcze
 *    6 dni”, the detail pages).
 *  - `afterStatus`: it continues the status pill that stands right before it
 *    in a list row („Udostępniona” + „jeszcze 6 dni”). The full sentence
 *    there did not fit beside the pill and dropped to a line of its own.
 */
export type ExpiryWording = 'sentence' | 'afterStatus';

/**
 * Time remaining until session expiry (translated). `emptyLabel` is returned
 * when there is no expiry (expiresAt null/empty) — parameterized because the
 * client surfaces show statusDraft ("Szkic") while the stylist timer shows
 * "waitingForClient".
 */
export function formatExpiryRemaining(
  expiresAt: string | null,
  t: TSessions,
  emptyLabel: string,
  wording: ExpiryWording = 'sentence'
): string {
  if (!expiresAt) {
    return emptyLabel;
  }
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) {
    return t('statusExpired');
  }
  // Written for people, not as a timer: whole days while at least one is
  // left, whole hours on the last day, "very soon" in the last hour. The old
  // "6 dn. 6 godz." pair read like a countdown and wrapped on every card.
  const afterStatus = wording === 'afterStatus';
  const days = Math.floor(diff / MS_DAY);
  if (days > 0) {
    return afterStatus
      ? t('remainingDays', { days })
      : t('expiresInDays', { days });
  }
  const hours = Math.floor(diff / MS_HOUR);
  if (hours > 0) {
    return afterStatus
      ? t('remainingHours', { hours })
      : t('expiresInHours', { hours });
  }
  return afterStatus ? t('remainingSoon') : t('expiresSoon');
}

/**
 * Elapsed time since a session was shared (translated). Empty string when the
 * session was never shared (sharedAt null/empty) or the timestamp is invalid.
 */
export function formatTimeSinceShared(
  sharedAt: string | null,
  t: TSessions
): string {
  if (!sharedAt) {
    return '';
  }
  const diff = Date.now() - new Date(sharedAt).getTime();
  if (!Number.isFinite(diff)) {
    return '';
  }
  const days = Math.floor(diff / MS_DAY);
  const hours = Math.floor((diff % MS_DAY) / MS_HOUR);
  if (days > 0) {
    return t('sharedDaysAgo', { days });
  }
  if (hours > 0) {
    return t('sharedHoursAgo', { hours });
  }
  return t('sharedJustNow');
}
