// UI/features/sessions/ClientSessionsPage.formatters.ts
// Pure formatters & lifecycle helpers for the editorial timeline view.
//
// Two responsibilities:
//  1. Locale-aware date formatting (month names, day numbers, relative past).
//  2. Lifecycle state -> label / color / pulse mapping for status pills.
//
// Kept in a separate file from the React parts to satisfy max-lines and to
// allow plain unit-test friendliness (pure functions, zero React).

import type { useTranslations } from 'next-intl';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import { isActiveSession } from '@kernel/domain/session-container/session-container.types';
// Local value-import for use inside resolveSessionDisplayName; ALSO re-exported
// below as the single import surface. Edge is one-way (disambiguation imports
// nothing from here) so no value↔value cycle.
import { sessionTimestamp } from './ClientSessionsPage.disambiguation';
import {
  formatExpiryDeadline,
  formatExpiryRemaining,
  formatTimeSinceShared,
} from './sessionTime.formatters';

/* ============================================================
 * Month name tables — Polish nominative, English, German.
 * ============================================================ */

const PL_MONTHS_FULL = [
  'styczeń',
  'luty',
  'marzec',
  'kwiecień',
  'maj',
  'czerwiec',
  'lipiec',
  'sierpień',
  'wrzesień',
  'październik',
  'listopad',
  'grudzień',
];

// PL genitive for DAY DATES ("4 czerwca 2026"), separate from
// PL_MONTHS_FULL (nominative, for month headings like "Czerwiec 2026").
const PL_MONTHS_GENITIVE = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
];

const PL_MONTHS_ABBR = [
  'sty',
  'lut',
  'mar',
  'kwi',
  'maj',
  'cze',
  'lip',
  'sie',
  'wrz',
  'paź',
  'lis',
  'gru',
];

const EN_MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const EN_MONTHS_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const DE_MONTHS_FULL = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

const DE_MONTHS_ABBR = [
  'Jan',
  'Feb',
  'Mär',
  'Apr',
  'Mai',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dez',
];

export function getMonthsForLocale(locale: string): {
  full: readonly string[];
  abbr: readonly string[];
} {
  if (locale.startsWith('en')) {
    return { full: EN_MONTHS_FULL, abbr: EN_MONTHS_ABBR };
  }
  if (locale.startsWith('de')) {
    return { full: DE_MONTHS_FULL, abbr: DE_MONTHS_ABBR };
  }
  return { full: PL_MONTHS_FULL, abbr: PL_MONTHS_ABBR };
}

/* ============================================================
 * Date helpers — stable, UTC-based to avoid TZ drift.
 * ============================================================ */

/** "YYYY-MM" stable key for grouping sessions by month. */
export function monthKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '0000-00';
  }
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

/** "Maj" + "2026" / "May" + "2026" / "Mai" + "2026" — capitalised month and
 *  year as SEPARATE parts. Call site wraps the year in `.data-count` (sans +
 *  tabular-nums): Marcellus renders 0 like the letter O. */
export function monthLabelParts(
  iso: string,
  locale: string
): { month: string; year: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  const months = getMonthsForLocale(locale).full;
  const name = months[d.getUTCMonth()] ?? '';
  return {
    month: name.charAt(0).toUpperCase() + name.slice(1),
    year: String(d.getUTCFullYear()),
  };
}

// Time-of-day disambiguation helpers (formatTimeOfDay,
// buildUnnamedDayCollisionTimes) live in ./ClientSessionsPage.disambiguation
// (extracted for the 300 LOC max-lines budget) and are re-exported below so
// call sites keep a single import surface (this file).
//
// `sessionTimestamp` (priority: sharedAt > closedAt > createdAt) is owned by the
// leaf module disambiguation and re-exported here: importing it back from this
// file created a value-to-value import cycle (madge skipTypeImports).
export {
  sessionTimestamp,
  buildUnnamedDayCollisionTimes,
} from './ClientSessionsPage.disambiguation';

