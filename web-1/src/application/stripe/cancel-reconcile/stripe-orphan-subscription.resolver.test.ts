/**
 * classifyOrphanSubscription — pins the money-path whitelist of SPAR Option A:
 * the scan queues a cancel ONLY for the three shapes some code path already
 * decided to cancel, never for a subscription a live account is paying on.
 */
import { describe, expect, it } from 'vitest';

import {
  ORPHAN_SCAN_MIN_AGE_MS,
  classifyOrphanSubscription,
  type OrphanScanAccount,
  type OrphanScanSubscription,
} from './stripe-orphan-subscription.resolver';

const NOW = new Date('2026-10-18T12:00:00Z');
const OLD = Math.floor((NOW.getTime() - ORPHAN_SCAN_MIN_AGE_MS) / 1000 - 3600);

const sub = (
  overrides: Partial<OrphanScanSubscription> = {}
): OrphanScanSubscription => ({
  id: 'sub_target',
  created: OLD,
  cancelAtPeriodEnd: false,
  scoped: true,
  ...overrides,
});

const account = (
  overrides: Partial<OrphanScanAccount> = {}
): OrphanScanAccount => ({
  accountId: 'acc_1',
  subscriptionId: 'sub_target',
  pricingPlan: 'PRO',
  paymentStatus: 'PAID',
  adminPlanOverride: false,
  ownerUserId: 'usr_1',
  ownerIsActive: true,
  ownerDeletedAt: null,
  ...overrides,
});

const classify = ({
  subscription = sub(),
  referencing = [] as OrphanScanAccount[],
  byCustomer = null as OrphanScanAccount | null,
  byMetadata = null as OrphanScanAccount | null,
  live = new Map<string, number>(),
} = {}) =>
  classifyOrphanSubscription({
    subscription,
    referencingAccounts: referencing,
    ownerByCustomer: byCustomer,
    ownerByMetadata: byMetadata,
    liveCreatedById: live,
    now: NOW,
  });

describe('classifyOrphanSubscription — skips', () => {
  it('never touches a subscription outside the Nailfolio scope', () => {
    expect(classify({ subscription: sub({ scoped: false }) })).toEqual({
      kind: 'foreign',
    });
  });

  it('skips a subscription already set to end (no further charge)', () => {
    expect(
      classify({ subscription: sub({ cancelAtPeriodEnd: true }) }).kind
    ).toBe('winding_down');
  });

  it('does not judge a fresh subscription whose checkout webhook may still be in flight', () => {
    const fresh = Math.floor(NOW.getTime() / 1000) - 60;
    expect(
      classify({
        subscription: sub({ created: fresh }),
        byCustomer: account({ ownerDeletedAt: new Date() }),
      }).kind
    ).toBe('too_young');
  });
});

describe('classifyOrphanSubscription — safety rule', () => {
  it.each(['PAID', 'IN_PROGRESS', 'REJECTED'] as const)(
    'keeps a subscription a live account points at with payment status %s',
    paymentStatus => {
      const owner = account({
        paymentStatus,
        adminPlanOverride: true,
        pricingPlan: 'FREE',
      });
      expect(classify({ referencing: [owner], byCustomer: owner }).kind).toBe(
        'owned'
      );
    }
  );

  it('the safety rule wins over a conflicting stale owner record', () => {
    const paying = account({ accountId: 'acc_paying' });
    const stale = account({
      accountId: 'acc_stale',
      ownerDeletedAt: new Date(),
    });
    expect(classify({ referencing: [paying], byCustomer: stale }).kind).toBe(
      'owned'
    );
  });
});

describe('classifyOrphanSubscription — enqueue whitelist', () => {
  it('soft-deleted owner → deletion flavor (reactivation guard stays armed)', () => {
    const owner = account({ ownerIsActive: false, ownerDeletedAt: new Date() });
    expect(classify({ referencing: [owner], byCustomer: owner })).toEqual({
      kind: 'enqueue',
      reason: 'deleted_owner',
      flavor: 'deletion',
      userId: 'usr_1',
    });
  });

  it('admin-downgraded FREE/UNPAID account still on the subscription → duplicate flavor', () => {
    const owner = account({
      pricingPlan: 'FREE',
      paymentStatus: 'UNPAID',
      adminPlanOverride: true,
    });
    expect(classify({ referencing: [owner], byCustomer: owner })).toEqual({
      kind: 'enqueue',
      reason: 'admin_downgrade',
      flavor: 'duplicate',
      userId: 'usr_1',
    });
  });

  it('older subscription superseded by a NEWER linked live one → duplicate flavor', () => {
    const owner = account({ subscriptionId: 'sub_newer' });
    expect(
      classify({
        byCustomer: owner,
        live: new Map([['sub_newer', OLD + 100]]),
      })
    ).toEqual({
      kind: 'enqueue',
      reason: 'superseded',
      flavor: 'duplicate',
      userId: 'usr_1',
    });
  });

  it('finds the owner through metadata.accountId when the customer is unknown', () => {
    const owner = account({ ownerDeletedAt: new Date() });
    expect(classify({ byMetadata: owner }).kind).toBe('enqueue');
  });
});

describe('classifyOrphanSubscription — report only, never cancel', () => {
  it('unlinked subscription NEWER than the linked one (checkout not linked yet)', () => {
    const owner = account({ subscriptionId: 'sub_older' });
    expect(
      classify({ byCustomer: owner, live: new Map([['sub_older', OLD - 100]]) })
    ).toEqual({ kind: 'report', reason: 'unlinked_newer' });
  });

  it('linked subscription not in the scanned set (capped scan or not live)', () => {
    const owner = account({ subscriptionId: 'sub_elsewhere' });
    expect(classify({ byCustomer: owner })).toEqual({
      kind: 'report',
      reason: 'linked_sub_not_scanned',
    });
  });

  it('live account with no linked subscription (failed activation)', () => {
    expect(classify({ byCustomer: account({ subscriptionId: null }) })).toEqual(
      { kind: 'report', reason: 'paid_without_link' }
    );
  });

  it('live UNPAID account on the subscription without an admin override (sync drift)', () => {
    const owner = account({ paymentStatus: 'UNPAID', pricingPlan: 'FREE' });
    expect(classify({ referencing: [owner], byCustomer: owner })).toEqual({
      kind: 'report',
      reason: 'linked_unpaid',
    });
  });

  it('no account knows the subscription (dev/staging on the same Stripe account)', () => {
    expect(classify()).toEqual({ kind: 'report', reason: 'unknown_owner' });
  });

  it('customer and metadata point at different accounts', () => {
    expect(
      classify({
        byCustomer: account({ accountId: 'acc_a' }),
        byMetadata: account({ accountId: 'acc_b' }),
      })
    ).toEqual({ kind: 'report', reason: 'conflicting_owner' });
  });

  it('disabled (banned) but not deleted owner', () => {
    expect(
      classify({
        byCustomer: account({ ownerIsActive: false, subscriptionId: null }),
      })
    ).toEqual({ kind: 'report', reason: 'disabled_owner' });
  });
});
