/**
 * Time unit conversions — SINGLE SOURCE OF TRUTH for `N * <unit>` arithmetic.
 *
 * DECISION: the single home of the `24 * 60 * 60 * 1000` family; consumers build multiples from these
 * bases (`7 * TIME.MS_PER_DAY`). Guard `tests/audit/time-literals.sh` blocks raw literals elsewhere.
 * Domain windows (90d recovery, 30000ms HTTP timeout) do NOT belong here: they are decisions, not
 * unit conversions.
 */
export const TIME = {
  MS_PER_MINUTE: 60_000,
  MS_PER_HOUR: 3_600_000,
  MS_PER_DAY: 86_400_000,
  SECONDS_PER_DAY: 86_400,
} as const;

/**
 * Exponential-backoff retry defaults — canonical base used by transient-failure
 * retry loops (email delivery, Stripe API, moderation email).
 *
 * DECISION: the canonical base (1000ms) for retry loops on transient errors, not a global override.
 * Layers with a deliberately tighter budget (Cloudinary asset cleanup, magic-link adapter: 500ms)
 * keep their own local constant; merging them would be a false SSOT over two independent decisions.
 */
export const RETRY = {
  BASE_DELAY_MS: 1_000,
  MAX_ATTEMPTS: 3,
  // Email delivery retries fewer times than the general path: 2 attempts = 1 retry.
  EMAIL_MAX_ATTEMPTS: 2,
} as const;

/**
 * Prisma interactive-transaction tuning for Stripe webhook handlers.
 *
 * DECISION: `maxWait`/`timeout` stay above the defaults (2s/5s) although no Stripe call runs inside
 * the transaction any more (`prefetchStripeEventContext` resolves it first, guard
 * `audit:stripe-no-api-in-tx`). The headroom is consumed by `acquireAdvisoryXactLock(customerId)`:
 * a second transaction of the same customer waits under the lock for the whole first one. Do not
 * lower it without measuring lock wait. Kernel-level so webhook and janitor share one budget.
 */
export const PRISMA_TX = {
  maxWait: 5_000,
  timeout: 25_000,
} as const;

export const STRIPE_CONFIG = {
  API_TIMEOUT_MS: 20000,
  /**
   * Stripe API version pinned to a known-good release.
   *
   * DECISION: the API version is pinned explicitly (not the account default) so the payload shape is
   * identical across deploys. Bump only after testing against the new shape.
   */
  API_VERSION: '2025-12-15.clover',
} as const;

export const HTTP_CLIENT_CONFIG = {
  TIMEOUT_MS: 30000,
  MAX_REDIRECTS: 5,
  MAX_CONTENT_LENGTH_BYTES: 10 * 1024 * 1024, // 10MB
  /** Cloudinary SDK request timeout — 20s to bound hung requests during outages. */
  CLOUDINARY_TIMEOUT_MS: 20000,
} as const;
