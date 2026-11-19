/**
 * Unit tests — Mailgun daily request-cap breaker.
 *
 * Pure in-memory state machine: detection (daily-cap vs transient 429), trip with
 * reset-time parsing, fail-fast gate, auto-close at reset, and the /health snapshot.
 * `reportIssueBackend` is mocked to a no-op so trip-logging never touches the DB.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: () => undefined,
}));

import {
  detectMailgunDailyLimit,
  tripMailgunDailyLimit,
  isMailgunDailyLimited,
  noteMailgunErrorForDailyLimit,
  getMailgunDailyLimitInfo,
  __resetMailgunDailyLimitForTest,
} from '@app/email-handler/mailgun-daily-limit.breaker';

// The real Mailgun daily-cap 429 payload shape (from MailgunAPIError).
const dailyCapError = (resetIso = 'Tue, 16 Jun 2026 07:32:33 UTC') => ({
  status: 429,
  type: 'MailgunAPIError',
  message: 'Too Many Requests',
  details: `Domain mg.example.com is not allowed to send: daily request limit exceeded, try again after ${resetIso}`,
});

describe('mailgun-daily-limit.breaker', () => {
  beforeEach(() => {
    __resetMailgunDailyLimitForTest();
    vi.useRealTimers();
  });

  describe('detectMailgunDailyLimit', () => {
    it('classifies the daily-cap 429 and parses the reset time', () => {
      const { isDailyLimit, resetAtMs } =
        detectMailgunDailyLimit(dailyCapError());
      expect(isDailyLimit).toBe(true);
      expect(resetAtMs).toBe(Date.parse('Tue, 16 Jun 2026 07:32:33 UTC'));
    });

    it('does NOT classify a transient (per-second) 429 as the daily cap', () => {
      // A bare rate-limit 429 has no "daily limit" phrase — must recover in seconds,
      // not trip a day-long breaker.
      const transient = {
        status: 429,
        message: 'Too Many Requests',
        details: 'too many requests, slow down',
      };
      expect(detectMailgunDailyLimit(transient).isDailyLimit).toBe(false);
    });

    it('does NOT classify non-429 errors', () => {
      expect(
        detectMailgunDailyLimit({ status: 500, message: 'server error' })
          .isDailyLimit
      ).toBe(false);
      expect(detectMailgunDailyLimit(new Error('network')).isDailyLimit).toBe(
        false
      );
      expect(detectMailgunDailyLimit(null).isDailyLimit).toBe(false);
      expect(detectMailgunDailyLimit(undefined).isDailyLimit).toBe(false);
    });

    it('reports isDailyLimit with null reset when the time is unparseable', () => {
      const noReset = {
        status: 429,
        message: 'Too Many Requests',
        details: 'daily request limit exceeded',
      };
      const { isDailyLimit, resetAtMs } = detectMailgunDailyLimit(noReset);
      expect(isDailyLimit).toBe(true);
      expect(resetAtMs).toBeNull();
    });
  });

  describe('trip / gate / auto-close', () => {
    it('starts closed', () => {
      expect(isMailgunDailyLimited()).toBe(false);
      expect(getMailgunDailyLimitInfo()).toEqual({
        limited: false,
        reset_at: null,
      });
    });

    it('opens until the provider reset time, then auto-closes', () => {
      const resetAt = Date.now() + 60_000;
      tripMailgunDailyLimit(resetAt);

      expect(isMailgunDailyLimited()).toBe(true);
      const info = getMailgunDailyLimitInfo();
      expect(info.limited).toBe(true);
      expect(info.reset_at).toBe(new Date(resetAt).toISOString());

      // Advance past the reset — breaker auto-closes on the next read.
      vi.useFakeTimers();
      vi.setSystemTime(resetAt + 1);
      expect(isMailgunDailyLimited()).toBe(false);
      expect(getMailgunDailyLimitInfo().reset_at).toBeNull();
    });

    it('falls back to a bounded window when the reset time is null', () => {
      tripMailgunDailyLimit(null);
      expect(isMailgunDailyLimited()).toBe(true);
      const resetAt = Date.parse(getMailgunDailyLimitInfo().reset_at ?? '');
      const minutesAhead = (resetAt - Date.now()) / 60_000;
      // 30-minute fallback window (re-probe rather than lock out a full day).
      expect(minutesAhead).toBeGreaterThan(25);
      expect(minutesAhead).toBeLessThanOrEqual(31);
    });

    it('clamps an implausibly-far-future reset to the bounded fallback (misparse guard)', () => {
      // A genuine daily cap resets within 24h. V8 Date.parse on a
      // non-ISO/RFC-2822 provider string is implementation-defined and can yield
      // a finite-but-wrong epoch (e.g. a different year) that passes the `> now`
      // guard — locking ALL sends out for days with no auto-recovery until
      // process restart. A reset claiming to be far in the future is treated as
      // a misparse and replaced by the bounded re-probe window.
      const fiveDaysAhead = Date.now() + 5 * 24 * 60 * 60_000;
      tripMailgunDailyLimit(fiveDaysAhead);
      expect(isMailgunDailyLimited()).toBe(true);
      const resetAt = Date.parse(getMailgunDailyLimitInfo().reset_at ?? '');
      const minutesAhead = (resetAt - Date.now()) / 60_000;
      // Fell back to the ~30-min window, NOT 5 days.
      expect(minutesAhead).toBeLessThanOrEqual(31);
    });

    it('extends (never shortens) the window on a later reset', () => {
      const near = Date.now() + 60_000;
      const far = Date.now() + 3_600_000;
      tripMailgunDailyLimit(far);
      tripMailgunDailyLimit(near); // earlier reset must NOT shorten the window
      expect(getMailgunDailyLimitInfo().reset_at).toBe(
        new Date(far).toISOString()
      );
    });

    it('noteMailgunErrorForDailyLimit trips on the daily cap, ignores others', () => {
      expect(noteMailgunErrorForDailyLimit({ status: 500 })).toBe(false);
      expect(isMailgunDailyLimited()).toBe(false);

      expect(noteMailgunErrorForDailyLimit(dailyCapError())).toBe(true);
      expect(isMailgunDailyLimited()).toBe(true);
    });
  });
});
