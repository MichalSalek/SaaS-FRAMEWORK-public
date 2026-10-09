/**
 * F1 (PDH) webhook test — handleSubscriptionUpdated resolves the plan PRICE-FIRST.
 *
 * With payment_behavior:'pending_if_incomplete', a paid→paid plan change keeps the
 * subscription ITEM on the OLD price until the proration invoice is paid; the target
 * lives in subscription.pending_update. `extractPlanIdFromSubscription` was made
 * PRICE-FIRST (item price → planId, metadata only a fallback) precisely so the webhook
 * does NOT sync the DB plan before payment — an abandoned 3DS must not flip the plan.
 *
 * We drive the REAL `extractPlanIdFromSubscription` (item price → product.metadata.planId,
 * no Stripe API: the product is pre-expanded) and assert the handler's branch:
 *   1. item on the OLD price + pending_update present
 *        → keep current plan: updateAccountStatusWithoutPlanChange is called,
 *          updateAccountPlanStatus (the plan-changing write) is NEVER called.
 *   2. item on the NEW price (pending already applied by Stripe)
 *        → sync the new plan: updateAccountPlanStatus is called with the new plan.
 *   3. item reverted to the OLD price + no pending (pending_update_expired)
 *        → keep the OLD plan: no plan write diverging from the current DB plan
 *          (the no-op gate short-circuits because nothing changed).
 *
 * Mocks: findAccountByCustomerId (snapshot), updateAccountPlanStatus +
 * updateAccountStatusWithoutPlanChange (terminal spies), getStripe (inert — never
 * invoked since prices are pre-expanded). hasSubscriptionStateChanged / churn / trial
 * stay REAL so the divergence + no-op logic is exercised, not stubbed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  AccountStatusValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import type * as SubscriptionUpdateUtils from '@app/stripe/webhooks/handlers/subscription-update.utils';

// ── Hoisted spies + account holder ────────────────────────────────────────────
// vi.mock factories are hoisted above top-level consts, so the spies they close
// over MUST be created in vi.hoisted() (same pattern as test-utils/setup.ts).
const mocks = vi.hoisted(() => ({
  accountHolder: { value: null as unknown },
  // findAccountByCustomerId — returns the per-test account snapshot.
  findAccount: vi.fn<() => Promise<unknown>>(),
  // updateAccountPlanStatus = the plan-CHANGING write (sync path). Typed with the
  // single arg shape we assert on so `mock.calls[0][0]` is well-typed under strict TS.
  updatePlanStatus: vi.fn<
    (arg: {
      accountId: string;
      pricingPlan: string;
      stripeEventAt?: Date;
    }) => Promise<void>
  >(async () => undefined),
  // updateAccountStatusWithoutPlanChange = the KEEP-current-plan write (pending path).
  updateWithoutPlanChange: vi.fn<
    (arg: { account: { account_id: string } }) => Promise<void>
  >(async () => undefined),
  // bumpStripeEventWatermark = recency-fence advanced on the no-op gate (does NOT
  // change plan state) — mocked so the no-op path doesn't hit a real DB client.
  bumpWatermark: vi.fn<
    (arg: { accountId: string; stripeEventAt: Date }) => Promise<void>
  >(async () => undefined),
}));
const {
  accountHolder,
  findAccount,
  updatePlanStatus,
  updateWithoutPlanChange,
} = mocks;
findAccount.mockImplementation(async () => accountHolder.value);

vi.mock('@app/stripe/webhooks/stripe-webhooks.db', () => ({
  findAccountByCustomerId: mocks.findAccount,
}));

vi.mock('@app/stripe/plan-status-update.operations', () => ({
  updateAccountPlanStatus: mocks.updatePlanStatus,
  bumpStripeEventWatermark: mocks.bumpWatermark,
}));

// Keep every other export of subscription-update.utils REAL (hasSubscriptionStateChanged,
// churn, trial) so the handler's divergence + no-op gates run for real.
vi.mock(
  '@app/stripe/webhooks/handlers/subscription-update.utils',
  async importOriginal => {
    const actual = await importOriginal<typeof SubscriptionUpdateUtils>();
    return {
      ...actual,
      updateAccountStatusWithoutPlanChange: mocks.updateWithoutPlanChange,
    };
  }
);

// ── Inert Stripe adapter: getStripe must not throw (no STRIPE_SECRET_KEY in tests).
// It is never actually called here because every item price is pre-expanded, so
// extractPlanIdFromSubscription resolves the planId from product.metadata directly. ─
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({
    prices: {
      retrieve: vi.fn(async () => {
        throw new Error(
          'stripe.prices.retrieve must not be called (price pre-expanded)'
        );
      }),
    },
  }),
}));

import { handleSubscriptionUpdated } from '@app/stripe/webhooks/handlers/subscription-lifecycle.handler';
import type Stripe from 'stripe';

const CUSTOMER_ID = 'cus_test_0000000000000001';
const ACCOUNT_ID = 'acc_test_0000000000000001';
const SUB_ID = 'sub_test_active';
const EVENT_AT = new Date('2026-06-20T12:00:00.000Z');

// PLAN_ID_MAP (kernel SSOT): PRO → 'app-price-1', PRO_PLUS → 'app-price-2'.
const OLD_PLAN_ID = 'app-price-1'; // PRO  (current DB plan)
const NEW_PLAN_ID = 'app-price-2'; // PRO+ (target of the in-flight change)

/**
 * Build a subscription whose first item carries an EXPANDED price+product. The
 * product.metadata.planId drives the real (price-first) extractPlanIdFromSubscription
 * WITHOUT any Stripe API call. Distinct priceIds per scenario sidestep the module-level
 * price→planId cache in stripe-webhooks.utils.
 */
