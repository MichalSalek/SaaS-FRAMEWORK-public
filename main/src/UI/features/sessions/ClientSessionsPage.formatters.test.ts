// co-located unit tests — characterise CURRENT behaviour of pure formatters.
// All time-dependent functions receive explicit ISO inputs (no Date.now() in
// happy-path assertions); formatRelativePast and formatDaysRemaining are tested
// by controlling the reference time via fake timers so the suite stays
// deterministic regardless of when it runs.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';

import {
  getMonthsForLocale,
  monthKey,
  monthLabelParts,
  sessionTimestamp,
  resolveSessionDisplayName,
  formatAbsoluteDate,
  formatRelativePast,
  formatDaysRemaining,
  formatDaysRemainingAfterStatus,
  getLifecycleLabel,
  getLifecycleColor,
  shouldPulseStatus,
} from './ClientSessionsPage.formatters';

// ---------------------------------------------------------------------------
// Minimal translation stub — only the keys used by the tested functions.
// ---------------------------------------------------------------------------
function makeMockT(overrides: Record<string, string> = {}) {
  const defaults: Record<
    string,
    string | ((params: Record<string, unknown>) => string)
  > = {
    sessionFallbackName: 'Sesja',
    statusDraft: 'Szkic',
    statusReady: 'Gotowa',
    statusShared: 'Udostępniona',
    statusActive: 'Aktywna',
    statusExpired: 'Wygasła',
    statusClosed: 'Zamknięta',
    sharedJustNow: 'Przed chwilą',
    sharedHoursAgo: (params: Record<string, unknown>) =>
      `${Number(params['hours'])} godz. temu`,
    sharedDaysAgo: (params: Record<string, unknown>) =>
      `${Number(params['days'])} dni temu`,
    expiresInDays: (params: Record<string, unknown>) =>
      `${Number(params['days'])} dni`,
    expiresSoon: 'za chwilę',
    expiresInHours: (params: Record<string, unknown>) =>
      `${Number(params['hours'])} godz.`,
    remainingDays: (params: Record<string, unknown>) =>
      `jeszcze ${Number(params['days'])} dni`,
    remainingHours: (params: Record<string, unknown>) =>
      `jeszcze ${Number(params['hours'])} godz.`,
    remainingSoon: 'jeszcze chwilę',
    ...overrides,
  };

  // Mimics the shape returned by next-intl useTranslations
  return function t(key: string, params?: Record<string, unknown>): string {
    const val = defaults[key];
    if (typeof val === 'function') {
      return (val as (p: Record<string, unknown>) => string)(params ?? {});
    }
    return (val as string | undefined) ?? key;
  };
}

