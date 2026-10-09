import { describe, expect, it } from 'vitest';
import {
  resolveTrialBannerEndsAt,
  resolveTrialCountdown,
} from './trialCountdown.logic';

const at = (day: number, hour: number): Date =>
  new Date(2026, 8, day, hour, 0, 0, 0);

describe('resolveTrialCountdown', () => {
  it('says "today" when the trial ends later the same calendar day', () => {
    const c = resolveTrialCountdown(at(24, 22), at(24, 9).getTime());
    expect(c?.tier).toBe('lastDay');
    expect(c?.titleKey).toBe('titleLastHours');
  });

  it('says "tomorrow" when under 24 h are left but the end is after midnight', () => {
    const c = resolveTrialCountdown(at(25, 10), at(24, 20).getTime());
    expect(c?.tier).toBe('lastDay');
    expect(c?.titleKey).toBe('titleTomorrowAt');
  });

  it('counts whole days in the urgent tier', () => {
    const c = resolveTrialCountdown(at(26, 12), at(24, 9).getTime());
    expect(c?.tier).toBe('urgent');
    expect(c?.daysRemaining).toBe(3);
    expect(c?.titleKey).toBe('title7days');
  });

  it('is null outside the 7-day window, after expiry and for a bad date', () => {
    const now = at(10, 9).getTime();
    expect(resolveTrialCountdown(at(20, 9), now)).toBeNull();
    expect(resolveTrialCountdown(at(9, 9), now)).toBeNull();
    expect(resolveTrialCountdown('not a date', now)).toBeNull();
    expect(resolveTrialCountdown(null, now)).toBeNull();
  });

  it('accepts the ISO string the API actually sends', () => {
    const end = at(27, 9);
    const c = resolveTrialCountdown(end.toISOString(), at(24, 9).getTime());
    expect(c?.daysRemaining).toBe(3);
  });
});

describe('resolveTrialBannerEndsAt', () => {
  const ends = '2026-09-30T10:00:00.000Z';

  it('passes the date through for a trial that will convert', () => {
    expect(
      resolveTrialBannerEndsAt({
        trial_ends_at: ends,
        subscription_status: 'TRIALING',
        cancel_at_period_end: false,
        cancel_at: null,
      })
    ).toBe(ends);
  });

  it('hides the banner once the trial was cancelled', () => {
    expect(
      resolveTrialBannerEndsAt({
        trial_ends_at: ends,
        subscription_status: 'TRIALING',
        cancel_at_period_end: true,
      })
    ).toBeNull();
  });

  it('hides the banner after conversion or cancellation (trial_ends_at is never cleared)', () => {
    expect(
      resolveTrialBannerEndsAt({
        trial_ends_at: ends,
        subscription_status: 'ACTIVE',
      })
    ).toBeNull();
    expect(
      resolveTrialBannerEndsAt({
        trial_ends_at: ends,
        subscription_status: 'CANCELED',
      })
    ).toBeNull();
  });

  it('is null without an account', () => {
    expect(resolveTrialBannerEndsAt(null)).toBeNull();
  });
});
