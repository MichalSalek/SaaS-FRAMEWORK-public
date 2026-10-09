/**
 * STRIPE SUBSCRIPTION-CANCEL RECONCILE — pure resolver logic (no IO).
 *
 * Companion to `stripe-cancel-reconcile.operations.ts` (dead-letter queue for
 * subscription cancels that failed during account deletion). Everything here is
 * a pure function over plain data so the janitor's decision logic is unit-testable
 * without mocking Prisma/Stripe (project pattern: pure policy tests, no DB mocks).
 *
 * DECISION (nie usuwaj tego komentarza):
 * STORAGE = synthetic rows in the EXISTING StripeEvent table — deliberately NO new
 * schema/table. StripeEvent already carries the exact work-queue state machine this
 * reconcile needs (processed / retry_count / last_attempt_at / last_error /
 * dead_lettered + the [processed, dead_lettered, created_at] index), and the
 * stripe-event-janitor proved the optimistic-claim retry pattern on it. A reconcile
 * entry is keyed `internal:cancel-reconcile:<subscriptionId>:<userId>` (event_id is
 * @unique → enqueue is an idempotent upsert; both ids are colon-free — Stripe sub
 * ids are `sub_...`, user ids are cuid — so the key parses unambiguously) with
 * event_type `internal.subscription_cancel_reconcile`. The regular stripe-event
 * janitor EXCLUDES this event_type from its candidate set (it would otherwise try
 * `stripe.events.retrieve()` on a non-Stripe id and false-dead-letter the row);
 * the exclusion lives in stripe-event-janitor.operations.ts and imports the
 * constant from HERE so the two sweeps can never drift apart.
 */

import { TIME } from '@kernel/application/constants.config';

/** event_type marker for synthetic reconcile rows (never a real Stripe event type). */
export const CANCEL_RECONCILE_EVENT_TYPE =
  'internal.subscription_cancel_reconcile';

/**
 * Reconcile FLAVOR — WHY a cancel row was enqueued. The two flavors differ ONLY in
 * how the sweep treats a still-live target user (see the reactivation-guard DECISION
 * in stripe-cancel-reconcile.operations.ts); they otherwise share the same synthetic
 * StripeEvent event_type, work-queue state machine, sweep, and janitor exclusion.
 *
 * DECISION (nie usuwaj tego komentarza):
 * The flavor is encoded in the event_id PREFIX — NOT a new event_type and NOT a new
 * column:
 *   - deletion  → `internal:cancel-reconcile:<sub>:<user>`  (UNCHANGED — existing
 *     prod rows keep parsing; account-DELETION cancels, reactivation guard APPLIES)
 *   - duplicate → `internal:cancel-reconcile-duplicate:<sub>:<user>`  (duplicate-
 *     checkout OLD-sub cancels, reactivation guard BYPASSED — the target user is a
 *     live paying stylist BY DESIGN, the OLD sub must die regardless of active state)
 * Keeping ONE event_type means the sweep's candidate query AND the stripe-event-
 * janitor exclusion cover BOTH flavors unchanged — zero partition drift. The two
 * prefixes are disjoint (duplicate = deletion-stem + "-duplicate:", so neither is a
 * prefix of the other). This is a purely internal reconcile-module concept: NOT a
 * kernel type, NOT a Prisma enum (StripeEvent.event_type is a free-form string
 * column).
 */
export type CancelReconcileFlavor = 'deletion' | 'duplicate';

/** event_id namespace prefix for account-DELETION reconcile rows (reactivation guard APPLIES). */
export const CANCEL_RECONCILE_EVENT_ID_PREFIX = 'internal:cancel-reconcile:';

/** event_id namespace prefix for DUPLICATE-checkout reconcile rows (reactivation guard BYPASSED). */
export const CANCEL_RECONCILE_DUPLICATE_EVENT_ID_PREFIX =
  'internal:cancel-reconcile-duplicate:';

/**
 * Max reconcile attempts before the row is dead-lettered and the operator gets the
 * final "gave up" alert. Mirrors the stripe-event-janitor default (5). Note the
 * operator ALREADY received an immediate critical alert when the hot-path cancel
 * failed (cancelStripeSubscriptionIfExists) — this budget only bounds the
 * automated second-chance retries.
 */
export const CANCEL_RECONCILE_MAX_RETRIES = 5;

/**
 * Exponential-backoff base. With MAX_RETRIES=5 the retry timeline is
 * 1h, 2h, 4h, 8h, 16h after enqueue (~31h of automated coverage for a degraded
 * Stripe), then a final dead-letter claim. Sweep cadence (1h throttle) is the
 * floor between attempts.
 */
export const CANCEL_RECONCILE_BACKOFF_BASE_MS = TIME.MS_PER_HOUR;

/** Bounded batch per sweep — reconcile rows are rare; 10 is generous headroom. */
export const CANCEL_RECONCILE_BATCH_SIZE = 10;

export type CancelReconcileTarget = {
  subscriptionId: string;
  userId: string;
  flavor: CancelReconcileFlavor;
};

/**
 * Build the synthetic StripeEvent.event_id for a pending subscription cancel.
 * `flavor` selects the prefix and defaults to 'deletion' (the original flow), so
 * existing deletion call-sites need no change.
 */
