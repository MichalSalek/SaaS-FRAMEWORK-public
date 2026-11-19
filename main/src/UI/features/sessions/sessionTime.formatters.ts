// UI/features/sessions/sessionTime.formatters.ts
// SSOT for the session time wording both roles read: how long a shared
// session stays open in a list row, until when the stylist sees it on the
// session screen, and how long ago it was shared. The per-surface exports in
// ClientSessionsPage.formatters / ClientSessionDetailPage.formatters are thin
// adapters; the diff/floor/branch logic lives ONCE here. Pure functions, zero
// React.

import type { useTranslations } from 'next-intl';
import { TIME } from '@kernel/application/constants.config';
import { keepShortWordsWithNext } from '../../shared/typography/short-words';

const MS_DAY = TIME.MS_PER_DAY;
const MS_HOUR = TIME.MS_PER_HOUR;
const MS_MINUTE = TIME.MS_PER_MINUTE;

export type TSessions = ReturnType<typeof useTranslations<'pages.sessions'>>;

/**
 * The one remaining-time clock both roles read: whole days, hours and minutes
 * while any are left; zero units are omitted, never seconds. `row` and detail
 * use the same value now, so a list cannot disagree with the session header.
 */
export function formatRemainingValue(
  expiresAt: string,
  locale: string,
  now: number
): string | null {
  const diff = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) {
    return null;
  }
  const days = Math.floor(diff / MS_DAY);
  const hours = Math.floor((diff % MS_DAY) / MS_HOUR);
  const minutes = Math.floor((diff % MS_HOUR) / MS_MINUTE);
  const day = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'day',
    unitDisplay: 'long',
  });
  const hour = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'hour',
    unitDisplay: 'short',
  });
  const minute = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'short',
  });
  return (
    [
      days > 0 ? day.format(days) : null,
      hours > 0 ? hour.format(hours) : null,
      minutes > 0 ? minute.format(minutes) : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' ') || null
  );
}

/**
 * Time remaining until session expiry as its own value („Pozostało 6 dni
 * 4 godz. 22 min”), sitting beside the status pill rather than merged into
 * it. `emptyLabel` is returned when there is no expiry (expiresAt
 * null/empty): the session is not shared yet.
 */
export function formatExpiryRemaining(
  expiresAt: string | null,
  t: TSessions,
  emptyLabel: string,
  locale: string
): string {
  if (!expiresAt) {
    return emptyLabel;
  }
  const now = Date.now();
  const diff = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(diff) || diff <= 0) {
    return t('statusExpired');
  }
  const value = formatRemainingValue(expiresAt, locale, now);
  return value === null
    ? t('remainingSoon')
    : t('expiryRemainingValue', { value });
}

/** Who reads the deadline sentence: the client (about her stylist) or the
 *  stylist (about herself). */
export type ExpiryReader = 'client' | 'stylist';

const NBSP = '\u00a0';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const sameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/**
 * The sentence on a session screen that says until when the stylist sees the
 * shared session, with the weekday, the date and the hour, plus what happens
 * after.
 *
 * DECISION: the client sees a deadline (day, date and hour), not a relative count. A count
 * („Za 5 dni…”) is floored days with no hour, so she cannot tell whether her appointment falls
 * inside it; in a blind A/B (2026-10-19) the deadline answered "will she see it?" for 4-5 of 5
 * readers against 2 of 5 for the count. The day is the LOCAL calendar day (the device zone is the
 * appointment's zone, never UTC) and the window length comes from the kernel config.
 */
export function formatExpiryDeadline(
  expiresAt: string | null,
  t: TSessions,
  emptyLabel: string,
  reader: ExpiryReader,
  locale: string,
  now: Date = new Date()
): string {
  if (!expiresAt) {
    return emptyLabel;
  }
  const deadline = new Date(expiresAt);
  const diff = deadline.getTime() - now.getTime();
  if (!Number.isFinite(diff) || diff <= 0) {
    return t('statusExpired');
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const day = sameLocalDay(deadline, now)
    ? 'today'
    : sameLocalDay(deadline, tomorrow)
      ? 'tomorrow'
      : WEEKDAY_KEYS[deadline.getDay()];

  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
  })
    .format(deadline)
    .replace(/ /g, NBSP);
  const time = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(deadline);
  const params = {
    when: t('expiryWhen', { day, date }),
    time,
  };
  const sentence =
    reader === 'stylist'
      ? t('visibleUntilStylist', params)
      : t('visibleUntil', params);
  // Drawn only in the session hero, never searched or copied, so hard spaces
  // are safe here (short-words.ts DECISION).
  return keepShortWordsWithNext(glueTime(sentence, time));
}

/** Hard spaces that keep „7 dni”, „godz. 14:30” and „14:30 Uhr” whole. The
 *  space after a comma („Sunday, October 25, 2:30 PM”) stays breakable. */
function glueTime(sentence: string, time: string): string {
  let result = sentence;
  const at = result.indexOf(` ${time}`);
  if (at > 0 && result[at - 1] !== ',') {
    result = `${result.slice(0, at)}${NBSP}${result.slice(at + 1)}`;
  }
  const end = result.indexOf(`${time} `);
  if (end >= 0) {
    const cut = end + time.length;
    result = `${result.slice(0, cut)}${NBSP}${result.slice(cut + 1)}`;
  }
  return result;
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
