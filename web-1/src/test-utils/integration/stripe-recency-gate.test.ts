/**
 * Out-of-order Stripe webhook guard — updateAccountPlanStatus recency gate.
 *
 * The plan-write SSOT (application/stripe/plan-status-update.operations.ts) gates
 * webhook writes on `stripeEventAt` (event.created). When set, it writes via a
 * conditional `stylistAccount.updateMany` whose WHERE requires
 * `last_stripe_event_at IS NULL OR <= stripeEventAt` and sets `last_stripe_event_at`.
 * If a NEWER event already landed, the updateMany matches 0 rows and the write +
 * audit are skipped — so a delayed/retried stale `subscription.updated` cannot
 * resurrect a canceled subscription to PAID after `subscription.deleted` reset it.
 *
 * Non-webhook callers (login-sync / dunning) pass no `stripeEventAt` and take the
 * unconditional `update` path (authoritative reconciliation). We call the SSOT
 * function DIRECTLY with a local mock-tx whose stylistAccount/eventLog methods are
 * spies — application logic, not a route.
 */

import { describe, it, expect, vi } from 'vitest';
import { updateAccountPlanStatus } from '@app/stripe/plan-status-update.operations';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  PaymentStatusValue,
  AccountStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import type { Prisma } from '../../prisma/js-client';

const ACCOUNT_ID = 'acc_test_0000000000000001';
const NEWER = new Date('2026-06-16T12:00:00.000Z');
const OLDER = new Date('2026-06-16T10:00:00.000Z');

// Base params reset an account to FREE. oldPricingPlan is set PER-TEST: only the
// stale test exercises a PRO→FREE change (so we can assert the audit is gated on
// the write applying); the apply/authoritative tests omit it to keep the assertions
// focused on the recency gate itself (the audit write is pinned elsewhere).
const baseParams = {
  accountId: ACCOUNT_ID,
  pricingPlan: PricingPlanValue.FREE,
  paymentStatus: PaymentStatusValue.UNPAID,
  accountStatus: AccountStatusValue.ACTIVE,
  subscriptionStatus: SubscriptionStatusValue.CANCELED,
  subscriptionId: null,
  cancelAtPeriodEnd: false,
  cancelAt: null,
  currentPeriodEnd: null,
  source: 'stripe' as const,
  createdByUserId: 'usr_test_0000000000000001',
};

type Spies = {
  updateMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eventLogCreate: ReturnType<typeof vi.fn>;
  tx: Prisma.TransactionClient;
};

const makeMockTx = (updateManyCount: number): Spies => {
  const updateMany = vi.fn(async () => ({ count: updateManyCount }));
  const update = vi.fn(async () => ({}));
  const eventLogCreate = vi.fn(async () => ({}));
  const tx = {
    stylistAccount: { updateMany, update },
    eventLog: { create: eventLogCreate },
  };
  return {
    updateMany,
    update,
    eventLogCreate,
    tx: tx as unknown as Prisma.TransactionClient,
  };
};

describe('updateAccountPlanStatus — out-of-order recency gate', () => {
  it('stale event (count=0): skips the plan write AND the audit, uses updateMany not update', async () => {
    const s = makeMockTx(0);

    const applied = await updateAccountPlanStatus({
      ...baseParams,
      oldPricingPlan: PricingPlanValue.PRO, // PRO→FREE: audit WOULD fire if applied
      stripeEventAt: OLDER,
      tx: s.tx,
    });

    // Stale skip ⇒ false so callers gate out post-commit "state changed" effects.
    expect(applied).toBe(false);

    // Webhook path → conditional updateMany, never the unconditional update.
    expect(s.updateMany).toHaveBeenCalledTimes(1);
    expect(s.update).not.toHaveBeenCalled();

    // Recency predicate present + last_stripe_event_at written.
    const call = s.updateMany.mock.calls[0]?.[0];
    expect(call?.where?.account_id).toBe(ACCOUNT_ID);
    expect(call?.where?.OR).toEqual([
      { last_stripe_event_at: null },
      { last_stripe_event_at: { lte: OLDER } },
    ]);
    expect(call?.data?.last_stripe_event_at).toBe(OLDER);

    // count=0 ⇒ a newer event already applied ⇒ audit MUST be skipped.
    expect(s.eventLogCreate).not.toHaveBeenCalled();
  });

  it('fresh event (count=1): applies the write AND the audit', async () => {
    const s = makeMockTx(1);

    const applied = await updateAccountPlanStatus({
      ...baseParams,
      stripeEventAt: NEWER,
      tx: s.tx,
    });

    // Fresh write applied ⇒ true so callers proceed with post-commit effects.
    expect(applied).toBe(true);
    expect(s.updateMany).toHaveBeenCalledTimes(1);
    expect(s.update).not.toHaveBeenCalled();
    expect(s.updateMany.mock.calls[0]?.[0]?.data?.last_stripe_event_at).toBe(
      NEWER
    );
  });

  it('no stripeEventAt (login-sync / dunning): authoritative unconditional update, no recency gate', async () => {
    const s = makeMockTx(1);

    await updateAccountPlanStatus({
      ...baseParams,
      source: 'sync',
      tx: s.tx,
    });

    // Authoritative path → unconditional update, never the gated updateMany.
    expect(s.update).toHaveBeenCalledTimes(1);
    expect(s.updateMany).not.toHaveBeenCalled();
    // No last_stripe_event_at in the unconditional write payload.
    const call = s.update.mock.calls[0]?.[0];
    expect(call?.data?.last_stripe_event_at).toBeUndefined();
  });
});
