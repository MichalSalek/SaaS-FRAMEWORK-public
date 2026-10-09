/**
 * SPE plan-change unit tests — changePaidPlan_IO (paid→paid via subscription.update).
 *
 * Mocks the resolver (priceId) and Stripe adapter (subscriptions.retrieve/update);
 * DB via the global setup proxy. Asserts the F1 (PDH) contract:
 *
 *  - no subscription_id → PLAN_CHANGE_NO_SUBSCRIPTION (no Stripe calls);
 *  - subscriptions.update is called with proration_behavior='always_invoice' +
 *    payment_behavior='pending_if_incomplete' (price held in pending until paid —
 *    abandoned 3DS does NOT flip the plan; SSOT plan is set by the webhook);
 *  - latest_invoice classification via mapLatestInvoiceToPlanChange:
 *      paid                                  → completed
 *      unpaid + confirmation_secret          → requires_action (+ clientSecret)
 *      unpaid, NO secret                     → payment_failed (+ reason=status)
 *      amount_remaining<=0 / downgrade/$0    → completed (change applied, no charge);
 *  - pending_update guard (pending_if_incomplete keeps the price in pending):
 *      pending exists & item===target        → re-surface latest_invoice, NO update
 *                                              (double-submit on the same plan — a
 *                                               second update would void the live secret);
 *      pending exists & item===OTHER target  → supersede → update IS called;
 *      no pending & currentItem===target     → map latest_invoice (applied / no-op).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

// ── Mock resolver: hand back a target priceId (resolution tested elsewhere). ─────
vi.mock('@app/stripe/price-resolver.operations', () => ({
  resolveCheckoutPrice_IO: vi.fn(async () => ({
    success: true,
    data: { priceId: 'price_proplus_month' },
  })),
}));

// ── Mock Stripe adapter: capture subscriptions.retrieve / update. ────────────────
const subRetrieve = vi.fn();
const subUpdate = vi.fn();
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({
    subscriptions: { retrieve: subRetrieve, update: subUpdate },
  }),
}));

import { changePaidPlan_IO } from './account-plan-change.operations';
import { resolveCheckoutPrice_IO } from '@app/stripe/price-resolver.operations';

const USER_ID = 'usr_test_0000000000000001';
const ACCOUNT_ID = 'acc_test_0000000000000001';
const SUB_ID = 'sub_test_active';
const TARGET_PRICE = 'price_proplus_month';

const mockAccount = (subscriptionId: string | null): void => {
  mockDb({
    user: {
      findUnique: async () => ({
        stylist_account: {
          account_id: ACCOUNT_ID,
          subscription_id: subscriptionId,
        },
      }),
    },
  });
};

/** Subscription on a price DIFFERENT from the target (forces the update path). */
const retrievedSubscription = (): unknown => ({
  id: SUB_ID,
  items: { data: [{ id: 'si_test_item', price: { id: 'price_pro_month' } }] },
  pending_update: null,
});

