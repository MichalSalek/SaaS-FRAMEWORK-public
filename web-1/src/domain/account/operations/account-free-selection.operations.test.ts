/**
 * SPE free-plan selection unit tests — selectFreePlan_IO.
 *
 * Drives DB_CLIENT.use through the global setup proxy (mockDb), calling the op
 * DIRECTLY. ZERO Stripe surface here — the whole point of FREE-select is no
 * customer/session/card. We assert exactly that (no Stripe import is even reachable),
 * the DB write payload (pricing_plan=FREE, payment_status=UNPAID, plan_selected_at),
 * idempotency, the active-paid-subscription conflict branch, AND the CAS race-classify
 * (finding ioA-2): the write is an updateMany with a "no active paid sub" guard, so a
 * concurrent Stripe webhook that activates a paid sub between the read and the write
 * matches 0 rows -> conflict (never a silent downgrade of the just-activated plan).
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { selectFreePlan_IO } from './account-free-selection.operations';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';

const USER_ID = 'usr_test_0000000000000001';
const ACCOUNT_ID = 'acc_test_0000000000000001';

describe('selectFreePlan_IO — SPE FREE plan selection (zero Stripe)', () => {
  it('no subscription → sets pricing_plan=FREE + payment_status=UNPAID + plan_selected_at', async () => {
    const updateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    const findUnique = vi.fn(async () => ({
      stylist_account: {
        account_id: ACCOUNT_ID,
        subscription_id: null,
        subscription_status: null,
      },
    }));
    mockDb({
      user: { findUnique },
      stylistAccount: { updateMany },
    });

    const result = await selectFreePlan_IO({ userId: USER_ID });

    expect(result.success).toBe(true);

    // Two-step $transaction (payment-invariant, S64): (1) primary CAS write, then —
    // because primaryCount > 0 — (2) a scoped account_status reactivation updateMany.
    // calls[0] is the primary CAS write asserted below.
    expect(updateMany).toHaveBeenCalledTimes(2);
    const call = updateMany.mock.calls[0]?.[0] as unknown as {
      where: { account_id: string };
      data: {
        pricing_plan: string;
        payment_status: string;
        plan_selected_at: Date;
      };
    };
    expect(call.where.account_id).toBe(ACCOUNT_ID);
    expect(call.data.pricing_plan).toBe(PricingPlanValue.FREE);
    expect(call.data.payment_status).toBe(PaymentStatusValue.UNPAID);
    expect(call.data.plan_selected_at).toBeInstanceOf(Date);
    // NEVER touches trial_started_at (preserves trial-usage history) NOR last_stripe_event_at
    // (Free is not a Stripe event — the subscription-writer recency guard is a separate concern).
    expect(call.data).not.toHaveProperty('trial_started_at');
    expect(call.data).not.toHaveProperty('last_stripe_event_at');
  });

  it('is idempotent — a canceled subscription still selects FREE (no conflict)', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mockDb({
      user: {
        findUnique: async () => ({
          stylist_account: {
            account_id: ACCOUNT_ID,
            // CANCELED is NOT an active-paid status → free-select allowed again.
            subscription_id: 'sub_canceled',
            subscription_status: SubscriptionStatusValue.CANCELED,
          },
        }),
      },
      stylistAccount: { updateMany },
    });

    const result = await selectFreePlan_IO({ userId: USER_ID });

    expect(result.success).toBe(true);
    // Two-step $transaction (payment-invariant, S64): primary CAS write (count > 0)
    // followed by the scoped account_status reactivation updateMany.
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it('active paid subscription (ACTIVE) → CHECKOUT_FREE_PLAN_CONFLICT, no write', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mockDb({
      user: {
        findUnique: async () => ({
          stylist_account: {
            account_id: ACCOUNT_ID,
            subscription_id: 'sub_active',
            subscription_status: SubscriptionStatusValue.ACTIVE,
          },
        }),
      },
      stylistAccount: { updateMany },
    });

    const result = await selectFreePlan_IO({ userId: USER_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CHECKOUT_FREE_PLAN_CONFLICT');
    }
    // Conflict must NOT downgrade — the early check returns before the CAS write runs.
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('active paid subscription (TRIALING) → CHECKOUT_FREE_PLAN_CONFLICT', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    mockDb({
      user: {
        findUnique: async () => ({
          stylist_account: {
            account_id: ACCOUNT_ID,
            subscription_id: 'sub_trialing',
            subscription_status: SubscriptionStatusValue.TRIALING,
          },
        }),
      },
      stylistAccount: { updateMany },
    });

    const result = await selectFreePlan_IO({ userId: USER_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CHECKOUT_FREE_PLAN_CONFLICT');
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('CAS race — webhook activated a paid sub between read and write → CHECKOUT_FREE_PLAN_CONFLICT (count=0)', async () => {
    // Initial read sees no active sub (free-select allowed), but a concurrent Stripe webhook wins
    // before the write: the CAS guard ("no active paid sub") matches 0 rows. Reclassify re-fetches,
    // account exists → conflict (NOT a silent downgrade of the just-activated paid plan). This is the
    // race the unconditional update used to lose (finding ioA-2).
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const accountFindUnique = vi.fn(async () => ({ account_id: ACCOUNT_ID }));
    mockDb({
      user: {
        findUnique: async () => ({
          stylist_account: {
            account_id: ACCOUNT_ID,
            subscription_id: null,
            subscription_status: null,
          },
        }),
      },
      stylistAccount: { updateMany, findUnique: accountFindUnique },
    });

    const result = await selectFreePlan_IO({ userId: USER_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CHECKOUT_FREE_PLAN_CONFLICT');
    }
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(accountFindUnique).toHaveBeenCalledTimes(1);
  });

  it('CAS race — account vanished between read and write → ACCOUNT_NOT_FOUND (count=0)', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const accountFindUnique = vi.fn(async () => null);
    mockDb({
      user: {
        findUnique: async () => ({
          stylist_account: {
            account_id: ACCOUNT_ID,
            subscription_id: null,
            subscription_status: null,
          },
        }),
      },
      stylistAccount: { updateMany, findUnique: accountFindUnique },
    });

    const result = await selectFreePlan_IO({ userId: USER_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ACCOUNT_NOT_FOUND');
    }
  });

  it('no stylist_account → ACCOUNT_NOT_FOUND', async () => {
    mockDb({
      user: { findUnique: async () => ({ stylist_account: null }) },
    });

    const result = await selectFreePlan_IO({ userId: USER_ID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ACCOUNT_NOT_FOUND');
    }
  });
});
