// co-located unit tests — characterise CURRENT behaviour of
// ClientSessionDetailPage.formatters (pure time helpers).
// Uses fake timers so diff-based assertions are deterministic.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  tFormatDaysRemaining,
  tFormatTimeSinceShared,
} from './ClientSessionDetailPage.formatters';

// ---------------------------------------------------------------------------
// Minimal translation stub matching keys used by these two functions.
// ---------------------------------------------------------------------------
function makeMockT() {
  const map: Record<string, string | ((p: Record<string, unknown>) => string)> =
    {
      statusDraft: 'Szkic',
      statusExpired: 'Wygasła',
      sharedJustNow: 'Przed chwilą',
      sharedHoursAgo: (p: Record<string, unknown>) =>
        `${Number(p['hours'])} godz. temu`,
      sharedDaysAgo: (p: Record<string, unknown>) =>
        `${Number(p['days'])} dni temu`,
      expiresInDays: (p: Record<string, unknown>) => `${Number(p['days'])} dni`,
      expiresSoon: 'za chwilę',
      expiresInHours: (p: Record<string, unknown>) =>
        `${Number(p['hours'])} godz.`,
    };

  return function t(key: string, params?: Record<string, unknown>): string {
    const val = map[key];
    if (typeof val === 'function') {
      return (val as (p: Record<string, unknown>) => string)(params ?? {});
    }
    return (val as string | undefined) ?? key;
  };
}

// ---------------------------------------------------------------------------
// Fixed reference point for all fake-timer tests.
// ---------------------------------------------------------------------------
const BASE_MS = new Date('2026-06-10T12:00:00.000Z').getTime();

// ---------------------------------------------------------------------------
// tFormatDaysRemaining
// ---------------------------------------------------------------------------
describe('tFormatDaysRemaining', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns statusDraft when expiresAt is null', () => {
    const t = makeMockT() as Parameters<typeof tFormatDaysRemaining>[1];
    expect(tFormatDaysRemaining(null, t)).toBe('Szkic');
  });

  it('returns statusDraft when expiresAt is undefined-ish empty string (falsy)', () => {
    // The guard is `!expiresAt` which also catches empty string
    const t = makeMockT() as Parameters<typeof tFormatDaysRemaining>[1];
    expect(tFormatDaysRemaining('' as string | null, t)).toBe('Szkic');
  });

  it('returns statusExpired when expiresAt is in the past', () => {
    const t = makeMockT() as Parameters<typeof tFormatDaysRemaining>[1];
    expect(tFormatDaysRemaining('2026-06-09T00:00:00.000Z', t)).toBe('Wygasła');
  });

  it('returns statusExpired when diff is exactly 0 (boundary: diff <= 0 is expired)', () => {
    const t = makeMockT() as Parameters<typeof tFormatDaysRemaining>[1];
    expect(tFormatDaysRemaining('2026-06-10T12:00:00.000Z', t)).toBe('Wygasła');
  });

  it('returns whole days (hours dropped) when more than 1 full day remains', () => {
    const t = makeMockT() as Parameters<typeof tFormatDaysRemaining>[1];
    const expiresAt = new Date(
      BASE_MS + (2 * 24 + 5) * 60 * 60 * 1000
    ).toISOString();
    expect(tFormatDaysRemaining(expiresAt, t)).toBe('2 dni');
  });

  it('returns whole days when exactly N full days remain', () => {
    const t = makeMockT() as Parameters<typeof tFormatDaysRemaining>[1];
    const expiresAt = new Date(BASE_MS + 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(tFormatDaysRemaining(expiresAt, t)).toBe('3 dni');
  });

  it('returns hours-only string when less than 1 day remains', () => {
    const t = makeMockT() as Parameters<typeof tFormatDaysRemaining>[1];
    const expiresAt = new Date(BASE_MS + 7 * 60 * 60 * 1000).toISOString();
    expect(tFormatDaysRemaining(expiresAt, t)).toBe('7 godz.');
  });

  it('returns the "soon" label in the last hour instead of "0 godz."', () => {
    const t = makeMockT() as Parameters<typeof tFormatDaysRemaining>[1];
    const expiresAt = new Date(BASE_MS + 25 * 60 * 1000).toISOString();
    expect(tFormatDaysRemaining(expiresAt, t)).toBe('za chwilę');
  });

  it('returns statusExpired for a non-parseable ISO string (NaN diff)', () => {
    const t = makeMockT() as Parameters<typeof tFormatDaysRemaining>[1];
    expect(tFormatDaysRemaining('not-a-date', t)).toBe('Wygasła');
  });
});

// ---------------------------------------------------------------------------
// tFormatTimeSinceShared
// ---------------------------------------------------------------------------
describe('tFormatTimeSinceShared', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty string when sharedAt is null', () => {
    const t = makeMockT() as Parameters<typeof tFormatTimeSinceShared>[1];
    expect(tFormatTimeSinceShared(null, t)).toBe('');
  });

  it('returns empty string for an invalid ISO string (NaN diff)', () => {
    const t = makeMockT() as Parameters<typeof tFormatTimeSinceShared>[1];
    expect(tFormatTimeSinceShared('not-a-date', t)).toBe('');
  });

  it('returns sharedJustNow when shared less than 1 hour ago', () => {
    const t = makeMockT() as Parameters<typeof tFormatTimeSinceShared>[1];
    const sharedAt = new Date(BASE_MS - 20 * 60 * 1000).toISOString(); // 20 min ago
    expect(tFormatTimeSinceShared(sharedAt, t)).toBe('Przed chwilą');
  });

  it('returns sharedJustNow when shared exactly now (diff = 0)', () => {
    const t = makeMockT() as Parameters<typeof tFormatTimeSinceShared>[1];
    expect(tFormatTimeSinceShared('2026-06-10T12:00:00.000Z', t)).toBe(
      'Przed chwilą'
    );
  });

  it('returns hours-ago string when 1–23 hours have passed', () => {
    const t = makeMockT() as Parameters<typeof tFormatTimeSinceShared>[1];
    const sharedAt = new Date(BASE_MS - 4 * 60 * 60 * 1000).toISOString(); // 4 h ago
    expect(tFormatTimeSinceShared(sharedAt, t)).toBe('4 godz. temu');
  });

  it('returns days-ago string when 1 or more full days have passed', () => {
    const t = makeMockT() as Parameters<typeof tFormatTimeSinceShared>[1];
    const sharedAt = new Date(BASE_MS - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago
    expect(tFormatTimeSinceShared(sharedAt, t)).toBe('5 dni temu');
  });

  it('returns days-ago (not hours-ago) when 1 full day + some hours have elapsed', () => {
    const t = makeMockT() as Parameters<typeof tFormatTimeSinceShared>[1];
    const sharedAt = new Date(
      BASE_MS - (1 * 24 + 3) * 60 * 60 * 1000
    ).toISOString();
    expect(tFormatTimeSinceShared(sharedAt, t)).toBe('1 dni temu');
  });

  it('prioritises days branch over hours branch (days > 0 wins)', () => {
    const t = makeMockT() as Parameters<typeof tFormatTimeSinceShared>[1];
    // Exactly 48 hours = 2 full days, 0 hours leftover
    const sharedAt = new Date(BASE_MS - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(tFormatTimeSinceShared(sharedAt, t)).toBe('2 dni temu');
  });
});
