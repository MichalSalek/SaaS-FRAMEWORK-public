import { describe, expect, it, vi } from 'vitest';
const { entryDelete, deliveryDelete, operationalDelete, messageUpdate } =
  vi.hoisted(() => ({
    entryDelete: vi.fn(async () => ({ count: 2 })),
    deliveryDelete: vi.fn(async () => ({ count: 3 })),
    operationalDelete: vi.fn(async () => ({ count: 4 })),
    messageUpdate: vi.fn(async (_args: { data: Record<string, unknown> }) => ({
      count: 5,
    })),
  }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      $transaction: async (run: (tx: unknown) => Promise<unknown>) =>
        run({
          emailLifecycleAction: { deleteMany: async () => ({ count: 0 }) },
          emailLifecycleEntry: { deleteMany: entryDelete },
          emailDeliveryEvent: { deleteMany: deliveryDelete },
          emailLifecycleOperationalEvent: { deleteMany: operationalDelete },
          emailLifecycleMessage: { updateMany: messageUpdate },
        }),
    },
  },
}));
import { retainLifecycleDetails } from './retention';

describe('lifecycle retention', () => {
  it('expires details at 90d while preserving permanent identities and enrollment/suppression markers', async () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(await retainLifecycleDetails(now)).toEqual({
      entries: 2,
      deliveries: 3,
      operations: 4,
      messages: 5,
    });
    expect(entryDelete).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date(now.getTime() - 90 * 86400000) } },
    });
    expect(messageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ctaIds: [],
          providerMessageId: null,
          reason: null,
        }),
      })
    );
    const data: Record<string, unknown> =
      messageUpdate.mock.calls[0]?.[0]?.data ?? {};
    for (const permanent of [
      'id',
      'accountId',
      'userId',
      'occurrence',
      'ruleId',
      'status',
    ]) {
      expect(data).not.toHaveProperty(permanent);
    }
  });
});
