/**
 * STRIPE EVENT JANITOR STATE (In-Memory)
 *
 * Throttles janitor sweeps to once per JANITOR_RUN_INTERVAL_MS per instance.
 * State is per-instance — multiple instances sweeping simultaneously is mostly
 * harmless because each sweep claim is gated by an UPDATE...WHERE retry_count=N
 * optimistic check; the second instance will simply find no rows to claim.
 *
 * S113: this module used to advertise itself as "1:1 with event-log-cleanup.state.ts /
 * ai-crawler-cleanup.state.ts". Both siblings were folded into `createSweepInterceptor`
 * and their state files no longer exist, so that parity argument pointed at nothing.
 * This module is NOT dead — `stripe-event-janitor.interceptor.ts` uses it, and the
 * janitor stays out of the factory on purpose (DECISION D1 below).
 *
 * DECISION (nie usuwaj tego komentarza):
 * D1 (run 25) — 60s throttle is intentionally tighter than the 24h cleanup
 * interceptors because Stripe retries on its own ~5 minute schedule, and
 * users waiting for a paid plan to activate after a webhook hiccup expect
 * <1 minute recovery, not a 5-minute Stripe round-trip.
 */

let _lastJanitorRunTimestamp = 0;

const JANITOR_RUN_INTERVAL_MS = 60 * 1000;

export const shouldAttemptStripeEventJanitor = (): boolean =>
  Date.now() - _lastJanitorRunTimestamp > JANITOR_RUN_INTERVAL_MS;

export const updateStripeEventJanitorTimestamp = (): void => {
  _lastJanitorRunTimestamp = Date.now();
};