/**
 * Resolve a session's display title for list cards.
 *
 * `isNamed` distinguishes a real, user-given name from the generic fallback. Only
 * a real name earns the Caveat accent face (a wall of identical "Sesja" cards in
 * handwriting script reads as noise), so the accent is applied at the call site
 * only when `isNamed` is true.
 *
 * `dateFallback` (default true) appends the creation date to the generic fallback
 * ("Sesja · 10 maja 2026") so identical cards stay distinct; opt out where the
 * card renders its own date line (the archive timeline card).
 *
 * `disambiguationTime` ("HH:MM"), for an UNNAMED session, appends the wall-clock time
 * ("{date}, {HH:MM}" or "{base} {HH:MM}" without dateFallback); `isNamed` stays false.
 */
export function resolveSessionDisplayName(
  s: SessionContainerDTO,
  locale: string,
  t: ReturnType<typeof useTranslations<'pages.sessions'>>,
  dateFallback = true,
  disambiguationTime?: string
): { label: string; isNamed: boolean } {
  const trimmed = s.name?.trim();
  if (trimmed !== undefined && trimmed.length > 0) {
    return { label: trimmed, isNamed: true };
  }
  const base = t('sessionFallbackName');
  const hasTime =
    disambiguationTime !== undefined && disambiguationTime.length > 0;
  if (!dateFallback) {
    return {
      label: hasTime ? `${base} ${disambiguationTime}` : base,
      isNamed: false,
    };
  }
  // DECISION: the date comes from sessionTimestamp (sharedAt > closedAt > createdAt), NOT
  // s.createdAt. The collision disambiguation (buildUnnamedDayCollisionTimes) groups and formats
  // time by sessionTimestamp, and TimelineCard also renders its date from sessionTimestamp;
  // createdAt was the lone outlier: for a SHARED session (createdAt day differs from sharedAt day)
  // the label showed the createdAt date while the collision was computed by sharedAt, so a
  // disambiguation time was appended when the labels already differed and skipped when they were
  // identical. One source = consistency.
  const date = formatAbsoluteDate(sessionTimestamp(s), locale);
  // Unnamed with a date = the date ALONE (the card's subtitle says „Sesja
  // inspiracji”, so „Sesja · {date}” doubled the word; also a Marcellus zero in
  // the year read as an O, so the call site renders the date in sans).
  const dateLabel = date.length > 0 ? date : base;
  return {
    label: hasTime ? `${dateLabel}, ${disambiguationTime}` : dateLabel,
    isNamed: false,
  };
}

/** "10 maja 2026" / "May 10, 2026" / "10. Mai 2026" absolute date. */
export function formatAbsoluteDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const day = d.getUTCDate();
  const monthName = getMonthsForLocale(locale).full[d.getUTCMonth()] ?? '';
  const year = d.getUTCFullYear();
  if (locale.startsWith('en')) {
    const cap = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    return `${cap} ${day}, ${year}`;
  }
  if (locale.startsWith('de')) {
    const cap = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    return `${day}. ${cap} ${year}`;
  }
  // PL: a day date needs the GENITIVE of the month ("4 czerwca 2026"), NOT the
  // nominative ("4 czerwiec"). PL_MONTHS_FULL is nominative (for
  // monthLabelParts "Czerwiec 2026"); the genitive has its own table.
  return `${day} ${PL_MONTHS_GENITIVE[d.getUTCMonth()] ?? monthName} ${year}`;
}

/** Format relative past: "3 dni temu" / "3 days ago" / "vor 3 Tagen" */
export function formatRelativePast(
  iso: string,
  t: ReturnType<typeof useTranslations<'pages.sessions'>>
): string {
  // Delegates to the shared SSOT (sessionTime.formatters) — the same
  // days/hours/just-now ladder lived here as a second copy. Invalid or future
  // timestamps collapse to „just now" (empty label from the SSOT).
  return formatTimeSinceShared(iso, t) || t('sharedJustNow');
}

/* ============================================================
 * Lifecycle state helpers — label, color, pulse heuristics.
 * ============================================================ */

