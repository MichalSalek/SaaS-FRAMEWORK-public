/**
 * CHECKOUT COMPLETED — entitlement-active gate + per-account serialization.
 *
 * Two invariants of the checkout webhook writer:
 *
 *  B4 (entitlement gate, parity with subscription-lifecycle): `pricing_plan` is
 *  the sole entitlement source, so a `checkout.session.completed` carrying a
 *  NON-entitling subscription (incomplete / abandoned SCA) must write FREE +
 *  NOT_ACTIVE and must NOT queue an "upgraded" email — never a paid entitlement
 *  before payment. Active/trialing promotes to the paid plan unchanged.
 *
 *  B1 (per-account serialization): the handler takes the per-account advisory
 *  lock (key = customerId) BEFORE reading the account, so two concurrent
 *  checkouts of one account can't both skip duplicate-subscription detection
 *  (ghost double-billing). Best-effort — skipped when there is no tx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import {
  AccountStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';

// B1 — advisory lock spy.
const { acquireAdvisoryXactLock } = vi.hoisted(() => ({
  acquireAdvisoryXactLock: vi.fn(async () => undefined),
}));
vi.mock('@app/db/lock-rows', () => ({ acquireAdvisoryXactLock }));

// Outbox spy: the duplicate-cancel obligation written inside the webhook tx.
const { enqueueSubscriptionCancelReconcileTx } = vi.hoisted(() => ({
  enqueueSubscriptionCancelReconcileTx: vi.fn(async () => undefined),
}));
vi.mock(
  '@app/stripe/cancel-reconcile/stripe-cancel-reconcile.operations',
  () => ({
    enqueueSubscriptionCancelReconcileTx,
  })
);

// SSOT plan writer spy (applied=true).
const { updateAccountPlanStatus } = vi.hoisted(() => ({
  updateAccountPlanStatus: vi.fn(
    async (_p: { pricingPlan: PricingPlan; accountStatus: string }) => true
  ),
}));
vi.mock('@app/stripe/plan-status-update.operations', () => ({
  updateAccountPlanStatus,
}));

// Resolver + validation helpers stubbed; the subscription-dates stub drives the
// entitlement gate via `isSubscriptionActive`.
const resolvedUser = {
  id: 'usr_1',
  email: 'u@example.pl',
  stylist_account: {
    account_id: 'acc_1',
    pricing_plan: PricingPlanValue.FREE as PricingPlan,
    stripe_customer_id: 'cus_1',
    subscription_id: null as string | null,
    created_by_user_id: 'usr_1',
  },
};
type SubStatus =
  (typeof SubscriptionStatusValue)[keyof typeof SubscriptionStatusValue];
const subDates = {
  value: {
    subscriptionStatus: SubscriptionStatusValue.ACTIVE as SubStatus,
    isSubscriptionActive: true,
    cancelAtPeriodEnd: false,
    cancelAt: null as Date | null,
    currentPeriodEnd: null as Date | null,
  },
};
const { upgradeEmailFactory } = vi.hoisted(() => ({
  upgradeEmailFactory: vi.fn(() => async () => undefined),
}));
vi.mock('./checkout.handler.utils', () => ({
  resolveCheckoutUser: vi.fn(async () => resolvedUser),
  validateCheckoutData: vi.fn(async () => ({
    validatedPlanId: 'app-price-1',
    pricingPlanValue: PricingPlanValue.PRO,
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
  })),
  detectDuplicateSubscription: vi.fn(() =>
    resolvedUser.stylist_account.subscription_id ? async () => undefined : null
  ),
  extractCheckoutSubscriptionDates: vi.fn(() => subDates.value),
  sendUpgradeConfirmationEmail: upgradeEmailFactory,
}));

vi.mock('@app/stripe/webhooks/stripe-webhooks.utils', () => ({
  extractCustomerId: ({ customer }: { customer: unknown }) =>
    typeof customer === 'string' ? customer : undefined,
  parseCheckoutMetadata: () => ({}),
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import { handleCheckoutCompleted } from './checkout.handler';

const session = {
  id: 'cs_1',
  metadata: {},
  client_reference_id: 'usr_1',
  customer_email: 'u@example.pl',
  customer: 'cus_1',
  subscription: { id: 'sub_1', status: 'active' },
} as never;

const EVENT_AT = new Date(1_800_000_000_000);
const written = () => updateAccountPlanStatus.mock.calls.at(-1)?.[0];

const run = (tx?: unknown) =>
  handleCheckoutCompleted({
    session,
    eventCreatedAt: EVENT_AT,
    ...(tx !== undefined && { tx: tx as never }),
  });

describe('handleCheckoutCompleted — entitlement gate + serialization', () => {
  beforeEach(() => {
    acquireAdvisoryXactLock.mockClear();
    enqueueSubscriptionCancelReconcileTx.mockClear();
    resolvedUser.stylist_account.subscription_id = null;
    updateAccountPlanStatus.mockClear();
    upgradeEmailFactory.mockClear();
    subDates.value.isSubscriptionActive = true;
    subDates.value.subscriptionStatus = SubscriptionStatusValue.ACTIVE;
  });

  it('active subscription → writes the paid plan + ACTIVE and queues the upgrade email', async () => {
    const { effects } = await run({});
    expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
    expect(written()?.pricingPlan).toBe(PricingPlanValue.PRO);
    expect(written()?.accountStatus).toBe(AccountStatusValue.ACTIVE);
    expect(upgradeEmailFactory).toHaveBeenCalledTimes(1);
    expect(effects.length).toBe(1);
  });

  it('B4: non-entitling subscription (incomplete) → writes FREE (no paid entitlement), NO upgrade email', async () => {
    subDates.value.isSubscriptionActive = false;
    subDates.value.subscriptionStatus = SubscriptionStatusValue.INCOMPLETE;
    const { effects } = await run({});
    expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
    expect(written()?.pricingPlan).toBe(PricingPlanValue.FREE);
    // account_status stays ACTIVE — NOT_ACTIVE is reserved for ban/dispute and
    // would lock the FREE user out (free-select won't reactivate it).
    expect(written()?.accountStatus).toBe(AccountStatusValue.ACTIVE);
    // A FREE write must never masquerade as an "upgraded to Pro" email.
    expect(upgradeEmailFactory).not.toHaveBeenCalled();
    expect(effects).toEqual([]);
  });

  it('B1: takes the per-account advisory lock keyed on customerId before reading', async () => {
    await run({});
    expect(acquireAdvisoryXactLock).toHaveBeenCalledTimes(1);
    expect(acquireAdvisoryXactLock).toHaveBeenCalledWith(
      expect.anything(),
      'cus_1'
    );
  });

  it('B1: outside a tx (janitor edge) the lock is skipped (best-effort)', async () => {
    await run(undefined);
    expect(acquireAdvisoryXactLock).not.toHaveBeenCalled();
  });

  it('duplicate checkout → records the OLD-sub cancel in the SAME tx before the effect runs', async () => {
    resolvedUser.stylist_account.subscription_id = 'sub_old';
    const tx = {};
    const { effects } = await run(tx);
    expect(enqueueSubscriptionCancelReconcileTx).toHaveBeenCalledWith(tx, {
      subscriptionId: 'sub_old',
      userId: 'usr_1',
      reason: expect.any(String),
      flavor: 'duplicate',
    });
    // Cancel effect + upgrade email: the outbox row is a net, not a replacement.
    expect(effects).toHaveLength(2);
  });

  it('stale replay (recency guard skipped the write) → NO outbox row and NO cancel effect', async () => {
    resolvedUser.stylist_account.subscription_id = 'sub_live';
    updateAccountPlanStatus.mockResolvedValueOnce(false);
    const { effects } = await run({});
    // The "old" id is the LIVE subscription here; cancelling it would kill it.
    expect(enqueueSubscriptionCancelReconcileTx).not.toHaveBeenCalled();
    expect(effects).toEqual([]);
  });

  it('no duplicate → no outbox row', async () => {
    await run({});
    expect(enqueueSubscriptionCancelReconcileTx).not.toHaveBeenCalled();
  });
});
