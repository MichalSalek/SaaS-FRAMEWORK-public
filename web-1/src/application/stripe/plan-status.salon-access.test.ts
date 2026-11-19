import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../prisma/js-client';
const { close } = vi.hoisted(() => ({ close: vi.fn(async () => undefined) }));
vi.mock('@app/email-handler/lifecycle/access-grants', () => ({
  finishFreeForSalonAccess_IO: close,
}));
import { updateAccountPlanStatus } from './plan-status-update.operations';
const base = {
  accountId: 'salon',
  pricingPlan: 'STUDIO',
  paymentStatus: 'PAID',
  accountStatus: 'ACTIVE',
  subscriptionStatus: 'ACTIVE',
  subscriptionId: 'sub',
  cancelAtPeriodEnd: false,
  cancelAt: null,
  currentPeriodEnd: null,
} as const;
function client(count = 1) {
  return {
    stylistAccount: {
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count })),
    },
  } as unknown as Prisma.TransactionClient;
}
describe('Stripe salon access grant completes Free tips in the same transaction', () => {
  beforeEach(() => vi.clearAllMocks());
  it('passes the existing transaction to completion after a paid Studio grant', async () => {
    const tx = client();
    expect(await updateAccountPlanStatus({ ...base, tx })).toBe(true);
    expect(close).toHaveBeenCalledWith(tx, 'salon');
  });
  it('does not complete on a stale event whose plan mutation was skipped', async () => {
    expect(
      await updateAccountPlanStatus({
        ...base,
        tx: client(0),
        stripeEventAt: new Date(),
      })
    ).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
  it.each([
    { ...base, pricingPlan: 'PRO' as const },
    { ...base, subscriptionStatus: 'TRIALING' as const },
    { ...base, accountStatus: 'EXPIRED' as const },
  ])('does not grant from non-entitling state %j', async params => {
    await updateAccountPlanStatus({ ...params, tx: client() });
    expect(close).not.toHaveBeenCalled();
  });
});
