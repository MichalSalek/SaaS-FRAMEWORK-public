// Latency budgets for admin health probes. One number per service class:
// a TLS HEAD and a same-region SELECT are not the same kind of "slow".

/**
 * DECISION: one global rule (healthy under 100ms) marked every cross-region probe degraded while the
 * dependencies were up. Ceilings are per service class and sit above the measured steady state; a
 * database cold start or TLS handshake is normal cost. A probe slower than `degradedMs` stays
 * `degraded`; `down` is only an error or timeout, decided by the checker.
 */
export const HEALTH_LATENCY_BUDGETS = {
  primaryDb: { healthyMs: 250, degradedMs: 1000 },
  logDb: { healthyMs: 600, degradedMs: 2000 },
  externalHttp: { healthyMs: 1200, degradedMs: 4000 },
} as const;

export type HealthLatencyClass = keyof typeof HEALTH_LATENCY_BUDGETS;
