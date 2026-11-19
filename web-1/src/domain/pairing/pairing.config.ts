/**
 * PAIRING CONFIGURATION
 *
 * Business rules:
 * - Token TTL: 15 minutes (security)
 * - Cleanup: 24h (remove expired tokens)
 * - Max active sessions: 5 per stylist (prevents token spam)
 *
 * NOTE: Pairing limits (max_paired_clients) are managed by PRICING_POLICY.LIMITS (SSOT)
 * See: .shared-kernel/policies/pricing.policy.ts
 */

export const PAIRING_CONFIG = {
  /**
   * Token time-to-live in minutes
   * Short-lived for security (offline→online bridge)
   */
  TOKEN_TTL_MINUTES: 15,

  /**
   * Cleanup interval for expired tokens (hours)
   * Prevents database bloat
   */
  CLEANUP_INTERVAL_HOURS: 24,

  /**
   * Max active sessions per stylist
   * Prevents token spam
   */
  MAX_ACTIVE_SESSIONS_PER_STYLIST: 5,

  /**
   * The window in which a re-request after one's OWN withdrawal counts as the same request restated (no mail, no
   * audit entry, no funnel pumping). Rationale and the measured vector: the reassert-window DECISION at
   * `isRapidReassert` in `pair-request.operations.ts`. An hour is a compromise: the request reaches the stylist's
   * app IMMEDIATELY (only the repeated notification is suppressed), and a re-request after a longer pause is a
   * genuinely new attempt, so the mail returns.
   */
  REQUEST_REASSERT_WINDOW_MINUTES: 60,
} as const;
