import { TIME } from '@kernel/application/constants.config';
import { ADMIN_ATTENTION } from '@kernel/domain/admin/admin-attention.config';
import { EMAIL_LIFECYCLE_CONFIG } from '@kernel/domain/email/email-schedule.config';

/**
 * The longest gap between two sweeps of a HEALTHY system: a sweep right
 * before the throttle would let the next one run just as quiet hours begin,
 * so the next one waits out the whole quiet window. Quiet hours wrap midnight
 * (QUIET_HOURS_START..QUIET_HOURS_END, UTC).
 */
export const longestHealthySweepGapMs = (): number => {
  const hoursPerDay = TIME.MS_PER_DAY / TIME.MS_PER_HOUR;
  const quietHours =
    hoursPerDay -
    EMAIL_LIFECYCLE_CONFIG.QUIET_HOURS_START +
    EMAIL_LIFECYCLE_CONFIG.QUIET_HOURS_END;
  return (
    quietHours * TIME.MS_PER_HOUR + EMAIL_LIFECYCLE_CONFIG.SWEEP_THROTTLE_MS
  );
};

/**
 * Is the lifecycle mail sweep silent for too long (admin badge
 * `email_sweep_issues`)?
 *
 * DECISION (nie usuwaj tego komentarza):
 * The evidence is the newest EMAIL_SWEEP_COMPLETED row; it is written on
 * every sweep, also an empty one. No row at all = silent (on production the
 * sweep has run since 2026-09-23, so "never" there is a failure, not a fresh
 * install).
 * Quiet hours (21:00-09:00 UTC) are NOT subtracted from the silence, on
 * purpose: the rule cannot fire merely because of them as long as the limit
 * stays above longestHealthySweepGapMs (12 h of quiet + the 6 h throttle =
 * 18 h, against a 24 h limit). That relation is the guarantee, and
 * email-sweep-silence.policy.test.ts fails when a retuned limit, quiet
 * window or throttle breaks it. Subtracting the night instead would turn
 * "24 h" into two calendar days before anyone hears about a dead sweep.
 */
export const isEmailSweepSilent = (input: {
  lastSweepAt: Date | null;
  now: Date;
}): boolean => {
  if (input.lastSweepAt === null) {
    return true;
  }
  return (
    input.now.getTime() - input.lastSweepAt.getTime() >
    ADMIN_ATTENTION.EMAIL_SWEEP_MAX_SILENCE_HOURS * TIME.MS_PER_HOUR
  );
};
