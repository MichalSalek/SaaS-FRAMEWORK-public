/**
 * EMAIL LIFECYCLE TIMING
 *
 * Quiet hours of lifecycle mail. The 6 h cadence, the "one sweep at a time" guarantee and the
 * retry after a failed sweep used to live here as per-process memory; they are now the
 * scheduler's durable lease (application/scheduler, `JobLease` row `email-lifecycle`).
 */

import { EMAIL_LIFECYCLE_CONFIG } from '@kernel/domain/email/email-schedule.config';

/** Quiet hours (21:00-09:00 UTC): no lifecycle mail goes out. */
export const isEmailQuietHours = (now: Date = new Date()): boolean => {
  const hour = now.getUTCHours();
  return (
    hour >= EMAIL_LIFECYCLE_CONFIG.QUIET_HOURS_START ||
    hour < EMAIL_LIFECYCLE_CONFIG.QUIET_HOURS_END
  );
};
