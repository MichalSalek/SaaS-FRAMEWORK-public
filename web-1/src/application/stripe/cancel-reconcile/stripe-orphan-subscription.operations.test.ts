/**
 * scanOrphanedSubscriptions — IO seam of SPAR Option A with Stripe mocked.
 * Pins: read-only towards Stripe (list only, never cancel), scope filter, bounded
 * pagination, and create-or-re-arm semantics that never reset a pending row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockDb } from '../../../test-utils/mockApiHandler';
import { buildCancelReconcileEventId } from './stripe-cancel-reconcile.resolver';
import {
  ORPHAN_SCAN_MAX_PAGES,
  ORPHAN_SCAN_MIN_AGE_MS,
} from './stripe-orphan-subscription.resolver';

type FakeSub = {
  id: string;
  status: string;
  created: number;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  customer: string;
  metadata: Record<string, string>;
};

const { listMock, cancelMock, planIdMock, reportMock } = vi.hoisted(() => ({
  listMock: vi.fn(
    async (
      _params: unknown
    ): Promise<{ data: FakeSub[]; has_more: boolean }> => ({
      data: [],
      has_more: false,
    })
  ),
  cancelMock: vi.fn(async (_id: string) => ({})),
  planIdMock: vi.fn(
    async (_sub: unknown): Promise<string | undefined> => 'app-price-1'
  ),
  reportMock: vi.fn((_arg: unknown) => undefined),
}));

vi.mock('../adapters/stripe.adapter', () => ({
  getStripe: () => ({
    subscriptions: { list: listMock, cancel: cancelMock },
  }),
}));
vi.mock('../webhooks/stripe-webhooks.utils', () => ({
  extractPlanIdFromSubscription: planIdMock,
}));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: reportMock,
}));

import { scanOrphanedSubscriptions } from './stripe-orphan-subscription.operations';

const OLD = Math.floor((Date.now() - ORPHAN_SCAN_MIN_AGE_MS) / 1000) - 3600;

const fakeSub = (overrides: Partial<FakeSub> = {}): FakeSub => ({
  id: 'sub_orphan',
  status: 'active',
  created: OLD,
  cancel_at_period_end: false,
  cancel_at: null,
  customer: 'cus_1',
  metadata: { projectId: 'nailfolio', accountId: 'acc_1' },
  ...overrides,
});

const deletedOwnerRow = {
  account_id: 'acc_1',
  subscription_id: 'sub_orphan',
  stripe_customer_id: 'cus_1',
  pricing_plan: 'PRO',
  payment_status: 'PAID',
  admin_plan_override: false,
  created_by_user: {
    id: 'usr_1',
    is_active: false,
    deleted_at: new Date('2026-10-01T00:00:00Z'),
  },
};

const installDb = ({
  accounts = [deletedOwnerRow] as unknown[],
  existingRows = [] as unknown[],
} = {}) => {
  const createMany = vi.fn(async (args: { data: unknown[] }) => ({
    count: args.data.length,
  }));
  const updateMany = vi.fn(async (_args: unknown) => ({ count: 1 }));
  const accountFindMany = vi.fn(async (_args: unknown) => accounts);
  mockDb({
    stylistAccount: { findMany: accountFindMany },
    stripeEvent: {
      findMany: async () => existingRows,
      createMany,
      updateMany,
    },
  });
  return { createMany, updateMany, accountFindMany };
};

const DELETION_EVENT_ID = buildCancelReconcileEventId({
  subscriptionId: 'sub_orphan',
  userId: 'usr_1',
  flavor: 'deletion',
});

describe('scanOrphanedSubscriptions', () => {
  beforeEach(() => {
    listMock.mockReset();
    listMock.mockResolvedValue({ data: [fakeSub()], has_more: false });
    cancelMock.mockClear();
    planIdMock.mockReset();
    planIdMock.mockResolvedValue('app-price-1');
    reportMock.mockClear();
  });

  it('queues a deletion-flavor row for a soft-deleted owner and never cancels itself', async () => {
    const { createMany } = installDb();

    const result = await scanOrphanedSubscriptions();

    expect(cancelMock).not.toHaveBeenCalled();
    expect(result.enqueued).toBe(1);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          event_id: DELETION_EVENT_ID,
          event_type: 'internal.subscription_cancel_reconcile',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('skips subscriptions outside the Nailfolio scope (foreign plan id or foreign project stamp)', async () => {
    listMock.mockResolvedValue({
      data: [
        fakeSub({ id: 'sub_foreign_plan' }),
        fakeSub({
          id: 'sub_foreign_stamp',
          metadata: { projectId: 'other-project' },
        }),
      ],
      has_more: false,
    });
    planIdMock.mockResolvedValueOnce('other-project-plan');
    const { createMany } = installDb();

    const result = await scanOrphanedSubscriptions();

    expect(result.foreign).toBe(2);
    expect(result.live).toBe(0);
    // The project stamp short-circuits before any price lookup.
    expect(planIdMock).toHaveBeenCalledTimes(1);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('ignores statuses that no longer charge', async () => {
    listMock.mockResolvedValue({
      data: [fakeSub({ status: 'incomplete_expired' })],
      has_more: false,
    });
    installDb();

    const result = await scanOrphanedSubscriptions();

    expect(result.live).toBe(0);
    expect(planIdMock).not.toHaveBeenCalled();
  });

  it('keeps a subscription a live account is paying on', async () => {
    const { createMany } = installDb({
      accounts: [
        {
          ...deletedOwnerRow,
          created_by_user: { id: 'usr_1', is_active: true, deleted_at: null },
        },
      ],
    });

    const result = await scanOrphanedSubscriptions();

    expect(result.owned).toBe(1);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('leaves a pending row alone (no retry-budget reset) and a dead-lettered row dead', async () => {
    listMock.mockResolvedValue({ data: [fakeSub()], has_more: false });
    const { createMany, updateMany } = installDb({
      existingRows: [
        { event_id: DELETION_EVENT_ID, processed: false, dead_lettered: false },
      ],
    });

    const pending = await scanOrphanedSubscriptions();
    expect(pending.alreadyPending).toBe(1);
    expect(createMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();

    const dead = installDb({
      existingRows: [
        { event_id: DELETION_EVENT_ID, processed: false, dead_lettered: true },
      ],
    });
    const deadResult = await scanOrphanedSubscriptions();
    expect(deadResult.deadLettered).toBe(1);
    expect(dead.updateMany).not.toHaveBeenCalled();
  });

  it('re-arms a processed row (still live after the row was closed = fresh evidence)', async () => {
    const { updateMany, createMany } = installDb({
      existingRows: [
        { event_id: DELETION_EVENT_ID, processed: true, dead_lettered: false },
      ],
    });

    const result = await scanOrphanedSubscriptions();

    expect(result.rearmed).toBe(1);
    expect(createMany).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          event_id: DELETION_EVENT_ID,
          processed: true,
          dead_lettered: false,
        },
        data: expect.objectContaining({ processed: false, retry_count: 0 }),
      })
    );
  });

  it('paginates with starting_after and stops at the page cap, reporting it', async () => {
    let page = 0;
    listMock.mockImplementation(async () => {
      page += 1;
      return {
        data: [fakeSub({ id: `sub_p${page}`, status: 'canceled' })],
        has_more: true,
      };
    });
    installDb({ accounts: [] });

    const result = await scanOrphanedSubscriptions();

    expect(listMock).toHaveBeenCalledTimes(ORPHAN_SCAN_MAX_PAGES);
    expect(listMock).toHaveBeenNthCalledWith(2, {
      limit: 100,
      starting_after: 'sub_p1',
    });
    expect(result.capped).toBe(true);
  });

  it('reports a subscription no account knows instead of queueing it', async () => {
    const { createMany } = installDb({ accounts: [] });

    const result = await scanOrphanedSubscriptions();

    expect(result.reports).toEqual([
      { subscriptionId: 'sub_orphan', reason: 'unknown_owner' },
    ]);
    expect(createMany).not.toHaveBeenCalled();
  });
});