// ---------------------------------------------------------------------------
// Minimal DTO factory
// ---------------------------------------------------------------------------
function makeSession(
  overrides: Partial<SessionContainerDTO> = {}
): SessionContainerDTO {
  return {
    id: 'sess-1',
    clientAccountId: 'client-1',
    clientName: null,
    clientUserId: null,
    stylistAccountId: null,
    name: null,
    lifecycleState: SessionContainerLifecycleStateValue.DRAFT,
    stylistNote: null,
    clientNote: null,
    sharedAt: null,
    expiresAt: null,
    closedAt: null,
    createdAt: '2026-05-10T09:00:00.000Z',
    updatedAt: '2026-05-10T09:00:00.000Z',
    photoCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getMonthsForLocale
// ---------------------------------------------------------------------------
describe('getMonthsForLocale', () => {
  it('returns English months for "en" locale', () => {
    const { full, abbr } = getMonthsForLocale('en');
    expect(full[0]).toBe('January');
    expect(full[11]).toBe('December');
    expect(abbr[0]).toBe('Jan');
    expect(abbr[11]).toBe('Dec');
  });

  it('returns English months for "en-US" locale (startsWith match)', () => {
    const { full } = getMonthsForLocale('en-US');
    expect(full[3]).toBe('April');
  });

  it('returns German months for "de" locale', () => {
    const { full, abbr } = getMonthsForLocale('de');
    expect(full[0]).toBe('Januar');
    expect(full[2]).toBe('März');
    expect(abbr[2]).toBe('Mär');
    expect(abbr[9]).toBe('Okt');
  });

  it('returns German months for "de-DE" locale (startsWith match)', () => {
    const { full } = getMonthsForLocale('de-DE');
    expect(full[0]).toBe('Januar');
  });

  it('returns Polish months for "pl" locale (default fallback)', () => {
    const { full, abbr } = getMonthsForLocale('pl');
    expect(full[0]).toBe('styczeń');
    expect(full[4]).toBe('maj');
    expect(abbr[0]).toBe('sty');
    expect(abbr[5]).toBe('cze');
  });

  it('returns Polish months for any unrecognised locale (default fallback)', () => {
    const { full } = getMonthsForLocale('fr');
    expect(full[0]).toBe('styczeń');
  });

  it('returns arrays of length 12 for all supported locales', () => {
    for (const locale of ['pl', 'en', 'de', 'fr']) {
      const { full, abbr } = getMonthsForLocale(locale);
      expect(full.length).toBe(12);
      expect(abbr.length).toBe(12);
    }
  });
});

// ---------------------------------------------------------------------------
// monthKey
// ---------------------------------------------------------------------------
describe('monthKey', () => {
  it('returns YYYY-MM for a valid ISO timestamp', () => {
    expect(monthKey('2026-05-10T09:00:00.000Z')).toBe('2026-05');
  });

  it('uses UTC month (not local) — January stays "01" regardless of TZ offset', () => {
    // 2026-01-01T00:30:00Z should always be "2026-01"
    expect(monthKey('2026-01-01T00:30:00.000Z')).toBe('2026-01');
  });

  it('returns "0000-00" for an invalid ISO string', () => {
    expect(monthKey('not-a-date')).toBe('0000-00');
  });

  it('returns "0000-00" for an empty string', () => {
    expect(monthKey('')).toBe('0000-00');
  });

  it('pads month with leading zero for months 1–9', () => {
    expect(monthKey('2026-03-15T00:00:00.000Z')).toBe('2026-03');
    expect(monthKey('2026-09-01T00:00:00.000Z')).toBe('2026-09');
  });
});

// ---------------------------------------------------------------------------
// monthLabelParts
// ---------------------------------------------------------------------------
describe('monthLabelParts', () => {
  it('returns capitalised PL nominative month name + year for "pl" locale', () => {
    const result = monthLabelParts('2026-05-10T00:00:00.000Z', 'pl');
    expect(result).toEqual({ month: 'Maj', year: '2026' });
  });

  it('returns capitalised EN month + year for "en" locale', () => {
    const result = monthLabelParts('2026-01-15T00:00:00.000Z', 'en');
    expect(result).toEqual({ month: 'January', year: '2026' });
  });

  it('returns capitalised DE month + year for "de" locale', () => {
    const result = monthLabelParts('2026-03-01T00:00:00.000Z', 'de');
    expect(result).toEqual({ month: 'März', year: '2026' });
  });

  it('returns null for an invalid ISO string', () => {
    expect(monthLabelParts('bad-date', 'pl')).toBeNull();
  });

  it('uses UTC month — December 31 at 23:00 UTC is still December', () => {
    const result = monthLabelParts('2025-12-31T23:00:00.000Z', 'pl');
    expect(result?.month).toBe('Grudzień');
  });
});

// ---------------------------------------------------------------------------
// sessionTimestamp
// ---------------------------------------------------------------------------
describe('sessionTimestamp', () => {
  it('returns sharedAt when present (highest priority)', () => {
    const s = makeSession({
      sharedAt: '2026-05-15T10:00:00.000Z',
      closedAt: '2026-05-20T10:00:00.000Z',
      createdAt: '2026-05-01T10:00:00.000Z',
    });
    expect(sessionTimestamp(s)).toBe('2026-05-15T10:00:00.000Z');
  });

  it('falls back to closedAt when sharedAt is null', () => {
    const s = makeSession({
      sharedAt: null,
      closedAt: '2026-05-20T10:00:00.000Z',
      createdAt: '2026-05-01T10:00:00.000Z',
    });
    expect(sessionTimestamp(s)).toBe('2026-05-20T10:00:00.000Z');
  });

  it('falls back to createdAt when both sharedAt and closedAt are null', () => {
    const s = makeSession({
      sharedAt: null,
      closedAt: null,
      createdAt: '2026-05-01T10:00:00.000Z',
    });
    expect(sessionTimestamp(s)).toBe('2026-05-01T10:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// formatAbsoluteDate
// ---------------------------------------------------------------------------
describe('formatAbsoluteDate', () => {
  it('formats PL date using genitive month ("10 maja 2026")', () => {
    // May is index 4 — genitive "maja", NOT nominative "maj"
    expect(formatAbsoluteDate('2026-05-10T00:00:00.000Z', 'pl')).toBe(
      '10 maja 2026'
    );
  });

  it('formats PL date for June ("4 czerwca 2026")', () => {
    expect(formatAbsoluteDate('2026-06-04T00:00:00.000Z', 'pl')).toBe(
      '4 czerwca 2026'
    );
  });

  it('formats EN date as "Month Day, Year"', () => {
    expect(formatAbsoluteDate('2026-05-10T00:00:00.000Z', 'en')).toBe(
      'May 10, 2026'
    );
  });

  it('formats DE date as "Day. Month Year"', () => {
    expect(formatAbsoluteDate('2026-05-10T00:00:00.000Z', 'de')).toBe(
      '10. Mai 2026'
    );
  });

  it('capitalises month name in EN and DE', () => {
    const enResult = formatAbsoluteDate('2026-01-01T00:00:00.000Z', 'en');
    expect(enResult.startsWith('January')).toBe(true);

    const deResult = formatAbsoluteDate('2026-03-01T00:00:00.000Z', 'de');
    expect(deResult.startsWith('1. März')).toBe(true);
  });

  it('returns empty string for invalid ISO input', () => {
    expect(formatAbsoluteDate('not-a-date', 'pl')).toBe('');
  });

  it('uses UTC date — avoids local-timezone day drift', () => {
    // 2026-05-01T00:00:00Z must render as "1 maja" (UTC day 1), not day 30
    expect(formatAbsoluteDate('2026-05-01T00:00:00.000Z', 'pl')).toBe(
      '1 maja 2026'
    );
  });
});

// ---------------------------------------------------------------------------
// formatRelativePast — uses fake timers for determinism
// ---------------------------------------------------------------------------
describe('formatRelativePast', () => {
  const BASE_ISO = '2026-06-10T12:00:00.000Z';
  const BASE_MS = new Date(BASE_ISO).getTime();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "przed chwilą" when diff < 1 hour', () => {
    vi.setSystemTime(BASE_MS + 30 * 60 * 1000); // +30 min
    const t = makeMockT() as Parameters<typeof formatRelativePast>[1];
    expect(formatRelativePast(BASE_ISO, t)).toBe('Przed chwilą');
  });

  it('returns hours ago when diff is between 1 and 23 hours', () => {
    vi.setSystemTime(BASE_MS + 3 * 60 * 60 * 1000); // +3 h
    const t = makeMockT() as Parameters<typeof formatRelativePast>[1];
    expect(formatRelativePast(BASE_ISO, t)).toBe('3 godz. temu');
  });

  it('returns days ago when diff >= 1 day', () => {
    vi.setSystemTime(BASE_MS + 3 * 24 * 60 * 60 * 1000); // +3 days
    const t = makeMockT() as Parameters<typeof formatRelativePast>[1];
    expect(formatRelativePast(BASE_ISO, t)).toBe('3 dni temu');
  });

  it('returns "przed chwilą" for a future timestamp (diff < 0)', () => {
    vi.setSystemTime(BASE_MS - 60 * 1000); // 1 min before the event
    const t = makeMockT() as Parameters<typeof formatRelativePast>[1];
    expect(formatRelativePast(BASE_ISO, t)).toBe('Przed chwilą');
  });

  it('returns "przed chwilą" for an invalid ISO string', () => {
    vi.setSystemTime(BASE_MS);
    const t = makeMockT() as Parameters<typeof formatRelativePast>[1];
    expect(formatRelativePast('not-a-date', t)).toBe('Przed chwilą');
  });
});

// ---------------------------------------------------------------------------
// formatDaysRemaining — uses fake timers
// ---------------------------------------------------------------------------
describe('formatDaysRemaining', () => {
  const BASE_MS = new Date('2026-06-10T12:00:00.000Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns statusDraft when expiresAt is null', () => {
    const t = makeMockT() as Parameters<typeof formatDaysRemaining>[1];
    expect(formatDaysRemaining(null, t)).toBe('Szkic');
  });

  it('returns statusExpired when expiresAt is in the past', () => {
    const t = makeMockT() as Parameters<typeof formatDaysRemaining>[1];
    expect(formatDaysRemaining('2026-06-09T00:00:00.000Z', t)).toBe('Wygasła');
  });

  it('returns statusExpired when expiresAt equals now (diff = 0)', () => {
    const t = makeMockT() as Parameters<typeof formatDaysRemaining>[1];
    expect(formatDaysRemaining('2026-06-10T12:00:00.000Z', t)).toBe('Wygasła');
  });

  it('returns whole days when more than 1 day remains', () => {
    const t = makeMockT() as Parameters<typeof formatDaysRemaining>[1];
    // 2 days and 3 hours from BASE_MS
    const expiresAt = new Date(
      BASE_MS + (2 * 24 + 3) * 60 * 60 * 1000
    ).toISOString();
    expect(formatDaysRemaining(expiresAt, t)).toBe('2 dni');
  });

  it('returns hours only when less than 1 day remains', () => {
    const t = makeMockT() as Parameters<typeof formatDaysRemaining>[1];
    const expiresAt = new Date(BASE_MS + 5 * 60 * 60 * 1000).toISOString();
    expect(formatDaysRemaining(expiresAt, t)).toBe('5 godz.');
  });

  it('returns statusExpired for an invalid ISO expiresAt', () => {
    const t = makeMockT() as Parameters<typeof formatDaysRemaining>[1];
    expect(formatDaysRemaining('not-a-date', t)).toBe('Wygasła');
  });

  // The list row puts the time right after the status pill, so it reads as
  // the pill's continuation; the same clock, another set of strings.
  it('words the time as a continuation of the status in a list row', () => {
    const t = makeMockT() as Parameters<typeof formatDaysRemaining>[1];
    const hour = 60 * 60 * 1000;
    expect(
      formatDaysRemainingAfterStatus(
        new Date(BASE_MS + (2 * 24 + 3) * hour).toISOString(),
        t
      )
    ).toBe('jeszcze 2 dni');
    expect(
      formatDaysRemainingAfterStatus(
        new Date(BASE_MS + 5 * hour).toISOString(),
        t
      )
    ).toBe('jeszcze 5 godz.');
    expect(
      formatDaysRemainingAfterStatus(
        new Date(BASE_MS + 10 * 60 * 1000).toISOString(),
        t
      )
    ).toBe('jeszcze chwilę');
    expect(formatDaysRemainingAfterStatus(null, t)).toBe('Szkic');
  });
});

// ---------------------------------------------------------------------------
// getLifecycleLabel
// ---------------------------------------------------------------------------
describe('getLifecycleLabel', () => {
  const t = makeMockT() as Parameters<typeof getLifecycleLabel>[1];

  it.each([
    [SessionContainerLifecycleStateValue.DRAFT, 'Szkic'],
    [SessionContainerLifecycleStateValue.READY, 'Gotowa'],
    [SessionContainerLifecycleStateValue.SHARED, 'Udostępniona'],
    [SessionContainerLifecycleStateValue.ACTIVE, 'Aktywna'],
    [SessionContainerLifecycleStateValue.EXPIRED, 'Wygasła'],
    [SessionContainerLifecycleStateValue.CLOSED, 'Zamknięta'],
  ])('maps %s -> "%s"', (state, expected) => {
    expect(getLifecycleLabel(state, t)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// getLifecycleColor
// ---------------------------------------------------------------------------
describe('getLifecycleColor', () => {
  it('returns success color for SHARED state', () => {
    expect(getLifecycleColor(SessionContainerLifecycleStateValue.SHARED)).toBe(
      'var(--color-success)'
    );
  });

  it('returns success color for ACTIVE state', () => {
    expect(getLifecycleColor(SessionContainerLifecycleStateValue.ACTIVE)).toBe(
      'var(--color-success)'
    );
  });

  it('returns accent-fg color for DRAFT state (not warning — mode-aware gold)', () => {
    expect(getLifecycleColor(SessionContainerLifecycleStateValue.DRAFT)).toBe(
      'var(--color-accent-fg)'
    );
  });

  it('returns accent-fg color for READY state', () => {
    expect(getLifecycleColor(SessionContainerLifecycleStateValue.READY)).toBe(
      'var(--color-accent-fg)'
    );
  });

  it('returns text-secondary color for EXPIRED state', () => {
    expect(getLifecycleColor(SessionContainerLifecycleStateValue.EXPIRED)).toBe(
      'var(--color-text-secondary)'
    );
  });

  it('returns text-secondary color for CLOSED state', () => {
    expect(getLifecycleColor(SessionContainerLifecycleStateValue.CLOSED)).toBe(
      'var(--color-text-secondary)'
    );
  });
});

// ---------------------------------------------------------------------------
// shouldPulseStatus
// ---------------------------------------------------------------------------
describe('shouldPulseStatus', () => {
  it('returns true for SHARED (live state)', () => {
    expect(shouldPulseStatus(SessionContainerLifecycleStateValue.SHARED)).toBe(
      true
    );
  });

  it('returns true for ACTIVE (live state)', () => {
    expect(shouldPulseStatus(SessionContainerLifecycleStateValue.ACTIVE)).toBe(
      true
    );
  });

  it.each([
    SessionContainerLifecycleStateValue.DRAFT,
    SessionContainerLifecycleStateValue.READY,
    SessionContainerLifecycleStateValue.EXPIRED,
    SessionContainerLifecycleStateValue.CLOSED,
  ])('returns false for non-live state %s', state => {
    expect(shouldPulseStatus(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveSessionDisplayName
// ---------------------------------------------------------------------------
describe('resolveSessionDisplayName', () => {
  const t = makeMockT() as Parameters<typeof resolveSessionDisplayName>[2];

  describe('named session', () => {
    it('returns the session name and isNamed=true', () => {
      const s = makeSession({ name: 'Jesienne inspiracje' });
      const result = resolveSessionDisplayName(s, 'pl', t);
      expect(result).toEqual({ label: 'Jesienne inspiracje', isNamed: true });
    });

    it('trims whitespace from the name', () => {
      const s = makeSession({ name: '  Wiosna 2026  ' });
      const result = resolveSessionDisplayName(s, 'pl', t);
      expect(result).toEqual({ label: 'Wiosna 2026', isNamed: true });
    });

    it('ignores disambiguationTime for a named session', () => {
      const s = makeSession({ name: 'Moja sesja' });
      const result = resolveSessionDisplayName(s, 'pl', t, true, '11:15');
      expect(result).toEqual({ label: 'Moja sesja', isNamed: true });
    });
  });

  describe('unnamed session (name = null or whitespace-only)', () => {
    it('treats null name as unnamed', () => {
      const s = makeSession({
        name: null,
        createdAt: '2026-05-10T00:00:00.000Z',
      });
      const result = resolveSessionDisplayName(s, 'pl', t);
      expect(result.isNamed).toBe(false);
    });

    it('treats whitespace-only name as unnamed', () => {
      const s = makeSession({
        name: '   ',
        createdAt: '2026-05-10T00:00:00.000Z',
      });
      const result = resolveSessionDisplayName(s, 'pl', t);
      expect(result.isNamed).toBe(false);
    });

    describe('dateFallback=true (default)', () => {
      it('returns the absolute date as label (not "Sesja")', () => {
        const s = makeSession({
          name: null,
          createdAt: '2026-05-10T00:00:00.000Z',
        });
        const result = resolveSessionDisplayName(s, 'pl', t);
        // PL genitive: "10 maja 2026"
        expect(result.label).toBe('10 maja 2026');
        expect(result.isNamed).toBe(false);
      });

      it('appends disambiguation time after date with ", " separator', () => {
        const s = makeSession({
          name: null,
          createdAt: '2026-06-13T00:00:00.000Z',
        });
        const result = resolveSessionDisplayName(s, 'pl', t, true, '11:15');
        expect(result.label).toBe('13 czerwca 2026, 11:15');
        expect(result.isNamed).toBe(false);
      });

      it('falls back to "Sesja" label when createdAt is invalid', () => {
        const s = makeSession({ name: null, createdAt: 'bad-date' });
        const result = resolveSessionDisplayName(s, 'pl', t);
        expect(result.label).toBe('Sesja');
        expect(result.isNamed).toBe(false);
      });

      it('derives the date from sessionTimestamp (sharedAt), NOT createdAt', () => {
        // Ratchet: SHARED session whose createdAt (June 1) differs from sharedAt
        // (June 15). The label date MUST follow sessionTimestamp (sharedAt) so it
        // aligns with the disambiguation collision key + TimelineCard — createdAt
        // was the pre-fix outlier that broke unnamed-session disambiguation.
        const s = makeSession({
          name: null,
          createdAt: '2026-06-01T09:00:00.000Z',
          sharedAt: '2026-06-15T09:00:00.000Z',
          lifecycleState: SessionContainerLifecycleStateValue.SHARED,
        });
        const result = resolveSessionDisplayName(s, 'pl', t);
        expect(result.label).toBe('15 czerwca 2026');
      });
    });

    describe('dateFallback=false (timeline card)', () => {
      it('returns base fallback name ("Sesja") without date', () => {
        const s = makeSession({
          name: null,
          createdAt: '2026-05-10T00:00:00.000Z',
        });
        const result = resolveSessionDisplayName(s, 'pl', t, false);
        expect(result.label).toBe('Sesja');
        expect(result.isNamed).toBe(false);
      });

      it('appends disambiguation time with space separator (no date prefix)', () => {
        const s = makeSession({
          name: null,
          createdAt: '2026-06-13T00:00:00.000Z',
        });
        const result = resolveSessionDisplayName(s, 'pl', t, false, '11:15');
        expect(result.label).toBe('Sesja 11:15');
        expect(result.isNamed).toBe(false);
      });

      it('omits time when disambiguationTime is empty string', () => {
        const s = makeSession({
          name: null,
          createdAt: '2026-05-10T00:00:00.000Z',
        });
        const result = resolveSessionDisplayName(s, 'pl', t, false, '');
        expect(result.label).toBe('Sesja');
      });
    });

    it('does not apply Caveat accent (isNamed remains false) when disambiguation time is provided', () => {
      const s = makeSession({
        name: null,
        createdAt: '2026-06-13T00:00:00.000Z',
      });
      const result = resolveSessionDisplayName(s, 'pl', t, true, '09:30');
      expect(result.isNamed).toBe(false);
    });
  });
});
