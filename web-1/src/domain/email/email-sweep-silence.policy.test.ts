import { describe, it, expect } from 'vitest';
import { ADMIN_ATTENTION } from '@kernel/domain/admin/admin-attention.config';
import { EMAIL_LIFECYCLE_CONFIG } from '@kernel/domain/email/email-schedule.config';
import { TIME } from '@kernel/application/constants.config';
import {
  isEmailSweepSilent,
  longestHealthySweepGapMs,
} from './email-sweep-silence.policy';

const LIMIT_MS =
  ADMIN_ATTENTION.EMAIL_SWEEP_MAX_SILENCE_HOURS * TIME.MS_PER_HOUR;
const at = (iso: string): Date => new Date(iso);

describe('isEmailSweepSilent', () => {
  it('no sweep row at all is silent', () => {
    expect(
      isEmailSweepSilent({ lastSweepAt: null, now: at('2026-10-08T12:00Z') })
    ).toBe(true);
  });

  it('is silent only past the limit', () => {
    const now = at('2026-10-08T12:00:00.000Z');
    expect(
      isEmailSweepSilent({
        lastSweepAt: new Date(now.getTime() - LIMIT_MS),
        now,
      })
    ).toBe(false);
    expect(
      isEmailSweepSilent({
        lastSweepAt: new Date(now.getTime() - LIMIT_MS - 1),
        now,
      })
    ).toBe(true);
  });
});

describe('quiet hours alone never fire the rule', () => {
  it('the limit is above the longest gap of a healthy system', () => {
    // Quiet window + one throttle. If this fails, someone retuned the limit,
    // the quiet hours or the throttle, and the badge would light every night.
    expect(longestHealthySweepGapMs()).toBeLessThan(LIMIT_MS);
  });

  it('the longest healthy gap is the whole quiet window plus one throttle', () => {
    const quietHours =
      24 -
      EMAIL_LIFECYCLE_CONFIG.QUIET_HOURS_START +
      EMAIL_LIFECYCLE_CONFIG.QUIET_HOURS_END;
    expect(longestHealthySweepGapMs()).toBe(
      quietHours * TIME.MS_PER_HOUR + EMAIL_LIFECYCLE_CONFIG.SWEEP_THROTTLE_MS
    );
  });

  it('worst healthy day: a sweep at 15:00, the next one only at 09:00, is never silent', () => {
    // 15:00 UTC sweep; the next is due at 21:00 = the start of quiet hours, so
    // it runs at 09:00 the day after. Every moment in between must be calm.
    const lastSweepAt = at('2026-10-07T15:00:00.000Z');
    for (let hour = 0; hour <= 18; hour += 1) {
      const now = new Date(lastSweepAt.getTime() + hour * TIME.MS_PER_HOUR);
      expect(isEmailSweepSilent({ lastSweepAt, now })).toBe(false);
    }
  });

  it('a sweep that misses a whole day is reported the next afternoon', () => {
    expect(
      isEmailSweepSilent({
        lastSweepAt: at('2026-10-07T15:00:00.000Z'),
        now: at('2026-10-08T15:00:00.001Z'),
      })
    ).toBe(true);
  });
});
