/**
 * Post-Commit Effects Collector — Stripe Webhook Side-Effect Pattern
 *
 * DECISION: Stripe webhook handlers run INSIDE an interactive `$transaction(tx, ...)` so the
 * business mutation (account update + audit log) and `claimEventForProcessingTx` commit or roll
 * back together. Handlers therefore RETURN effects[] (emails, Stripe API cancels, churn alerts)
 * instead of scheduling them: `runAfterResponse` is fire-and-forget and would fire even when the
 * transaction later rolls back (e.g. a "downgrade" email for a state that never persisted).
 * `runAfterResponse()` is invoked ONLY post-commit, so a rolled-back tx fires ZERO side effects.
 *
 * Pattern: collect `result.effects` inside `$transaction` (after `claimEventForProcessingTx` and
 * `routeStripeEvent`), then `for (const eff of collected) runAfterResponse(eff)` after commit.
 */

/**
 * A single side-effect task to be scheduled AFTER the webhook transaction
 * commits. Must be self-contained (capture needed values via closure) and
 * MUST NOT throw — if it does, the floating promise inside `runAfterResponse`
 * swallows the rejection. Effects log their own failures via
 * `reportIssueBackend` / FailedEmail table.
 */
export type StripeWebhookEffect = () => Promise<void>;

/**
 * Return type for every Stripe webhook handler. The `effects` array carries
 * post-commit work back up to the entry point in
 * `pages/api/v1/webhooks/stripe/index.ts`. Empty array is the common case
 * (most handlers only write DB rows and need no async follow-up).
 */
export type StripeHandlerResult = {
  effects: StripeWebhookEffect[];
};

/**
 * Convenience constructor for handlers that have no post-commit work.
 *
 * Returns a fresh object on each call — never share the array between
 * handlers (otherwise effects scheduled by handler A would leak into
 * handler B's "empty" result).
 */
export const emptyEffectsResult = (): StripeHandlerResult => ({ effects: [] });
