import { describe, expect, it } from 'vitest';
import { formatRemainingValue } from '../sessionTime.formatters';

const plain = (value: string | null) => value?.replaceAll('\u00a0', ' ');

describe('session expiry remaining value', () => {
  const now = Date.UTC(2026, 10, 8, 12, 0, 0);

  it('keeps days, hours and minutes in both the detail and the row', () => {
    const expiresAt = new Date(
      now + 13 * 86_400_000 + 4 * 3_600_000 + 22 * 60_000
    ).toISOString();
    expect(plain(formatRemainingValue(expiresAt, 'pl-PL', now))).toBe(
      '13 dni 4 godz. 22 min'
    );
  });

  it('omits zero units instead of printing 0 godz. 0 min', () => {
    const expiresAt = new Date(now + 13 * 86_400_000).toISOString();
    expect(plain(formatRemainingValue(expiresAt, 'pl-PL', now))).toBe('13 dni');
  });

  it('returns null once the deadline has passed', () => {
    expect(
      formatRemainingValue(new Date(now - 1_000).toISOString(), 'pl-PL', now)
    ).toBeNull();
  });

  it('uses the soon fallback while less than one whole minute remains', () => {
    expect(
      formatRemainingValue(new Date(now + 59_999).toISOString(), 'pl-PL', now)
    ).toBeNull();
  });
});
