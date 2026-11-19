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
 * DECISION: the evidence is the newest EMAIL_SWEEP_COMPLETED row, written on every sweep (also an
 * empty one); no row at all = silent. Quiet hours are NOT subtracted from the silence: the rule
 * cannot fire because of them while the limit stays above longestHealthySweepGapMs (12 h quiet +
 * 6 h throttle = 18 h vs a 24 h limit), and email-sweep-silence.policy.test.ts fails when a retune
 * breaks that relation. Subtracting the night would turn "24 h" into two calendar days.
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
