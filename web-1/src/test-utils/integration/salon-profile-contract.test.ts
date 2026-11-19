/**
 * Salon profile handlers bound through `defineEndpoint(SALON_PROFILE_CONTRACTS.KEY)`.
 * An empty update is 400, while partial profile edits are accepted. A public profile with no identifier is not a 400:
 * the handler still calls the operation with an empty id.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import updateHandler from '../../pages/api/v1/salon/profile/update/index';
import publicHandler from '../../pages/api/v1/public/salon-profile/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';

const ops = vi.hoisted(() => ({
  update: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@domain/salon-profile/salon-profile.operations', () => ({
  updateSalonProfile_IO: ops.update,
  getSalonProfile_IO: ops.get,
  updateSalonProfileVisibility_IO: vi.fn(),
  getSalonProfileVisibility_IO: vi.fn(),
  checkSalonSlug_IO: vi.fn(),
}));

describe('salon profile through the API contract', () => {
  beforeEach(() => {
    ops.update.mockReset();
    ops.get.mockReset();
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    __setPermission(true);
    mockDb({ impersonationBackup: { findFirst: async () => null } });
    ops.get.mockResolvedValue({
      success: false,
      error: { type: 'NOT_FOUND' },
    });
  });

  it('rejects an empty update and accepts a partial team update', async () => {
    const empty = await mockApiHandler(updateHandler, {
      method: 'POST',
      body: {},
    });
    expect(empty.status).toBe(400);
    expect(ops.update).not.toHaveBeenCalled();
    ops.update.mockResolvedValue({
      success: false,
      error: { type: 'ACCOUNT_NOT_FOUND', accountId: 'missing' },
    });
    const partial = await mockApiHandler(updateHandler, {
      method: 'POST',
      body: { show_team: false },
    });
    expect(partial.status).toBe(404);
    expect(ops.update).toHaveBeenCalledWith(
      expect.objectContaining({ body: { show_team: false } })
    );
  });

  it('public profile: a missing identifier is passed as an empty id, not a 400', async () => {
    const { status } = await mockApiHandler(publicHandler, {
      method: 'GET',
      query: {},
    });
    expect(status).not.toBe(400);
    expect(ops.get).toHaveBeenCalledWith({ accountId: '', slug: false });
  });
});
