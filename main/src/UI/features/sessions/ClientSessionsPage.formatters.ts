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

// PL dopelniacz (genitive) dla DAT DZIENNYCH ("4 czerwca 2026"), oddzielnie od
// PL_MONTHS_FULL (nominative — dla naglowkow miesiaca typu "Czerwiec 2026").
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
 *  tabular-nums): Marcellus renders 0 like the letter O (census S26). */
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
// `sessionTimestamp` is ALSO defined in ./ClientSessionsPage.disambiguation and
// re-exported here. It used to live in this file, but disambiguation needs it
// and importing it back from here created a value↔value import cycle (madge
// skipTypeImports). Owning it in the leaf module (disambiguation imports nothing
// from this file) breaks the cycle while keeping this file the single import
// surface for all call sites (`sessionTimestamp` priority: sharedAt > closedAt > createdAt).
export {
  sessionTimestamp,
  buildUnnamedDayCollisionTimes,
} from './ClientSessionsPage.disambiguation';

/**
 * Resolve a session's display title for list cards.
 *
 * `isNamed` distinguishes a real, user-given session name from the generic
 * fallback. Only a real name earns the Caveat accent face (brand decision,
 * S18): a wall of identical "Sesja" cards rendered in handwriting script
 * reads as noise, not personality — so the accent is applied at the call site
 * only when `isNamed` is true.
 *
 * `dateFallback` (default true) appends the creation date to the generic
 * fallback ("Sesja · 10 maja 2026") so otherwise-identical cards stay visually
 * distinct. Opt out where the card already renders its own date line (e.g. the
 * archive timeline card) to avoid a redundant double-date.
 *
 * `disambiguationTime` ("HH:MM"), when supplied for an UNNAMED session, appends
 * the wall-clock time so two unnamed sessions on the same day stay distinct
 * (owner vote S27 #3, variant A). Applied per `dateFallback`:
 *  - dateFallback=true  (ActiveSessionCard, label = bare date):
 *      "{date}, {HH:MM}"  e.g. "13 czerwca 2026, 11:15"
 *  - dateFallback=false (TimelineCard, label = bare base "Sesja", card has its
 *      own date-line below): "{base} {HH:MM}"  e.g. "Sesja 11:15"
 * Does NOT re-introduce the S25 "Sesja"-doubling: TimelineCard has no "Sesja
 * inspiracji" subtitle, and ActiveSessionCard's label is a date (not "Sesja").
 * `isNamed` stays false — a time is not a proper name, so no Caveat accent.
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
  // DECISION (nie usuwaj tego komentarza): data z sessionTimestamp (sharedAt >
  // closedAt > createdAt), NIE z s.createdAt. Kolizja-dezambiguacja
  // (buildUnnamedDayCollisionTimes) grupuje i formatuje czas po sessionTimestamp,
  // TimelineCard też renderuje datę z sessionTimestamp — createdAt było jedynym
  // outlierem: dla sesji SHARED (createdAt ≠ sharedAt-dzień) etykieta pokazywała
  // datę createdAt a kolizja liczyła się po sharedAt → disambiguation-time doklejany
  // gdy etykiety już różne / pomijany gdy identyczne. Jedno źródło = spójność.
  const date = formatAbsoluteDate(sessionTimestamp(s), locale);
  // Unnamed z datą = SAMA data (subtitle karty mówi „Sesja inspiracji" —
  // „Sesja · {data}" dublowało słowo; do tego zero Marcellusa w roku
  // czytało się jak O, więc call-site renderuje datę w sans — S25).
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
  // PL: data dzienna wymaga DOPELNIACZA miesiaca ("4 czerwca 2026"), NIE
  // mianownika ("4 czerwiec"). PL_MONTHS_FULL jest nominative (dla
  // monthLabelParts "Czerwiec 2026"); tu osobna tabela genitive.
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
  t: ReturnType<typeof useTranslations<'pages.sessions'>>
): string {
  // Delegates to the shared SSOT (sessionTime.formatters); empty-label = statusDraft.
  return formatExpiryRemaining(expiresAt, t, t('statusDraft'));
}

/** The list row's wording: the time continues the status pill before it
 *  („Udostępniona” + „jeszcze 6 dni”). The detail page keeps the sentence. */
export function formatDaysRemainingAfterStatus(
  expiresAt: string | null,
  t: ReturnType<typeof useTranslations<'pages.sessions'>>
): string {
  return formatExpiryRemaining(expiresAt, t, t('statusDraft'), 'afterStatus');
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
    /* DECISION (nie usuwaj tego komentarza):
     * DRAFT/READY = --color-accent-fg, NIE --color-warning. Warning flipuje
     * postrzegany kolor między trybami (light #b45309 = ceglany, dark
     * #fbbf24 = złoty) — chip „Szkic" zmieniał kolor semantyczny zależnie
     * od motywu (S25). accent-fg to mode-aware para złota o stałej
     * semantyce; obowiązuje WSZYSTKIE chipy statusu (lista + oba detale). */
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
