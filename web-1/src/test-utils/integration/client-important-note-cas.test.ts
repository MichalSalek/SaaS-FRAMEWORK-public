import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '../../pages/api/v1/client/important-note/upsert/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';

const operation = vi.hoisted(() => vi.fn());
vi.mock('@domain/client/operations/client-important-note.operations', () => ({
  upsertClientImportantNote_IO: operation,
}));

describe('important note revision contract', () => {
  beforeEach(() => {
    operation.mockReset();
    operation.mockResolvedValue({
      success: true,
      data: { note: null, updatedAt: '2026-10-01T00:00:00.001Z' },
    });
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    __setPermission(true);
    mockDb({ impersonationBackup: { findFirst: async () => null } });
  });
  it('passes an explicit null revision and returns a clear tombstone', async () => {
    const response = await mockApiHandler(handler, {
      method: 'POST',
      body: { client_user_id: 'client', note: '', expected_updated_at: null },
    });
    expect(response.status).toBe(200);
    expect(operation).toHaveBeenCalledWith(
      expect.objectContaining({ expected_updated_at: null })
    );
    expect(response.data).toMatchObject({
      note: null,
      updatedAt: '2026-10-01T00:00:00.001Z',
    });
  });
  it('omits the revision for legacy clients', async () => {
    const response = await mockApiHandler(handler, {
      method: 'POST',
      body: { client_user_id: 'client', note: 'legacy' },
    });
    expect(response.status).toBe(200);
    expect(operation).toHaveBeenCalledOnce();
    expect(operation.mock.calls[0]?.[0]).not.toHaveProperty(
      'expected_updated_at'
    );
  });
  it('rejects a malformed revision before calling the operation', async () => {
    const response = await mockApiHandler(handler, {
      method: 'POST',
      body: {
        client_user_id: 'client',
        note: 'test',
        expected_updated_at: 'not-a-date',
      },
    });
    expect(response.status).toBe(400);
    expect(operation).not.toHaveBeenCalled();
  });
});
