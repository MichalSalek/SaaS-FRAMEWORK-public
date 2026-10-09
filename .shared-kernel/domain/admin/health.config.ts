// Latency budgets for admin health probes. One number per service class:
// a TLS HEAD and a same-region SELECT are not the same kind of "slow".

/**
 * DECISION (nie usuwaj tego komentarza):
 * A single rule (healthy under 100ms, down from 500ms) marked every
 * cross-region probe as degraded, so the admin dashboard sat on
 * "Zdegradowany" while the dependencies were up. The healthy ceilings sit
 * above the measured steady state. A database cold start and a TLS
 * handshake to Stripe, Cloudinary or the email API are normal cost, not
 * an outage. A probe slower than `degradedMs` stays `degraded`. `down` is
 * only an error or a timeout, and that decision belongs to the checker.
 */
export const HEALTH_LATENCY_BUDGETS = {
  primaryDb: { healthyMs: 250, degradedMs: 1000 },
  logDb: { healthyMs: 600, degradedMs: 2000 },
  externalHttp: { healthyMs: 1200, degradedMs: 4000 },
} as const;

export type HealthLatencyClass = keyof typeof HEALTH_LATENCY_BUDGETS;
