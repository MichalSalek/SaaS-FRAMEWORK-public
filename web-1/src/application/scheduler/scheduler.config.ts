import { TIME } from '@kernel/application/constants.config';

export const SCHEDULER_CONFIG = Object.freeze({
  /** Period of the external tick. Keep equal to the Better Stack monitor interval. */
  TICK_PERIOD_MS: 30 * TIME.MS_PER_MINUTE,
  /**
   * A tick also claims jobs due within one tick period, so jobs that fall due a few seconds
   * apart run in ONE database wake instead of two.
   */
  TICK_EARLY_MS: 30 * TIME.MS_PER_MINUTE,
  /** A job counts as late this long after the first moment the tick was allowed to run it. */
  LATENESS_GRACE_MS: 60 * TIME.MS_PER_MINUTE,
  /** Traffic rounds per process are at least this far apart (the old janitor cadence). */
  TRAFFIC_ROUND_MIN_SPACING_MS: TIME.MS_PER_MINUTE,
  /** Default lease; renewed every third of it while the job runs. */
  DEFAULT_LEASE_TTL_MS: 2 * TIME.MS_PER_MINUTE,
  /** A failed run is retried after min(interval, this). */
  FAILURE_RETRY_MS: 15 * TIME.MS_PER_MINUTE,
  /** This many failures in a row make a job unhealthy (admin health, tick alarm). */
  MAX_CONSECUTIVE_FAILURES: 3,
  /** This many scheduler rounds in a row that could not read the job table or claim alarm the tick. */
  MAX_CONSECUTIVE_FAILED_ROUNDS: 3,
  /**
   * Two processes completing jobs longer than this after the later one booted means a second
   * instance runs (a deploy overlaps old and new for a minute or two). The in-memory request
   * limiter assumes one instance, so this is reported (D11).
   */
  INSTANCE_OVERLAP_GRACE_MS: 10 * TIME.MS_PER_MINUTE,
  /** Outbound heartbeat ping timeout. */
  HEARTBEAT_TIMEOUT_MS: 5_000,
});
