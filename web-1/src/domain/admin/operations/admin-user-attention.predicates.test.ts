/**
 * "Users that need a reaction" (S126): the admin menu counters and the users
 * list filter `attention` read ONE predicate each, with the kernel thresholds.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { ADMIN_ATTENTION } from '@kernel/domain/admin/admin-attention.config';
import { TIME } from '@kernel/application/constants.config';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import {
  buildPaymentsAttentionWhere,
  buildStuckAccountsWhere,
  buildUserAttentionWhere,
} from './admin-user-attention.predicates';
import { adminGetUsersPaginated_IO } from './admin-user-search.operations';

const NOW = new Date('2026-10-08T12:00:00.000Z');

describe('buildPaymentsAttentionWhere', () => {
  it('payment-problem statuses, or a trial ending within the kernel window', () => {
    expect(buildPaymentsAttentionWhere(NOW)).toEqual({
      stylist_account: {
        OR: [
          { subscription_status: { in: ['PAST_DUE', 'UNPAID', 'INCOMPLETE'] } },
          {
            subscription_status: 'TRIALING',
            trial_ends_at: {
              lte: new Date(
                NOW.getTime() +
                  ADMIN_ATTENTION.TRIAL_ENDING_WITHIN_DAYS * TIME.MS_PER_DAY
              ),
            },
          },
        ],
      },
    });
  });
});

describe('buildStuckAccountsWhere', () => {
  it('no role, active, not deleted, registered inside the kernel age window', () => {
    expect(buildStuckAccountsWhere(NOW)).toEqual({
      stylist_account: null,
      client_account: null,
      is_active: true,
      deleted_at: null,
      createdAt: {
        gte: new Date(
          NOW.getTime() - ADMIN_ATTENTION.STUCK_MAX_AGE_DAYS * TIME.MS_PER_DAY
        ),
        lte: new Date(
          NOW.getTime() - ADMIN_ATTENTION.STUCK_MIN_AGE_HOURS * TIME.MS_PER_HOUR
        ),
      },
    });
  });

  it('the window is not empty: the oldest bound is before the youngest', () => {
    const where = buildStuckAccountsWhere(NOW);
    const range = where.createdAt as { gte: Date; lte: Date };
    expect(range.gte.getTime()).toBeLessThan(range.lte.getTime());
  });
});

describe('buildUserAttentionWhere', () => {
  it('maps each filter value to its predicate', () => {
    expect(buildUserAttentionWhere('payments', NOW)).toEqual(
      buildPaymentsAttentionWhere(NOW)
    );
    expect(buildUserAttentionWhere('stuck', NOW)).toEqual(
      buildStuckAccountsWhere(NOW)
    );
  });
});

describe('adminGetUsersPaginated_IO with `attention`', () => {
  const adminCaller = makeStylistCurrentUser({
    user: {
      id: 'usr_admin_000000000000001',
      role_id: SystemRoleId.MASTER_ADMIN,
    },
  });

  const whereSentFor = async (
    params: Parameters<typeof adminGetUsersPaginated_IO>[0]['params']
  ) => {
    const findMany = vi.fn(async (_args: unknown) => []);
    mockDb({ user: { findMany } });
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const result = await adminGetUsersPaginated_IO({
        currentUser: adminCaller,
        params,
      });
      expect(result.success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    return (findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> })
      .where;
  };

  it('the list uses the very predicate the badge counts with', async () => {
    expect(await whereSentFor({ attention: 'payments' })).toEqual({
      AND: [buildPaymentsAttentionWhere(NOW)],
    });
    expect(await whereSentFor({ attention: 'stuck' })).toEqual({
      AND: [buildStuckAccountsWhere(NOW)],
    });
  });

  it('is AND-ed with the other filters instead of overwriting them', async () => {
    const where = await whereSentFor({
      attention: 'payments',
      pricing_plan: 'PRO',
      is_active: true,
    });
    expect(where).toEqual({
      AND: [buildPaymentsAttentionWhere(NOW)],
      is_active: true,
      stylist_account: { pricing_plan: 'PRO' },
    });
  });

  it('without the filter the where clause is untouched', async () => {
    expect(await whereSentFor({})).toEqual({});
  });
});
