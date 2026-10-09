import { describe, it, expect } from 'vitest';
import { formatRelativeDate, formatMessageTime } from './supportDate.helpers';
import { formatDate } from '../../../application/date/date.utils';

// Minimal stub for TSupport translation function
function makeT(
  overrides: Record<string, string> = {}
): Parameters<typeof formatRelativeDate>[1] {
  const defaults: Record<string, string> = {
    relativeNow: 'teraz',
    relativeMinutes: '{count} min',
    relativeHours: '{count} godz.',
    relativeDays: '{count} dni',
  };
  const map = { ...defaults, ...overrides };
  return ((key: string, params?: Record<string, unknown>) => {
    let result = map[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        result = result.replace(`{${k}}`, String(v));
      }
    }
    return result;
  }) as Parameters<typeof formatRelativeDate>[1];
}

// ─── formatRelativeDate ───────────────────────────────────────────────────

describe('formatRelativeDate', () => {
  it('returns relativeNow for dates less than 1 minute ago', () => {
    const t = makeT();
    const justNow = new Date(Date.now() - 30 * 1000); // 30 seconds ago
    expect(formatRelativeDate(justNow, t, 'pl-PL')).toBe('teraz');
  });

  it('returns relativeNow for date string less than 1 minute ago', () => {
    const t = makeT();
    const justNow = new Date(Date.now() - 30 * 1000).toISOString();
    expect(formatRelativeDate(justNow, t, 'pl-PL')).toBe('teraz');
  });

  it('returns relativeMinutes for dates 1–59 minutes ago', () => {
    const t = makeT();
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    expect(formatRelativeDate(thirtyMinAgo, t, 'pl-PL')).toBe('30 min');
  });

  it('returns relativeMinutes for exactly 1 minute ago', () => {
    const t = makeT();
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    expect(formatRelativeDate(oneMinAgo, t, 'pl-PL')).toBe('1 min');
  });

  it('returns relativeHours for 1–23 hours ago', () => {
    const t = makeT();
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    expect(formatRelativeDate(fiveHoursAgo, t, 'pl-PL')).toBe('5 godz.');
  });

  it('returns relativeHours for exactly 1 hour ago', () => {
    const t = makeT();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(formatRelativeDate(oneHourAgo, t, 'pl-PL')).toBe('1 godz.');
  });

  it('returns relativeDays for 1–6 days ago', () => {
    const t = makeT();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatRelativeDate(threeDaysAgo, t, 'pl-PL')).toBe('3 dni');
  });

  it('returns relativeDays for exactly 1 day ago', () => {
    const t = makeT();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(formatRelativeDate(oneDayAgo, t, 'pl-PL')).toBe('1 dni');
  });

  it('returns the project date format for dates older than 7 days', () => {
    const t = makeT();
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const result = formatRelativeDate(tenDaysAgo, t, 'en-US');
    // Should be a date string, not a relative label
    expect(result).toBe(formatDate(tenDaysAgo, 'en-US'));
  });

  it('never mixes padded and unpadded numeric days (pl: "5 wrz 2026", not "5.09.2026")', () => {
    const t = makeT();
    const single = formatRelativeDate(new Date(2026, 8, 5, 12), t, 'pl');
    const double = formatRelativeDate(new Date(2026, 8, 10, 12), t, 'pl');
    expect(single).toBe(formatDate(new Date(2026, 8, 5, 12), 'pl'));
    expect(double).toBe(formatDate(new Date(2026, 8, 10, 12), 'pl'));
    expect(single).not.toMatch(/\d+\.\d+\.\d{4}/);
  });

  it('accepts a date string as input', () => {
    const t = makeT();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeDate(twoHoursAgo, t, 'pl-PL')).toBe('2 godz.');
  });

  it('accepts a Date object as input', () => {
    const t = makeT();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    expect(formatRelativeDate(twoHoursAgo, t, 'pl-PL')).toBe('2 godz.');
  });

  it('returns locale date for exactly 7 days ago', () => {
    const t = makeT();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = formatRelativeDate(sevenDaysAgo, t, 'en-US');
    expect(result).toBe(formatDate(sevenDaysAgo, 'en-US'));
  });
});

// ─── formatMessageTime ────────────────────────────────────────────────────

describe('formatMessageTime', () => {
  it('returns a time string with HH:mm format for a Date object', () => {
    // Use a fixed date to make this deterministic
    const date = new Date('2024-06-15T14:35:00.000Z');
    const result = formatMessageTime(date, 'en-GB');
    // en-GB 2-digit hour + 2-digit minute with colon
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('accepts a date string as input', () => {
    const dateStr = '2024-06-15T09:05:00.000Z';
    const result = formatMessageTime(dateStr, 'en-GB');
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns a non-empty string for any valid date', () => {
    const result = formatMessageTime(new Date(), 'pl-PL');
    expect(result.length).toBeGreaterThan(0);
  });

  it('formats hour and minute with 2-digit padding', () => {
    // Create a time where both hour and minute are single digit
    // We check structurally — en-GB always returns HH:MM
    const date = new Date('2024-01-01T01:05:00.000Z');
    const result = formatMessageTime(date, 'en-GB');
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});
