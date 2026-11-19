/**
 * Thresholds of the admin "needs a reaction" counters (menu badges of the
 * admin panel). One place, because every counter has a list that must show
 * exactly the counted rows: the count and the list read the same number.
 */
export const ADMIN_ATTENTION = Object.freeze({
  /** A trial ending within this many days counts as a payment matter. */
  TRIAL_ENDING_WITHIN_DAYS: 3,
  /**
   * A registration with no role is "stuck" once it is older than this. Younger
   * ones are people who are still in the middle of onboarding.
   */
  STUCK_MIN_AGE_HOURS: 24,
  /**
   * ...and younger than this. An older abandoned registration is no longer
   * something to react to; it stays reachable through the "no role" filter.
   */
  STUCK_MAX_AGE_DAYS: 14,
  /**
   * The lifecycle mail sweep is reported as silent when its newest
   * EMAIL_SWEEP_COMPLETED row is older than this. Must stay above the longest
   * healthy gap: quiet hours (QUIET_HOURS_START..QUIET_HOURS_END) plus one
   * sweep throttle (EMAIL_LIFECYCLE_CONFIG). A unit test pins that relation.
   */
  EMAIL_SWEEP_MAX_SILENCE_HOURS: 24,
} as const);

/** Values of the `attention` filter of the admin users list. */
export const ADMIN_USERS_ATTENTION_FILTERS = ['payments', 'stuck'] as const;
export type AdminUsersAttentionFilter =
  (typeof ADMIN_USERS_ATTENTION_FILTERS)[number];

export const isAdminUsersAttentionFilter = (
  value: unknown
): value is AdminUsersAttentionFilter =>
  typeof value === 'string' &&
  (ADMIN_USERS_ATTENTION_FILTERS as readonly string[]).includes(value);