const subscriptionWith = ({
  priceId,
  planId,
  pending,
  metadataPlanId,
  productAsString,
}: {
  priceId: string;
  planId: string;
  pending: boolean;
  // Subscription-level metadata.planId — the metadata-first source. When set ≠ the
  // item price's planId, it proves the resolver reads the ITEM PRICE first (the trap
  // a metadata-first regression would fall into).
  metadataPlanId?: string;
  // When true, price.product is an UNEXPANDED string id (no metadata) and the inert
  // getStripe mock rejects prices.retrieve — so the price can NOT resolve to a planId.
  // Proves the resolver returns undefined (keep current) instead of falling back to
  // subscription.metadata.planId on a transient resolution failure.
  productAsString?: boolean;
}): Stripe.Subscription =>
  ({
    id: SUB_ID,
    status: 'active',
    customer: CUSTOMER_ID,
    cancel_at: null,
    cancel_at_period_end: false,
    items: {
      data: [
        {
          id: 'si_test_item',
          current_period_end: Math.floor(
            new Date('2026-07-20T12:00:00.000Z').getTime() / 1000
          ),
          price: {
            id: priceId,
            // string product (unexpanded, no metadata) -> forces prices.retrieve, which the
            // inert mock rejects -> unresolvable. Otherwise an expanded product carrying planId.
            product: productAsString
              ? 'prod_test_unexpanded'
              : { id: 'prod_test', metadata: { planId } },
          },
        },
      ],
    },
    pending_update: pending
      ? { subscription_items: [{ price: 'price_irrelevant' }] }
      : null,
    schedule: null,
    metadata: metadataPlanId != null ? { planId: metadataPlanId } : {},
  }) as unknown as Stripe.Subscription;

// Account snapshot currently on the OLD plan (PRO), active+paid, no cancellation.
const accountOnOldPlan = (): unknown => ({
  account_id: ACCOUNT_ID,
  created_by_user_id: 'usr_test_0000000000000001',
  pricing_plan: PricingPlanValue.PRO,
  account_status: AccountStatusValue.ACTIVE,
  subscription_id: SUB_ID,
  payment_status: PaymentStatusValue.PAID,
  subscription_status: SubscriptionStatusValue.ACTIVE,
  cancel_at_period_end: false,
  cancel_at: null,
  current_period_end: new Date('2026-07-20T12:00:00.000Z'),
});

