// co-located unit tests — characterise CURRENT behaviour of
// ClientSessionDetailPage.formatters (pure time helper).
// Uses fake timers so diff-based assertions are deterministic.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tFormatTimeSinceShared } from './ClientSessionDetailPage.formatters';

// ---------------------------------------------------------------------------
// Minimal translation stub matching keys used by this function.
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
