/**
 * Admin handlers bound through `defineEndpoint(ADMIN_CONTRACTS.KEY)`.
 *
 * Pins what must not change: a create-color body without a name is 400 and never
 * reaches the operation, and a log-list GET drops an unknown environment and
 * falls back when `take` is not a number.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import createColor from '../../pages/api/v1/admin/create-color/index';
import getLogs from '../../pages/api/v1/admin/get-logs/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeClientCurrentUser } from '../fixtures';

const ops = vi.hoisted(() => ({
  createColor: vi.fn(),
  getLogs: vi.fn(),
}));

vi.mock('@domain/admin/operations/admin-colors.operations', () => ({
  createColor_IO: ops.createColor,
  updateColor_IO: vi.fn(),
  deleteColor_IO: vi.fn(),
}));

vi.mock('@domain/admin/operations/admin-logs.operations', () => ({
  adminGetLogs_IO: ops.getLogs,
  adminSendLog_IO: vi.fn(),
}));

describe('admin through the API contract', () => {
  beforeEach(() => {
    ops.createColor.mockReset();
    ops.getLogs.mockReset();
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
    __setPermission(true);
  });

  it('create-color: a body without a name is 400 and never reaches the operation', async () => {
    const { status, event, data } = await mockApiHandler<{ name?: string }>(
      createColor,
      {
        method: 'POST',
        body: { hex_code: '#112233' },
      }
    );
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(data.name).toContain('validation.');
    expect(ops.createColor).not.toHaveBeenCalled();
  });

  it('get-logs: an unknown environment is dropped and a bad take falls back', async () => {
    ops.getLogs.mockResolvedValue({
      success: true,
      data: {
        records: [],
        nextCursor: null,
        totalCount: 0,
        oldestRecordDate: null,
      },
    });

    const { status, event } = await mockApiHandler(getLogs, {
      method: 'GET',
      query: { environment: 'NOT_A_REAL', take: 'nope' },
    });

    expect(status).toBe(200);
    expect(event).toBe('SUCCESS');
    const body = ops.getLogs.mock.calls[0]?.[0]?.body as {
      environment?: string;
      take?: number;
    };
    expect(body.environment).toBeUndefined();
    expect(body.take).toBe(50);
  });
});