describe('handleSubscriptionUpdated — price-first plan resolution (F1 PDH)', () => {
  beforeEach(() => {
    findAccount.mockClear();
    updatePlanStatus.mockClear();
    updateWithoutPlanChange.mockClear();
    accountHolder.value = accountOnOldPlan();
  });

  it('item on OLD price + pending_update present → keep current plan (updateAccountStatusWithoutPlanChange, NO plan change)', async () => {
    // pending_if_incomplete in flight: item still PRO (old), target held in pending.
    // Price-first reads PRO from the item → matches the DB plan → NOT divergent →
    // pending branch keeps the current plan.
    const subscription = subscriptionWith({
      priceId: 'price_pro_keep',
      planId: OLD_PLAN_ID,
      pending: true,
    });

    const result = await handleSubscriptionUpdated({
      subscription,
      eventCreatedAt: EVENT_AT,
    });

    expect(result.effects).toEqual([]);
    expect(updateWithoutPlanChange).toHaveBeenCalledTimes(1);
    const arg = updateWithoutPlanChange.mock.calls[0]?.[0];
    expect(arg?.account.account_id).toBe(ACCOUNT_ID);
    // The plan-CHANGING write must NOT fire while the change is pending payment.
    expect(updatePlanStatus).not.toHaveBeenCalled();
  });

  it('item on NEW price (pending applied) → sync new plan via updateAccountPlanStatus', async () => {
    // Stripe applied the pending update: item is now PRO+ (new). Price-first reads
    // PRO+ → diverges from DB PRO → sync path writes the new plan.
    const subscription = subscriptionWith({
      priceId: 'price_proplus_sync',
      planId: NEW_PLAN_ID,
      pending: false,
    });

    const result = await handleSubscriptionUpdated({
      subscription,
      eventCreatedAt: EVENT_AT,
    });

    expect(result.effects).toEqual([]);
    expect(updatePlanStatus).toHaveBeenCalledTimes(1);
    const arg = updatePlanStatus.mock.calls[0]?.[0];
    expect(arg?.accountId).toBe(ACCOUNT_ID);
    expect(arg?.pricingPlan).toBe(PricingPlanValue.PRO_PLUS);
    expect(arg?.stripeEventAt).toBe(EVENT_AT);
    // Keep-current write must NOT fire on a genuine divergent sync.
    expect(updateWithoutPlanChange).not.toHaveBeenCalled();
  });

  it('item reverted to OLD price + no pending (pending_update_expired) → keep OLD plan (no divergent write)', async () => {
    // Abandoned 3DS: Stripe expired the pending and reverted the item to PRO (old).
    // Price-first reads PRO → equals DB PRO, no pending, no schedule → reaches the
    // sync path but the no-op gate short-circuits (nothing changed) → neither write
    // diverges the plan. The account stays PRO — the whole point of F1.
    const subscription = subscriptionWith({
      priceId: 'price_pro_revert',
      planId: OLD_PLAN_ID,
      pending: false,
    });

    const result = await handleSubscriptionUpdated({
      subscription,
      eventCreatedAt: EVENT_AT,
    });

    expect(result.effects).toEqual([]);
    // No plan change away from PRO: the plan-changing write never runs, and the
    // keep-current write (pending/schedule branch) isn't reached either.
    expect(updatePlanStatus).not.toHaveBeenCalled();
    expect(updateWithoutPlanChange).not.toHaveBeenCalled();
    // …but the recency watermark IS advanced on the no-op so a newer no-op event
    // still fences an older out-of-order write (closes the SPAR-005 cancel/rescind
    // half-race — bumpStripeEventWatermark).
    expect(mocks.bumpWatermark).toHaveBeenCalledTimes(1);
    expect(mocks.bumpWatermark).toHaveBeenCalledWith(
      expect.objectContaining({ stripeEventAt: EVENT_AT })
    );
  });

  it('metadata.planId=NEW but item price=OLD + pending → keep OLD (PROVES price-first, not metadata-first)', async () => {
    // The critical price-vs-metadata discriminator. During pending_if_incomplete the
    // plan-change operation sets subscription.metadata.planId = TARGET (NEW) IMMEDIATELY,
    // while the item price stays OLD until the proration invoice is paid. Price-first reads
    // the ITEM (OLD) → equals DB plan → NOT divergent → pending branch keeps the current plan.
    // Under the OLD metadata-first resolver this would read NEW from subscription.metadata →
    // diverge → WRONGLY sync the plan BEFORE payment (an abandoned 3DS would flip the plan).
    // This test therefore FAILS on a metadata-first regression — it is the guard for F1's core.
    const subscription = subscriptionWith({
      priceId: 'price_pro_metadata_trap',
      planId: OLD_PLAN_ID, // item product.metadata → OLD (the price-first source)
      pending: true,
      metadataPlanId: NEW_PLAN_ID, // subscription.metadata says NEW (the metadata-first trap)
    });

    const result = await handleSubscriptionUpdated({
      subscription,
      eventCreatedAt: EVENT_AT,
    });

    expect(result.effects).toEqual([]);
    // Price-first kept the plan: keep-current write fired, plan-CHANGING write did NOT.
    expect(updateWithoutPlanChange).toHaveBeenCalledTimes(1);
    expect(updatePlanStatus).not.toHaveBeenCalled();
  });

  it('item price UNRESOLVABLE (product string, retrieve fails) + metadata.planId=NEW + pending → keep OLD (NO metadata fallback)', async () => {
    // CRITICAL guard (cross-model): when the item price cannot resolve to a planId (transient
    // prices.retrieve failure on an unexpanded product), extractPlanIdFromSubscription must return
    // undefined — it must NOT fall back to subscription.metadata.planId (=NEW during pending), which
    // would switch the DB plan BEFORE payment. The inert getStripe mock rejects prices.retrieve, so
    // the product never resolves and there is no price/product metadata; subscription.metadata says
    // NEW. Correct behaviour: recognizedPlanId=undefined → not divergent → the plan-CHANGING write
    // never runs (the OLD plan is kept). Under a metadata-fallback regression this would sync to NEW.
    const subscription = subscriptionWith({
      priceId: 'price_unresolvable',
      planId: OLD_PLAN_ID, // irrelevant: product is a string and retrieve fails
      pending: true,
      metadataPlanId: NEW_PLAN_ID, // the trap the resolver must NOT take
      productAsString: true,
    });

    await handleSubscriptionUpdated({
      subscription,
      eventCreatedAt: EVENT_AT,
    });

    // The plan-CHANGING write must NOT fire — no switch to NEW before payment.
    expect(updatePlanStatus).not.toHaveBeenCalled();
  });
});
