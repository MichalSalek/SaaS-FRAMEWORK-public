/**
 * STRIPE CANCEL-RECONCILE — exemptions checked right before a queued cancel runs.
 *
 * A reconcile row records a decision taken earlier (an hour of backoff at least,
 * and the orphan scan decides on a snapshot). These checks re-read the database at
 * execution time and name the reason when the cancel must NOT happen; the sweep then
 * closes the row without touching Stripe.
 */

import { PaymentStatusValue } from '@kernel/models/db_models.generated.dto';
import { DB_CLIENT } from '@app/db/db.client';
import type { CancelReconcileTarget } from './stripe-cancel-reconcile.resolver';

export type CancelExemption =
  | { resolution: 'user_reactivated' }
  | { resolution: 'paying_owner'; accountId: string };

/** Constant per reason: the log rate limiter keys on namespace::message. */
export const CANCEL_EXEMPTION_MESSAGES: Record<
  CancelExemption['resolution'],
  string
> = {
  user_reactivated:
    'Reconcile resolved without cancel — user reactivated their account while the retry was pending',
  paying_owner:
    'Reconcile resolved without cancel — the subscription is the current paid subscription of a live account',
};

export const findCancelExemption = async (
  target: CancelReconcileTarget
): Promise<CancelExemption | null> => {
  // DECISION: REACTIVATION GUARD, DELETION FLAVOR ONLY. Two flavors share this sweep (see
  // CancelReconcileFlavor in the resolver):
  //   - 'deletion': the cancel was requested because the account was being deleted. Model A
  //     soft-delete is RECOVERABLE: the user can self-reactivate within the recovery window while
  //     this row is still pending (the hot-path cancel failed, so the subscription is genuinely
  //     alive in Stripe). Cancelling then would cut off a reactivated, paying user, so the pending
  //     cancel is MOOT and the row is resolved without touching Stripe. (Users whose hot-path
  //     cancel SUCCEEDED end up unsubscribed after recovery either way; the asymmetry is
  //     deliberate: never destroy a recovered user's active billing relationship.)
  //   - 'duplicate': the cancel targets a subscription that must die while its user lives (the OLD
  //     sub of a DUPLICATE checkout, or the sub of an admin-downgraded FREE account). "Live user
  //     means keep the sub" is exactly wrong here, so the guard is BYPASSED. Backoff and dead-letter
  //     semantics are identical for both flavors.
  if (target.flavor === 'deletion') {
    const targetUser = await DB_CLIENT.use.user.findUnique({
      where: { id: target.userId },
      select: { is_active: true, deleted_at: true },
    });
    if (
      targetUser !== null &&
      targetUser.is_active &&
      targetUser.deleted_at === null
    ) {
      return { resolution: 'user_reactivated' };
    }
  }

  // DECISION: PAID-OWNER GUARD, BOTH FLAVORS. A subscription that a LIVE user's account currently
  // points at, with any payment status other than UNPAID, is that customer's current subscription
  // and is never cancelled here. Every legitimate obligation fails this test by construction (a
  // duplicate checkout re-points the account at the NEW sub, an admin downgrade sets UNPAID, a
  // deletion makes the user not live). A row can still be stale by the time it runs (a later
  // webhook re-linked the sub and restored PAID); cancelling then would cut off a paying customer,
  // so the row is closed without touching Stripe.
  const payingOwner = await DB_CLIENT.use.stylistAccount.findFirst({
    where: {
      subscription_id: target.subscriptionId,
      payment_status: { not: PaymentStatusValue.UNPAID },
      created_by_user: { is_active: true, deleted_at: null },
    },
    select: { account_id: true },
  });
  if (payingOwner !== null) {
    return { resolution: 'paying_owner', accountId: payingOwner.account_id };
  }
  return null;
};
