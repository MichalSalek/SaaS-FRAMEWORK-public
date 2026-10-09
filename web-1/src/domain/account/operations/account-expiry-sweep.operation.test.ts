/**
 * sweepExpiringAndExpiredAccounts_IO unit tests — updateMany argument capture.
 *
 * Locks in the DECISION in the operation: the EXPIRING branch MUST filter on
 * `cancel_at_period_end: true` + `subscription_status: ACTIVE`. Without the
 * cancel filter every healthy auto-renewing subscription matched during the
 * last 7 days of each billing period — and public visibility is
 * strictly-ACTIVE, so a PAYING stylist vanished from the directory for ~23%
 * of the account's life. These tests snapshot the where-clause shape so that
 * regression cannot come back silently.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AccountStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { mockDb } from '../../../test-utils/mockApiHandler';

const { reportIssueBackend } = vi.hoisted(() => ({
  reportIssueBackend: vi.fn(),
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend }));

import { sweepExpiringAndExpiredAccounts_IO } from './account-expiry-sweep.operation';

type UpdateManyArg = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

const arrangeSweep = (expiringCount: number, expiredCount: number) => {
  const updateMany = vi.fn(async (_arg: UpdateManyArg) => ({ count: 0 }));
  updateMany
    .mockResolvedValueOnce({ count: expiringCount })
    .mockResolvedValueOnce({ count: expiredCount });
  mockDb({ stylistAccount: { updateMany } });
  return updateMany;
};

describe('sweepExpiringAndExpiredAccounts_IO — updateMany argument shape', () => {
  it('EXPIRING branch filters on cancel_at_period_end:true + subscription_status:ACTIVE (paying stylists stay in the directory)', async () => {
    const updateMany = arrangeSweep(0, 0);

    await sweepExpiringAndExpiredAccounts_IO();

    expect(updateMany).toHaveBeenCalledTimes(2);
    const expiringArg = updateMany.mock.calls[0]?.[0];
    expect(expiringArg?.data).toEqual({
      account_status: AccountStatusValue.EXPIRING,
    });
    // The regression guard: a healthy auto-renewing sub (cancel_at_period_end
    // false) must NEVER match this branch.
    expect(expiringArg?.where.cancel_at_period_end).toBe(true);
    expect(expiringArg?.where.subscription_status).toBe(
      SubscriptionStatusValue.ACTIVE
    );
    // Window: current_period_end within the next 7 days (bounded both sides).
    expect(expiringArg?.where.current_period_end).toEqual({
      gte: expect.any(Date),
      lte: expect.any(Date),
    });
    // Idempotency: already-transitioned / deactivated rows excluded.
    expect(expiringArg?.where.account_status).toEqual({
      notIn: expect.arrayContaining([
        AccountStatusValue.EXPIRING,
        AccountStatusValue.EXPIRED,
        AccountStatusValue.NOT_ACTIVE,
      ]),
    });
  });

  it('EXPIRED branch: subscription_status:CANCELED, period already passed, NO cancel_at_period_end filter', async () => {
    const updateMany = arrangeSweep(0, 0);

    await sweepExpiringAndExpiredAccounts_IO();

    const expiredArg = updateMany.mock.calls[1]?.[0];
    expect(expiredArg?.data).toEqual({
      account_status: AccountStatusValue.EXPIRED,
    });
    expect(expiredArg?.where.subscription_status).toBe(
      SubscriptionStatusValue.CANCELED
    );
    // Canceled subs expire regardless of how the cancellation was scheduled.
    expect(expiredArg?.where).not.toHaveProperty('cancel_at_period_end');
    expect(expiredArg?.where.current_period_end).toEqual({
      lt: expect.any(Date),
    });
    expect(expiredArg?.where.account_status).toEqual({
      notIn: expect.arrayContaining([
        AccountStatusValue.NOT_ACTIVE,
        AccountStatusValue.EXPIRED,
      ]),
    });
  });

  it('returns the per-branch counters from updateMany count', async () => {
    arrangeSweep(3, 2);

    const result = await sweepExpiringAndExpiredAccounts_IO();

    expect(result).toEqual({ expiring: 3, expired: 2 });
  });

  it('zero transitions → returns zero counters and stays silent (no report)', async () => {
    arrangeSweep(0, 0);

    const result = await sweepExpiringAndExpiredAccounts_IO();

    expect(result).toEqual({ expiring: 0, expired: 0 });
    expect(reportIssueBackend).not.toHaveBeenCalled();
  });
});