describe('changePaidPlan_IO — SPE paid→paid plan change', () => {
  beforeEach(() => {
    subRetrieve.mockReset();
    subUpdate.mockReset();
    vi.mocked(resolveCheckoutPrice_IO).mockResolvedValue({
      success: true,
      data: { priceId: TARGET_PRICE },
    });
  });

  it('subscription_id === null → PLAN_CHANGE_NO_SUBSCRIPTION (no Stripe calls)', async () => {
    mockAccount(null);

    const result = await changePaidPlan_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('PLAN_CHANGE_NO_SUBSCRIPTION');
    }
    expect(subRetrieve).not.toHaveBeenCalled();
    expect(subUpdate).not.toHaveBeenCalled();
  });

  it('calls subscriptions.update with proration_behavior=always_invoice + payment_behavior=pending_if_incomplete and target price', async () => {
    mockAccount(SUB_ID);
    subRetrieve.mockResolvedValue(retrievedSubscription());
    subUpdate.mockResolvedValue({ latest_invoice: null });

    const result = await changePaidPlan_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    expect(subUpdate).toHaveBeenCalledTimes(1);
    const [subscriptionId, params] = subUpdate.mock.calls[0] as [
      string,
      {
        items: { id: string; price: string }[];
        proration_behavior: string;
        payment_behavior: string;
        expand: string[];
      },
    ];
    expect(subscriptionId).toBe(SUB_ID);
    // F1 (PDH): always_invoice forces the immediate proration invoice (so SCA can
    // surface for same-interval paid→paid); pending_if_incomplete holds the change
    // in subscription.pending_update until the invoice is paid.
    expect(params.proration_behavior).toBe('always_invoice');
    expect(params.payment_behavior).toBe('pending_if_incomplete');
    expect(params.items[0]?.id).toBe('si_test_item');
    expect(params.items[0]?.price).toBe(TARGET_PRICE);
    expect(params.expand).toContain('latest_invoice.confirmation_secret');
  });

  it('unpaid invoice + confirmation_secret → {status:requires_action, clientSecret}', async () => {
    mockAccount(SUB_ID);
    subRetrieve.mockResolvedValue(retrievedSubscription());
    subUpdate.mockResolvedValue({
      latest_invoice: {
        id: 'in_test',
        status: 'open',
        amount_remaining: 1290,
        amount_due: 1290,
        confirmation_secret: {
          client_secret: 'pi_secret_3ds',
          type: 'payment_intent',
        },
      },
    });

    const result = await changePaidPlan_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('requires_action');
      if (result.data.status === 'requires_action') {
        expect(result.data.clientSecret).toBe('pi_secret_3ds');
      }
    }
  });

  it('unpaid invoice WITHOUT confirmation_secret → {status:payment_failed, reason}', async () => {
    mockAccount(SUB_ID);
    subRetrieve.mockResolvedValue(retrievedSubscription());
    subUpdate.mockResolvedValue({
      latest_invoice: {
        id: 'in_test',
        status: 'open',
        amount_remaining: 1290,
        amount_due: 1290,
        // No confirmation_secret → hard decline / no usable payment method.
      },
    });

    const result = await changePaidPlan_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('payment_failed');
      if (result.data.status === 'payment_failed') {
        expect(result.data.reason).toBe('open');
      }
    }
  });

  it('card on-file confirms (invoice paid) → {status:completed}', async () => {
    mockAccount(SUB_ID);
    subRetrieve.mockResolvedValue(retrievedSubscription());
    subUpdate.mockResolvedValue({
      latest_invoice: {
        id: 'in_test',
        status: 'paid',
        amount_remaining: 0,
        confirmation_secret: {
          client_secret: 'pi_secret',
          type: 'payment_intent',
        },
      },
    });

    const result = await changePaidPlan_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('completed');
      // `completed` is a bare status — no clientSecret/reason fields on this variant.
      expect('clientSecret' in result.data).toBe(false);
    }
  });

  it('unpaid invoice but amount_remaining<=0 (downgrade / $0 with credit) → {status:completed}', async () => {
    mockAccount(SUB_ID);
    subRetrieve.mockResolvedValue(retrievedSubscription());
    subUpdate.mockResolvedValue({
      latest_invoice: {
        id: 'in_credit',
        // status is NOT 'paid', but the proration nets to <= 0 (account credit /
        // downgrade) → the change applies with no payment due → completed.
        status: 'open',
        amount_remaining: 0,
        amount_due: 0,
      },
    });

    const result = await changePaidPlan_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('completed');
    }
  });

  it('no latest_invoice → {status:completed}', async () => {
    mockAccount(SUB_ID);
    subRetrieve.mockResolvedValue(retrievedSubscription());
    subUpdate.mockResolvedValue({ latest_invoice: null });

    const result = await changePaidPlan_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('completed');
    }
  });

  // ── pending_update guard: pending same-target → re-surface, NEVER a 2nd update. ──
  it('pending_update on SAME target + open invoice + confirmation_secret → re-surface requires_action (NO update)', async () => {
    mockAccount(SUB_ID);
    // pending_if_incomplete: item is STILL on the old price; the target is held in
    // subscription.pending_update. A same-session double-submit must re-surface the
    // live secret, NOT call update again (which would void the working 3DS secret).
    subRetrieve.mockResolvedValue({
      id: SUB_ID,
      items: {
        data: [{ id: 'si_test_item', price: { id: 'price_pro_month' } }],
      },
      pending_update: {
        subscription_items: [{ price: TARGET_PRICE }],
      },
      latest_invoice: {
        id: 'in_resurface',
        status: 'open',
        amount_remaining: 1290,
        confirmation_secret: {
          client_secret: 'pi_secret_resurface',
          type: 'payment_intent',
        },
      },
    });

    const result = await changePaidPlan_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('requires_action');
      if (result.data.status === 'requires_action') {
        expect(result.data.clientSecret).toBe('pi_secret_resurface');
      }
    }
    // Guard short-circuits BEFORE subscriptions.update — zero second proration.
    expect(subUpdate).not.toHaveBeenCalled();
  });

  // ── pending_update guard: pending OTHER target → supersede → update IS called. ──
  it('pending_update on a DIFFERENT target → supersede → subscriptions.update IS called with new target', async () => {
    mockAccount(SUB_ID);
    // User changed their mind: a pending update targets a different price than the
    // one now requested → Stripe voids the old pending and creates a new one.
    subRetrieve.mockResolvedValue({
      id: SUB_ID,
      items: {
        data: [{ id: 'si_test_item', price: { id: 'price_pro_month' } }],
      },
      pending_update: {
        subscription_items: [{ price: 'price_studio_month' }],
      },
      latest_invoice: null,
    });
    subUpdate.mockResolvedValue({ latest_invoice: null });

    const result = await changePaidPlan_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    expect(subUpdate).toHaveBeenCalledTimes(1);
    const [, params] = subUpdate.mock.calls[0] as [
      string,
      { items: { id: string; price: string }[] },
    ];
    expect(params.items[0]?.price).toBe(TARGET_PRICE);
  });

  // ── No pending + currentItem already == target → map latest_invoice, NO update. ──
  it('no pending_update + item already on target → map latest_invoice (applied / no-op), NO update', async () => {
    mockAccount(SUB_ID);
    subRetrieve.mockResolvedValue({
      id: SUB_ID,
      items: {
        data: [{ id: 'si_test_item', price: { id: TARGET_PRICE } }],
      },
      pending_update: null,
      latest_invoice: { id: 'in_paid', status: 'paid', amount_remaining: 0 },
    });

    const result = await changePaidPlan_IO({
      userId: USER_ID,
      targetPlanId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('completed');
    }
    expect(subUpdate).not.toHaveBeenCalled();
  });
});