export const buildCancelReconcileEventId = ({
  subscriptionId,
  userId,
  flavor = 'deletion',
}: {
  subscriptionId: string;
  userId: string;
  flavor?: CancelReconcileFlavor;
}): string =>
  `${
    flavor === 'duplicate'
      ? CANCEL_RECONCILE_DUPLICATE_EVENT_ID_PREFIX
      : CANCEL_RECONCILE_EVENT_ID_PREFIX
  }${subscriptionId}:${userId}`;

/**
 * Parse a synthetic reconcile event_id back into its target (including flavor).
 * Returns null for anything malformed (defensive — the sweep dead-letters such
 * rows instead of throwing).
 */
export const parseCancelReconcileEventId = (
  eventId: string
): CancelReconcileTarget | null => {
  // Duplicate prefix checked FIRST: the two prefixes are disjoint (duplicate =
  // deletion-stem + "-duplicate:"), so a duplicate id never matches the deletion
  // prefix and vice versa — the ordering is defensive clarity, not load-bearing.
  const flavor: CancelReconcileFlavor | null = eventId.startsWith(
    CANCEL_RECONCILE_DUPLICATE_EVENT_ID_PREFIX
  )
    ? 'duplicate'
    : eventId.startsWith(CANCEL_RECONCILE_EVENT_ID_PREFIX)
      ? 'deletion'
      : null;
  if (flavor === null) {
    return null;
  }
  const prefix =
    flavor === 'duplicate'
      ? CANCEL_RECONCILE_DUPLICATE_EVENT_ID_PREFIX
      : CANCEL_RECONCILE_EVENT_ID_PREFIX;
  const rest = eventId.slice(prefix.length);
  const parts = rest.split(':');
  if (parts.length !== 2) {
    return null;
  }
  const [subscriptionId, userId] = parts;
  if (!subscriptionId || !userId) {
    return null;
  }
  return { subscriptionId, userId, flavor };
};

/**
 * Exponential-backoff gate: is this row due for another cancel attempt?
 * Due when `now - lastAttemptAt >= BASE * 2^retryCount`. The exponent is
 * naturally bounded by MAX_RETRIES (rows past it get dead-lettered), the extra
 * Math.min is pure insurance against a hand-edited retry_count overflowing.
 */
export const isCancelRetryDue = ({
  retryCount,
  lastAttemptAt,
  now,
}: {
  retryCount: number;
  lastAttemptAt: Date;
  now: Date;
}): boolean => {
  const boundedRetryCount = Math.min(
    Math.max(retryCount, 0),
    CANCEL_RECONCILE_MAX_RETRIES
  );
  const backoffMs = CANCEL_RECONCILE_BACKOFF_BASE_MS * 2 ** boundedRetryCount;
  return now.getTime() - lastAttemptAt.getTime() >= backoffMs;
};

/**
 * Plain-data projection of a Stripe SDK error, extracted once at the IO seam
 * so classification below stays pure/testable.
 */
export type StripeCancelErrorShape = {
  code: string | undefined;
  status: number | undefined;
  message: string | undefined;
};

/**
 * Extract code/status/message from an unknown thrown value. Stripe SDK errors
 * expose `code` (e.g. `resource_missing`) plus `statusCode` (legacy) or `status`
 * — same dual-shape handling as stripe-retry.utils' private getErrorStatus.
 */
export const extractStripeErrorShape = (
  error: unknown
): StripeCancelErrorShape => {
  if (!(error instanceof Error)) {
    return { code: undefined, status: undefined, message: String(error) };
  }
  const candidate = error as {
    code?: unknown;
    statusCode?: unknown;
    status?: unknown;
  };
  return {
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    status:
      typeof candidate.statusCode === 'number'
        ? candidate.statusCode
        : typeof candidate.status === 'number'
          ? candidate.status
          : undefined,
    message: error.message,
  };
};

/**
 * Treat Stripe "already canceled" responses as idempotent success.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Mirrors `isAlreadyCanceledOutcome` in customer.operations.ts (which classifies
 * per-attempt audit records from retryStripeOperation, a different input shape —
 * hence the sibling, not a shared impl). Stripe surfaces "already cancelled" as:
 *   - `resource_missing` — subscription doesn't exist (deleted or never
 *     propagated to the live key), any status;
 *   - 400 with a message containing "canceled"/"cancelled" — subscription is in
 *     terminal canceled state and refuses further mutations.
 * Both mean the desired end-state (no further billing) is already met → the
 * sweep marks the row resolved instead of burning retries / alerting.
 */
export const isAlreadyCanceledCancelError = (
  error: StripeCancelErrorShape
): boolean => {
  if (error.code === 'resource_missing') {
    return true;
  }
  if (typeof error.status === 'number' && error.status !== 400) {
    return false;
  }
  const msg = error.message?.toLowerCase() ?? '';
  return (
    msg.includes('has been canceled') ||
    msg.includes('has been cancelled') ||
    msg.includes('already canceled') ||
    msg.includes('already cancelled')
  );
};

/** Max stored error-message length (mirror of the stripe-event-janitor cap). */
const MAX_STORED_ERROR_LENGTH = 2_000;

/** Truncate an error message for the StripeEvent.last_error column. */
export const truncateReconcileError = (message: string): string =>
  message.length > MAX_STORED_ERROR_LENGTH
    ? `${message.slice(0, MAX_STORED_ERROR_LENGTH)}…`
    : message;
