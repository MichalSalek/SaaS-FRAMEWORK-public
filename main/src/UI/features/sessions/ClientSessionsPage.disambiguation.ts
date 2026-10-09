// UI/features/sessions/ClientSessionsPage.disambiguation.ts
// Time-of-day disambiguation for UNNAMED sessions that share a calendar day
// (owner vote S27 #3, variant A). Extracted from ClientSessionsPage.formatters
// to keep that file under the 300 LOC max-lines rule; re-exported there so call
// sites keep importing from formatters. Pure functions, zero React.

import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';

/** Pick the most meaningful timestamp: sharedAt > closedAt > createdAt.
 *  Defined here (the leaf module) and re-exported from
 *  ./ClientSessionsPage.formatters so call sites keep a single import surface;
 *  living here avoids a value↔value import cycle with formatters. */
export function sessionTimestamp(s: SessionContainerDTO): string {
  return s.sharedAt ?? s.closedAt ?? s.createdAt;
}

/**
 * "HH:MM" (24h) — wall-clock time of day for the viewer.
 *
 * LOCAL time on purpose, unlike the date helpers in ClientSessionsPage.formatters
 * (which are UTC for stable month/day grouping keys that must not drift across
 * timezones). The sessions list is rendered fully CLIENT-SIDE after a TanStack
 * Query fetch (zero SSR of session data), so there is no server/client hydration
 * mismatch risk here — and a disambiguation time is only useful if it reads as
 * the user's own clock ("11:15"), not a UTC instant. `locale` is accepted for
 * signature symmetry/future need; 24h HH:MM is locale-neutral here.
 */
export function formatTimeOfDay(iso: string, _locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** True when a session has no real user-given name (same empty/whitespace rule
 *  as resolveSessionDisplayName). */
function isUnnamedSession(s: SessionContainerDTO): boolean {
  const trimmed = s.name?.trim();
  return trimmed === undefined || trimmed.length === 0;
}

/**
 * Build `id -> "HH:MM"` for every UNNAMED session that shares its displayed
 * calendar day with ANOTHER unnamed session in the same list. Named sessions and
 * lone-on-their-day unnamed sessions are omitted (no entry => no time suffix).
 * Compute once over the full list (active + archive together) so a same-day
 * collision straddling the active/archive split or a month boundary is caught.
 *
 * DECISION (nie usuwaj tego komentarza): klucz dnia liczony w UTC
 * (`getUTCFullYear/Month/Date`), NIE lokalnie. Dezambiguacja istnieje po to, by
 * rozróżnić karty pokazujące TĘ SAMĄ WYŚWIETLANĄ datę, a ta pochodzi z
 * formatAbsoluteDate/monthKey — wszystkie UTC (stabilny klucz grupowania bez
 * dryfu TZ). Klucz lokalny rozjeżdżał się z etykietą na granicy północy UTC:
 * dwie karty z identyczną datą UTC lądowały w różnych bucketach lokalnych →
 * brak sufiksu, kolizja przetrwa; i odwrotnie — różne daty UTC z tym samym dniem
 * lokalnym dostawały zbędny sufiks. formatTimeOfDay ZOSTAJE lokalny (zegar
 * ścienny użytkownika) — to tylko dystynktor, nie musi dzielić bazy TZ z datą.
 * OGRANICZENIE (świadome): sufiks to HH:MM, więc dwie sesje w tej samej minucie
 * dostają identyczny sufiks i pozostają nierozróżnialne — skrajnie rzadkie okno
 * (dwa drafty/share w tej samej minucie); sekundy/ordinal brzydziłyby 99,9%
 * przypadków, więc akceptujemy tę granicę zamiast ją komplikować.
 */
export function buildUnnamedDayCollisionTimes(
  sessions: readonly SessionContainerDTO[],
  locale: string
): Map<string, string> {
  const byDay = new Map<string, SessionContainerDTO[]>();
  for (const s of sessions) {
    if (!isUnnamedSession(s)) {
      continue;
    }
    const d = new Date(sessionTimestamp(s));
    const key = Number.isNaN(d.getTime())
      ? ''
      : `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  const result = new Map<string, string>();
  for (const list of byDay.values()) {
    if (list.length < 2) {
      continue;
    }
    for (const s of list) {
      result.set(s.id, formatTimeOfDay(sessionTimestamp(s), locale));
    }
  }
  return result;
}
