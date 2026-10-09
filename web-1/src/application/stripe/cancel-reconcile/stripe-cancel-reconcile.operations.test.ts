/**
 * sweepPendingSubscriptionCancels — REACTIVATION GUARD (closing review-wave
 * 2026-07-16). Pins the money-path decision: a pending reconcile row must NOT
 * cancel the subscription of a user who self-reactivated (Model A recovery)
 * while the retry was pending — and MUST still cancel when the user remains
 * deleted (or the row is orphaned entirely).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockDb } from '../../../test-utils/mockApiHandler';
import { buildCancelReconcileEventId } from './stripe-cancel-reconcile.resolver';

const { cancelMock, reportMock, alertMock } = vi.hoisted(() => ({
  cancelMock: vi.fn(async (_subId: string) => ({})),
  reportMock: vi.fn((_arg: unknown) => undefined),
  alertMock: vi.fn((_arg: unknown) => undefined),
}));

vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({ subscriptions: { cancel: cancelMock } }),
}));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: reportMock,
}));
vi.mock('../webhooks/stripe-webhooks.utils', () => ({
  dispatchCriticalAlert: alertMock,
}));

import {
  enqueueSubscriptionCancelReconcileTx,
  sweepPendingSubscriptionCancels,
} from './stripe-cancel-reconcile.operations';

const SUB_ID = 'sub_e2e_reconcile_1';
const USER_ID = 'user_reconcile_1';
const EVENT_ID = buildCancelReconcileEventId({
  subscriptionId: SUB_ID,
  userId: USER_ID,
});

type UserProbe = { is_active: boolean; deleted_at: Date | null } | null;

const installDb = (userProbe: UserProbe, eventId: string = EVENT_ID) => {
  const stripeEventUpdate = vi.fn(async (_args: unknown) => ({}));
  const userFindUnique = vi.fn(async (_args: unknown) => userProbe);
  mockDb({
    stripeEvent: {
      findMany: async () => [
        // Due: retry_count 0 (backoff 1h) + last attempt 2h ago.
        {
          event_id: eventId,
          retry_count: 0,
          last_attempt_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      ],
      updateMany: async () => ({ count: 1 }),
      update: stripeEventUpdate,
    },
    user: {
      findUnique: userFindUnique,
    },
  });
  return { stripeEventUpdate, userFindUnique };
};

describe('sweepPendingSubscriptionCancels — reactivation guard', () => {
  beforeEach(() => {
    cancelMock.mockClear();
    reportMock.mockClear();
    alertMock.mockClear();
  });

  it('resolves WITHOUT cancelling when the user reactivated (is_active, deleted_at null)', async () => {
    const { stripeEventUpdate } = installDb({
      is_active: true,
      deleted_at: null,
    });

    const result = await sweepPendingSubscriptionCancels();

    expect(cancelMock).not.toHaveBeenCalled();
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    // Row marked processed so it never re-enters the sweep.
    expect(stripeEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { event_id: EVENT_ID },
        data: expect.objectContaining({ processed: true }),
      })
    );
  });

  it('still cancels when the user remains deleted', async () => {
    const { stripeEventUpdate } = installDb({
      is_active: false,
      deleted_at: new Date('2026-07-01T00:00:00Z'),
    });

    const result = await sweepPendingSubscriptionCancels();

    expect(cancelMock).toHaveBeenCalledWith(SUB_ID);
    expect(result.succeeded).toBe(1);
    expect(stripeEventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { event_id: EVENT_ID },
        data: expect.objectContaining({ processed: true }),
      })
    );
  });

  it('still cancels when the user row is gone entirely (hard-deleted orphan)', async () => {
    installDb(null);

    const result = await sweepPendingSubscriptionCancels();

    expect(cancelMock).toHaveBeenCalledWith(SUB_ID);
    expect(result.succeeded).toBe(1);
  });
});

describe('sweepPendingSubscriptionCancels — duplicate flavor bypasses the guard', () => {
  beforeEach(() => {
    cancelMock.mockClear();
    reportMock.mockClear();
    alertMock.mockClear();
  });

  it('cancels the OLD sub even when the user is a live active stylist (guard skipped)', async () => {
    const dupEventId = buildCancelReconcileEventId({
      subscriptionId: SUB_ID,
      userId: USER_ID,
      flavor: 'duplicate',
    });
    // Live paying stylist BY DESIGN — deletion flavor would resolve-without-cancel
    // here; duplicate flavor must cancel the OLD sub regardless.
    const { userFindUnique } = installDb(
      { is_active: true, deleted_at: null },
      dupEventId
    );

    const result = await sweepPendingSubscriptionCancels();

    // Guard is skipped entirely — the user's active state is never even probed.
    expect(userFindUnique).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledWith(SUB_ID);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
  });
});

describe('enqueueSubscriptionCancelReconcileTx — outbox inside the caller tx', () => {
  it('upserts a re-armed duplicate row on the GIVEN tx with backoff counted from now', async () => {
    const upsert = vi.fn(async (_args: unknown) => ({}));
    const tx = { stripeEvent: { upsert } } as never;
    const before = Date.now();
    await enqueueSubscriptionCancelReconcileTx(tx, {
      subscriptionId: SUB_ID,
      userId: USER_ID,
      reason: 'pending',
      flavor: 'duplicate',
    });
    const args = upsert.mock.calls[0]?.[0] as {
      where: { event_id: string };
      create: { last_attempt_at: Date };
      update: { processed: boolean; retry_count: number };
    };
    expect(args.where.event_id).toBe(
      buildCancelReconcileEventId({
        subscriptionId: SUB_ID,
        userId: USER_ID,
        flavor: 'duplicate',
      })
    );
    expect(args.create.last_attempt_at.getTime()).toBeGreaterThanOrEqual(
      before
    );
    expect(args.update).toMatchObject({ processed: false, retry_count: 0 });
  });

  it('propagates a write failure so the webhook tx rolls back instead of committing without the row', async () => {
    const tx = {
      stripeEvent: {
        upsert: vi.fn(async () => {
          throw new Error('db down');
        }),
      },
    } as never;
    await expect(
      enqueueSubscriptionCancelReconcileTx(tx, {
        subscriptionId: SUB_ID,
        userId: USER_ID,
        reason: 'pending',
        flavor: 'duplicate',
      })
    ).rejects.toThrow('db down');
  });
});