export function formatDaysRemaining(
  expiresAt: string | null,
  t: ReturnType<typeof useTranslations<'pages.sessions'>>,
  locale: string
): string {
  // The detail page's sentence: until when the stylist sees the session.
  return formatExpiryDeadline(expiresAt, t, t('statusDraft'), 'client', locale);
}

/** The list row's wording: the remaining time stands beside the status pill
 *  („Udostępniona” + „Pozostało 6 dni”), not inside it. */
export function formatDaysRemainingAfterStatus(
  expiresAt: string | null,
  t: ReturnType<typeof useTranslations<'pages.sessions'>>,
  locale: string
): string {
  return formatExpiryRemaining(expiresAt, t, t('statusDraft'), locale);
}

export function getLifecycleLabel(
  state: SessionContainerDTO['lifecycleState'],
  t: ReturnType<typeof useTranslations<'pages.sessions'>>
): string {
  switch (state) {
    case SessionContainerLifecycleStateValue.DRAFT:
      return t('statusDraft');
    case SessionContainerLifecycleStateValue.READY:
      return t('statusReady');
    case SessionContainerLifecycleStateValue.SHARED:
      return t('statusShared');
    case SessionContainerLifecycleStateValue.ACTIVE:
      return t('statusActive');
    case SessionContainerLifecycleStateValue.EXPIRED:
      return t('statusExpired');
    case SessionContainerLifecycleStateValue.CLOSED:
      return t('statusClosed');
    default: {
      const _exhaustive: never = state;
      void _exhaustive;
      return '';
    }
  }
}

/** Returns a semantic CSS color token for OKLCH-mixed status tinting. */
export function getLifecycleColor(
  state: SessionContainerDTO['lifecycleState']
): string {
  switch (state) {
    case SessionContainerLifecycleStateValue.SHARED:
    case SessionContainerLifecycleStateValue.ACTIVE:
      return 'var(--color-success)';
    /* DECISION: DRAFT/READY = --color-accent-fg, NOT --color-warning. Warning flips its
       perceived colour between modes (light #b45309 = brick, dark #fbbf24 = gold), so a "Szkic"
       chip changed semantic colour with the theme. accent-fg is a mode-aware gold pair with
       fixed semantics; it applies to ALL status chips (the list and both details). */
    case SessionContainerLifecycleStateValue.DRAFT:
    case SessionContainerLifecycleStateValue.READY:
      return 'var(--color-accent-fg)';
    case SessionContainerLifecycleStateValue.EXPIRED:
    case SessionContainerLifecycleStateValue.CLOSED:
      return 'var(--color-text-secondary)';
    default: {
      const _exhaustive: never = state;
      void _exhaustive;
      return 'var(--color-primary)';
    }
  }
}

/** Should the status dot pulse? (true for live states only) */
export function shouldPulseStatus(
  state: SessionContainerDTO['lifecycleState']
): boolean {
  return isActiveSession(state);
}

/* Groups archive sessions by month (YYYY-MM) using the most meaningful timestamp (sharedAt >
   closedAt > createdAt). A Map preserves the descending insertion order of the cursor-paginated
   API; inside a month sessions are sorted newest first, invalid timestamps last (a NaN
   comparison would destabilise the sort). Each group renders with a sticky month header. */
export function groupSessionsByMonth(
  sessions: readonly SessionContainerDTO[]
): ReadonlyArray<readonly [string, SessionContainerDTO[]]> {
  const map = new Map<string, SessionContainerDTO[]>();
  for (const s of sessions) {
    const key = monthKey(sessionTimestamp(s));
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => {
      const ta = new Date(sessionTimestamp(a)).getTime();
      const tb = new Date(sessionTimestamp(b)).getTime();
      if (Number.isNaN(ta) && Number.isNaN(tb)) {
        return 0;
      }
      if (Number.isNaN(ta)) {
        return 1;
      }
      if (Number.isNaN(tb)) {
        return -1;
      }
      return tb - ta;
    });
  }
  return Array.from(map.entries());
}
