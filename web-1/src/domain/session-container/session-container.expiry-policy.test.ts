import { afterEach, describe, expect, it, vi } from 'vitest';
import { TIME } from '@kernel/application/constants.config';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import type { Prisma } from '../../prisma/js-client';

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(async (_query: unknown) => 0),
  updateMany: vi.fn(async (_args: unknown) => ({ count: 0 })),
  report: vi.fn(),
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      $executeRaw: mocks.executeRaw,
      sessionContainer: { updateMany: mocks.updateMany },
    },
  },
}));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: mocks.report,
}));

import { expireStaleSessionContainers } from './session-container.expire-sweep';

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('expiry sweep', () => {
  it('extends live rows before expiry with the same fence and configured duration', async () => {
    const now = new Date('2026-11-06T12:34:56.789Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await expireStaleSessionContainers({ rethrow: true });

    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    const sql = mocks.executeRaw.mock.calls[0]?.[0] as Prisma.Sql;
    const duration =
      SESSION_CONTAINER_CONFIG.SESSION_EXPIRY_DAYS * TIME.MS_PER_DAY;
    expect(sql.values).toContain(duration);
    expect(sql.values).toContainEqual(now);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        lifecycle_state: {
          in: [
            SessionContainerLifecycleStateValue.SHARED,
            SessionContainerLifecycleStateValue.ACTIVE,
          ],
        },
        expires_at: { lt: now },
        closed_at: null,
      },
      data: { lifecycle_state: SessionContainerLifecycleStateValue.EXPIRED },
    });
    const extensionOrder = mocks.executeRaw.mock.invocationCallOrder[0];
    const expiryOrder = mocks.updateMany.mock.invocationCallOrder[0];
    if (extensionOrder === undefined || expiryOrder === undefined) {
      throw new Error('Both sweep phases must run');
    }
    expect(extensionOrder).toBeLessThan(expiryOrder);
  });

  it('reports extension failure and does not proceed to expiry', async () => {
    const failure = new Error('extension failed');
    mocks.executeRaw.mockRejectedValueOnce(failure);
    await expect(expireStaleSessionContainers({ rethrow: true })).rejects.toBe(
      failure
    );
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.report).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'error' })
    );
  });
});
