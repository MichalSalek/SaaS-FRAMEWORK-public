import { TIME } from '@kernel/application/constants.config';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import {
  PaymentStatusValue,
  type PaymentStatus,
} from '@kernel/models/db_models.generated.dto';
import type { CancelReconcileFlavor } from './stripe-cancel-reconcile.resolver';

/** Stripe list page size (Stripe maximum). */
export const ORPHAN_SCAN_PAGE_SIZE = 100;

/**
 * Pages per scan. 10 x 100 = 1000 live subscriptions per run. Above that the scan
 * stops, reports `capped`, and `superseded` decisions that need the linked
 * subscription in the scanned set fall back to report-only (never a guess).
 */
export const ORPHAN_SCAN_MAX_PAGES = 10;

/**
 * Minimum subscription age before it is judged. A fresh checkout is linked by the
 * `checkout.session.completed` webhook, which Stripe and our janitor retry for
 * hours; judging earlier would read a normal in-flight checkout as an orphan.
 */
export const ORPHAN_SCAN_MIN_AGE_MS = 2 * TIME.MS_PER_DAY;

/** Scan cadence. A leaked subscription bills monthly; a few hours of latency is safe. */
export const ORPHAN_SCAN_THROTTLE_MS = 6 * TIME.MS_PER_HOUR;

export type OrphanScanSubscription = {
  id: string;
  /** Unix seconds (Stripe `created`). */
  created: number;
  cancelAtPeriodEnd: boolean;
  /** Result of `isScopedToNailfolio` (plan id + project stamp), computed at the IO seam. */
  scoped: boolean;
};

export type OrphanScanAccount = {
  accountId: string;
  subscriptionId: string | null;
  pricingPlan: PricingPlan;
  paymentStatus: PaymentStatus;
  adminPlanOverride: boolean;
  ownerUserId: string;
  ownerIsActive: boolean;
  ownerDeletedAt: Date | null;
};

export type OrphanScanVerdict =
  | { kind: 'foreign' }
  | { kind: 'winding_down' }
  | { kind: 'too_young' }
  | { kind: 'owned' }
  | {
      kind: 'enqueue';
      reason: 'deleted_owner' | 'admin_downgrade' | 'superseded';
      flavor: CancelReconcileFlavor;
      userId: string;
    }
  | {
      kind: 'report';
      reason:
        | 'unknown_owner'
        | 'conflicting_owner'
        | 'disabled_owner'
        | 'linked_unpaid'
        | 'unlinked_newer'
        | 'linked_sub_not_scanned'
        | 'paid_without_link';
    };

const isLiveOwner = (account: OrphanScanAccount): boolean =>
  account.ownerIsActive && account.ownerDeletedAt === null;

/**
 * Classify one live Stripe subscription.
 *
 * @param referencingAccounts accounts whose `subscription_id` equals this subscription
 * @param ownerByCustomer     account holding the subscription's Stripe customer id
 * @param ownerByMetadata     account named by the subscription's `metadata.accountId`
 * @param liveCreatedById     `created` of every live scoped subscription seen this run
 */
export const classifyOrphanSubscription = ({
  subscription,
  referencingAccounts,
  ownerByCustomer,
  ownerByMetadata,
  liveCreatedById,
  now,
}: {
  subscription: OrphanScanSubscription;
  referencingAccounts: readonly OrphanScanAccount[];
  ownerByCustomer: OrphanScanAccount | null;
  ownerByMetadata: OrphanScanAccount | null;
  liveCreatedById: ReadonlyMap<string, number>;
  now: Date;
}): OrphanScanVerdict => {
  if (!subscription.scoped) {
    return { kind: 'foreign' };
  }
  // Already scheduled to end: no further charge, nothing to reconcile.
  if (subscription.cancelAtPeriodEnd) {
    return { kind: 'winding_down' };
  }
  if (now.getTime() - subscription.created * 1000 < ORPHAN_SCAN_MIN_AGE_MS) {
    return { kind: 'too_young' };
  }
  if (
    referencingAccounts.some(
      account =>
        isLiveOwner(account) &&
        account.paymentStatus !== PaymentStatusValue.UNPAID
    )
  ) {
    return { kind: 'owned' };
  }

  if (
    ownerByCustomer !== null &&
    ownerByMetadata !== null &&
    ownerByCustomer.accountId !== ownerByMetadata.accountId
  ) {
    return { kind: 'report', reason: 'conflicting_owner' };
  }
  const owner =
    ownerByCustomer ?? ownerByMetadata ?? referencingAccounts[0] ?? null;
  if (owner === null) {
    return { kind: 'report', reason: 'unknown_owner' };
  }

  if (owner.ownerDeletedAt !== null) {
    return {
      kind: 'enqueue',
      reason: 'deleted_owner',
      flavor: 'deletion',
      userId: owner.ownerUserId,
    };
  }
  if (!owner.ownerIsActive) {
    // Disabled (ban) without deletion: the admin path owns that decision.
    return { kind: 'report', reason: 'disabled_owner' };
  }

  if (owner.subscriptionId === subscription.id) {
    // Live owner points here and the safety rule above did not fire, so the
    // account is UNPAID on this subscription.
    if (
      owner.adminPlanOverride &&
      owner.pricingPlan === PricingPlanValue.FREE
    ) {
      return {
        kind: 'enqueue',
        reason: 'admin_downgrade',
        flavor: 'duplicate',
        userId: owner.ownerUserId,
      };
    }
    // UNPAID drift on a live subscription: login-time sync heals it.
    return { kind: 'report', reason: 'linked_unpaid' };
  }

  if (owner.subscriptionId === null) {
    return { kind: 'report', reason: 'paid_without_link' };
  }

  const linkedCreated = liveCreatedById.get(owner.subscriptionId);
  if (linkedCreated === undefined) {
    return { kind: 'report', reason: 'linked_sub_not_scanned' };
  }
  if (linkedCreated > subscription.created) {
    return {
      kind: 'enqueue',
      reason: 'superseded',
      flavor: 'duplicate',
      userId: owner.ownerUserId,
    };
  }
  return { kind: 'report', reason: 'unlinked_newer' };
};
