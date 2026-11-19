/**
 * ENTITLEMENT-ACTIVE GATE — regression test.
 *
 * `pricing_plan` is the sole entitlement source (gallery-create and user-query read only
 * pricing_plan; account-state-guard gates on is_active, NOT on Stripe's account_status).
 * So handleSubscriptionUpdated MUST promote to a paid plan ONLY when the subscription really
 * grants access (isSubscriptionActive). A non-active status (incomplete/unpaid/paused/canceled)
 * → pricing_plan=FREE, otherwise an unpaid subscription would keep PRO quota.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import { getPlanIdFromPricingPlanValue } from '@app/stripe/stripe.config';
const provider = vi.hoisted(() => ({
  getStripe: vi.fn(),
  retrievePrice: vi.fn(),
  retrieveProduct: vi.fn(),
}));
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: provider.getStripe,
}));

vi.mock('@app/db/lock-rows', () => ({
  acquireAdvisoryXactLock: vi.fn(async () => undefined),
  lockUserRow: vi.fn(async () => ({ id: 'usr_1' })),
}));

// ── Account returned by the lookup (starts on FREE). ───────────────────────────
const account = {
  account_id: 'acc_1',
  pricing_plan: PricingPlanValue.FREE as PricingPlan,
  created_by_user_id: 'usr_1',
  subscription_status: null,
  subscription_id: null as string | null,
};
vi.mock('@app/stripe/webhooks/stripe-webhooks.db', () => ({
  findAccountByCustomerId: vi.fn(async () => account),
}));

// ── SSOT plan-writer: spy (zwraca applied=true). vi.hoisted → referencja bezpieczna
// w hoistowanej fabryce vi.mock; typowany param → typed dostęp do mock.calls. ─────
const { updateAccountPlanStatus } = vi.hoisted(() => ({
  updateAccountPlanStatus: vi.fn(
    async (_params: { pricingPlan: PricingPlan; accountStatus: string }) => true
  ),
}));
vi.mock('@app/stripe/plan-status-update.operations', () => ({
  updateAccountPlanStatus,
}));

// ── Brak pending/schedule → ścieżka natychmiastowego sync (write). ─────────────
vi.mock('@app/stripe/subscription-schedule.utils', () => ({
  hasPendingUpdate: () => false,
  hasActiveSchedule: () => false,
  extractSubscriptionDateFields: () => ({
    cancelAt: null,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null,
  }),
}));

// ── Force the state-change path (not a no-op); churn/trial effects = noop. ─────
vi.mock('./subscription-update.utils', () => ({
  hasSubscriptionStateChanged: () => true,
  updateAccountStatusWithoutPlanChange: vi.fn(async () => undefined),
  handleChurnAlert: vi.fn(async () => null),
  // Downgrade alert: export called by handleSubscriptionUpdated; noop effect like
  // handleChurnAlert (alerts are out of scope for this gate test).
  handleDowngradeAlert: vi.fn(async () => null),
  handleTrialFieldsUpdate: vi.fn(async () => undefined),
  buildSubscriptionAnalyticsEffects: vi.fn(() => []),
}));

vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));

import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
} from './subscription-lifecycle.handler';
import { handleTrialFieldsUpdate } from './subscription-update.utils';

const PRO_PLAN_ID = getPlanIdFromPricingPlanValue(PricingPlanValue.PRO);

const buildSubscription = (status: string) =>
  ({
    id: 'sub_1',
    customer: 'cus_1',
    status,
    metadata: {},
    pending_update: null,
    items: {
      data: [
        {
          id: 'si_1',
          price: { id: 'price_1', product: 'prod_1' },
          current_period_end: 1_900_000_000,
        },
      ],
    },
  }) as unknown as Stripe.Subscription;

const callWith = (status: string) =>
  handleSubscriptionUpdated({
    subscription: buildSubscription(status),
    eventCreatedAt: new Date(1_800_000_000_000),
    prefetchedPlanId: PRO_PLAN_ID,
  });

const writtenPlan = () => updateAccountPlanStatus.mock.calls.at(-1)?.[0];

describe('handleSubscriptionUpdated — entitlement-active gate', () => {
  beforeEach(() => {
    updateAccountPlanStatus.mockClear();
    provider.getStripe.mockReset();
    provider.retrievePrice.mockReset();
    provider.retrieveProduct.mockReset();
    provider.getStripe.mockReturnValue({
      prices: { retrieve: provider.retrievePrice },
      products: { retrieve: provider.retrieveProduct },
    });
    account.pricing_plan = PricingPlanValue.FREE;
    account.subscription_id = null;
    vi.mocked(handleTrialFieldsUpdate).mockClear();
  });

  it('active subscription → promuje pricing_plan do planu z ceny (PRO)', async () => {
    await callWith('active');
    expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
    expect(writtenPlan()?.pricingPlan).toBe(PricingPlanValue.PRO);
  });

  it('trialing → promuje do PRO (trial daje dostęp)', async () => {
    await callWith('trialing');
    expect(writtenPlan()?.pricingPlan).toBe(PricingPlanValue.PRO);
  });

  it.each(['incomplete', 'incomplete_expired', 'unpaid', 'paused', 'canceled'])(
    'non-active status %s (canonical/no sub) → pisze FREE (NIE PRO), zero unpaid-entitlement',
    async status => {
      await callWith(status);
      expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
      expect(writtenPlan()?.pricingPlan).toBe(PricingPlanValue.FREE);
    }
  );

  it('non-canonical non-active sub (konto ma inną current sub) → BRAK write (płacące konto chronione przed osieroconą wtórną sub)', async () => {
    // Konto śledzi aktywną sub A; przychodzi non-active event dla osieroconej sub B.
    account.subscription_id = 'sub_A';
    account.pricing_plan = PricingPlanValue.PRO;
    // buildSubscription używa id 'sub_1' (≠ 'sub_A') → non-canonical.
    await callWith('incomplete_expired');
    expect(updateAccountPlanStatus).not.toHaveBeenCalled();
  });

  it('canonical non-active sub (event == account.subscription_id) → pisze FREE', async () => {
    account.subscription_id = 'sub_1'; // == buildSubscription id
    await callWith('canceled');
    expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
    expect(writtenPlan()?.pricingPlan).toBe(PricingPlanValue.FREE);
  });
  it('rejects a superseded active event even if the old subscription remains the account pointer', async () => {
    account.subscription_id = 'sub_1';
    const subscription = {
      ...buildSubscription('active'),
      metadata: { attemptId: 'old', accountId: 'acc_1' },
    };
    const tx = {
      $queryRaw: vi.fn(async () => [
        {
          attempt_id: 'new',
          phase: 'preparing',
          stripe_session_id: null,
          stripe_subscription_id: null,
        },
      ]),
    };
    const result = await handleSubscriptionUpdated({
      subscription,
      eventCreatedAt: new Date(1_800_000_000_000),
      prefetchedPlanId: PRO_PLAN_ID,
      tx: tx as never,
    });
    expect(updateAccountPlanStatus).not.toHaveBeenCalled();
    expect(vi.mocked(handleTrialFieldsUpdate)).not.toHaveBeenCalled();
    expect(result.effects).toHaveLength(1);
  });

  it('rejects an old created event before its separate trial write', async () => {
    const subscription = {
      ...buildSubscription('trialing'),
      metadata: { attemptId: 'old', accountId: 'acc_1' },
    };
    const tx = {
      $queryRaw: vi.fn(async () => [
        {
          attempt_id: 'new',
          phase: 'open',
          stripe_session_id: 'cs_new',
          stripe_subscription_id: 'sub_new',
        },
      ]),
    };
    const result = await handleSubscriptionCreated({
      subscription,
      eventCreatedAt: new Date(1_800_000_000_000),
      prefetchedPlanId: PRO_PLAN_ID,
      tx: tx as never,
    });
    expect(updateAccountPlanStatus).not.toHaveBeenCalled();
    expect(vi.mocked(handleTrialFieldsUpdate)).not.toHaveBeenCalled();
    expect(result.effects).toHaveLength(1);
  });
  it('accepts a matching first subscription when no current subscription is stored', async () => {
    const subscription = {
      ...buildSubscription('active'),
      metadata: { attemptId: 'new', accountId: 'acc_1' },
    };
    const tx = {
      $queryRaw: vi.fn(async () => [
        {
          attempt_id: 'new',
          phase: 'preparing',
          stripe_session_id: null,
          stripe_subscription_id: null,
        },
      ]),
      stylistAccount: {
        findUnique: vi.fn(async () => ({
          subscription_id: null,
          subscription_status: null,
        })),
      },
    };
    await handleSubscriptionUpdated({
      subscription,
      eventCreatedAt: new Date(1_800_000_000_000),
      prefetchedPlanId: PRO_PLAN_ID,
      tx: tx as never,
    });
    expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
  });

  it('does not replace an existing active subscription even for a matching attempt', async () => {
    const subscription = {
      ...buildSubscription('active'),
      metadata: { attemptId: 'new', accountId: 'acc_1' },
    };
    const tx = {
      $queryRaw: vi.fn(async () => [
        {
          attempt_id: 'new',
          phase: 'preparing',
          stripe_session_id: null,
          stripe_subscription_id: null,
        },
      ]),
      stylistAccount: {
        findUnique: vi.fn(async () => ({
          subscription_id: 'sub_live',
          subscription_status: 'ACTIVE',
        })),
      },
    };
    const result = await handleSubscriptionUpdated({
      subscription,
      eventCreatedAt: new Date(1_800_000_000_000),
      prefetchedPlanId: PRO_PLAN_ID,
      tx: tx as never,
    });
    expect(updateAccountPlanStatus).not.toHaveBeenCalled();
    expect(result.effects).toHaveLength(1);
  });
  it.each(['updated', 'created'] as const)(
    'does not fetch Stripe for an unexpanded tagged %s event inside a transaction',
    async kind => {
      const subscription = {
        ...buildSubscription('active'),
        metadata: { attemptId: 'new', accountId: 'acc_1', planId: PRO_PLAN_ID },
      };
      const tx = {
        $queryRaw: vi.fn(async () => [
          {
            attempt_id: 'new',
            phase: 'preparing',
            stripe_session_id: null,
            stripe_subscription_id: null,
          },
        ]),
        stylistAccount: {
          findUnique: vi.fn(async () => ({
            subscription_id: null,
            subscription_status: null,
          })),
        },
      };
      const args = {
        subscription,
        eventCreatedAt: new Date(1_800_000_000_000),
        tx: tx as never,
      };
      const result =
        kind === 'created'
          ? handleSubscriptionCreated(args)
          : handleSubscriptionUpdated(args);
      await expect(result).rejects.toThrow(
        'requires prefetched or expanded plan data'
      );
      expect(provider.getStripe).not.toHaveBeenCalled();
      expect(provider.retrievePrice).not.toHaveBeenCalled();
      expect(provider.retrieveProduct).not.toHaveBeenCalled();
      expect(updateAccountPlanStatus).not.toHaveBeenCalled();
    }
  );

  it('uses an already-expanded product instead of fetching Stripe', async () => {
    const subscription = {
      ...buildSubscription('active'),
      metadata: { attemptId: 'new', accountId: 'acc_1' },
    };
    const item = subscription.items.data[0];
    if (!item) {
      throw new Error('Missing test price');
    }
    const product: Partial<Stripe.Product> = {
      id: 'prod_1',
      object: 'product',
      metadata: { planId: PRO_PLAN_ID },
    };
    item.price.product = product as Stripe.Product;
    const tx = {
      $queryRaw: vi.fn(async () => [
        {
          attempt_id: 'new',
          phase: 'preparing',
          stripe_session_id: null,
          stripe_subscription_id: null,
        },
      ]),
      stylistAccount: {
        findUnique: vi.fn(async () => ({
          subscription_id: null,
          subscription_status: null,
        })),
      },
    };
    await handleSubscriptionUpdated({
      subscription,
      eventCreatedAt: new Date(1_800_000_000_000),
      tx: tx as never,
    });
    expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
    expect(provider.getStripe).not.toHaveBeenCalled();
    expect(provider.retrievePrice).not.toHaveBeenCalled();
    expect(provider.retrieveProduct).not.toHaveBeenCalled();
  });
});
