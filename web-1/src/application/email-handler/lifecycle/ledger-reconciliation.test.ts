import { beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  create: vi.fn(),
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      emailLifecycleMessage: { findMany: io.findMany },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          emailLifecycleMessage: {
            updateMany: io.updateMany,
            findUniqueOrThrow: io.findUniqueOrThrow,
          },
          emailLifecycleOperationalEvent: { create: io.create },
        }),
    },
  },
}));
import { reconcileStaleLifecycleMessages_IO } from './ledger-reconciliation';
const now = new Date('2026-10-20T12:00:00Z');
describe('stale lifecycle attempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    io.findUniqueOrThrow.mockResolvedValue({
      id: 'message-1',
      family: 'free',
      templateId: 'free-first-photo',
      ruleId: 'photo',
      locale: 'pl',
      cohort: 'new',
      provider: 'resend',
    });
    io.updateMany.mockResolvedValue({ count: 1 });
  });
  it('holds an interrupted provider attempt as unknown with an atomic outbox marker', async () => {
    io.findMany.mockResolvedValue([{ id: 'message-1', status: 'sending' }]);
    expect(await reconcileStaleLifecycleMessages_IO(now)).toEqual({
      unknown: 1,
      suppressed: 0,
    });
    expect(io.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          // Outbox rows belong to the email-outbox job: a pending intent is not an expired
          // reservation.
          outbox: false,
          OR: [
            {
              status: 'reserved',
              createdAt: { lte: new Date(now.getTime() - 1200000) },
            },
            {
              status: 'sending',
              startedAt: { lte: new Date(now.getTime() - 1200000) },
            },
            {
              status: 'sending',
              startedAt: null,
              createdAt: { lte: new Date(now.getTime() - 1200000) },
            },
          ],
        },
      })
    );
    expect(io.updateMany).toHaveBeenCalledWith({
      where: { id: 'message-1', status: 'sending', outbox: false },
      data: { status: 'unknown', reason: 'send_interrupted' },
    });
    expect(io.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: 'send_result',
          state: 'unknown',
          reason: 'send_interrupted',
          occurredAt: now,
        }),
      })
    );
  });
  it('closes an unstarted stale reservation without invoking a transport', async () => {
    io.findMany.mockResolvedValue([{ id: 'message-1', status: 'reserved' }]);
    expect(await reconcileStaleLifecycleMessages_IO(now)).toEqual({
      unknown: 0,
      suppressed: 1,
    });
    expect(io.updateMany).toHaveBeenCalledWith({
      where: { id: 'message-1', status: 'reserved', outbox: false },
      data: { status: 'suppressed', reason: 'reservation_expired' },
    });
  });
  it('leaves a row accepted by a concurrent callback untouched', async () => {
    io.findMany.mockResolvedValue([{ id: 'message-1', status: 'sending' }]);
    io.updateMany.mockResolvedValue({ count: 0 });
    expect(await reconcileStaleLifecycleMessages_IO(now)).toEqual({
      unknown: 0,
      suppressed: 0,
    });
    expect(io.create).not.toHaveBeenCalled();
  });
});
