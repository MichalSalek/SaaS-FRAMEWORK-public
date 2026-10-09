/**
 * Post-Commit Effects Collector — Stripe Webhook Side-Effect Pattern
 *
 * DECISION (nie usuwaj tego komentarza):
 * Stripe webhook handlers run INSIDE an interactive `$transaction(tx, ...)` so
 * that the business mutation (account update + audit log) and the
 * `claimEventForProcessingTx` commit/rollback together (D1 atomicity). Before this
 * file existed, handlers called `runAfterResponse(...)` *during* the
 * transaction to schedule side effects (emails, Stripe API cancels, churn
 * alerts). Problem: `runAfterResponse` is fire-and-forget — it schedules the
 * task immediately, even if the surrounding transaction later rolls back.
 * The user would receive a "downgrade-notification" email for a state that
 * never persisted.
 *
 * Fix: handlers ZWRACAJA effects[] zamiast schedulować w-trakcie-transakcji.
 * `runAfterResponse()` is invoked WYLACZNIE post-commit (after `$transaction`
 * resolves) — meaning a rolled-back tx fires ZERO side effects.
 *
 * Pattern:
 *   const collected: StripeWebhookEffect[] = [];
 *   await $transaction(async tx => {
 *     await claimEventForProcessingTx(tx, event.id);
 *     const result = await routeStripeEvent(event, tx);
 *     collected.push(...result.effects);
 *   });
 *   for (const eff of collected) runAfterResponse(eff);
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
