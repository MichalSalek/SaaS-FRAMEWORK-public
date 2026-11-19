/** Pins self history, the legacy admin override and the additive admin route; DB and auth are mocked. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import history from '../../pages/api/v1/email/get-history/index';
import adminHistory from '../../pages/api/v1/admin/email-history/index';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import {
  makeClientCurrentUser,
  makeCurrentUserOutput,
  makeStylistCurrentUser,
} from '../fixtures';

const ops = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock('@domain/email/operations/email-query.operations', () => ({
  getEmailHistory_IO: ops.history,
}));
const client = makeClientCurrentUser();
const admin = makeStylistCurrentUser({
  user: { role_id: SystemRoleId.MASTER_ADMIN },
});

describe('email history actor and legacy compatibility', () => {
  beforeEach(() => {
    __setCurrentUser(makeCurrentUserOutput(client));
    __setPermission(null);
    ops.history.mockReset();
    ops.history.mockResolvedValue({
      success: true,
      data: { emails: [], nextCursor: null },
    });
  });
  it('uses the authenticated user when no target was supplied', async () => {
    const response = await mockApiHandler(history, {
      method: 'GET',
      url: '/api/v1/email/get-history',
    });
    expect(response.status).toBe(200);
    expect(ops.history).toHaveBeenCalledWith(client.id, expect.any(Object));
  });
  it('rejects a legacy target parameter for a non-admin before reading history', async () => {
    const response = await mockApiHandler(history, {
      method: 'GET',
      query: { userId: 'foreign-user' },
      url: '/api/v1/email/get-history',
    });
    expect(response.status).toBe(403);
    expect(ops.history).not.toHaveBeenCalled();
  });
  it('preserves a legacy admin target while frontend and backend roll out independently', async () => {
    __setCurrentUser(makeCurrentUserOutput(admin));
    const response = await mockApiHandler(history, {
      method: 'GET',
      query: { userId: 'foreign-user' },
      url: '/api/v1/email/get-history',
    });
    expect(response.status).toBe(200);
    expect(ops.history).toHaveBeenCalledWith(
      'foreign-user',
      expect.any(Object)
    );
  });
  it('denies the new admin route to a non-admin through real permission metadata', async () => {
    const response = await mockApiHandler(adminHistory, {
      method: 'GET',
      query: { user_id: 'foreign-user' },
      url: '/api/v1/admin/email-history',
    });
    expect(response.status).toBe(403);
    expect(ops.history).not.toHaveBeenCalled();
  });
  it('lets an admin use the new target route', async () => {
    __setCurrentUser(makeCurrentUserOutput(admin));
    const response = await mockApiHandler(adminHistory, {
      method: 'GET',
      query: { user_id: 'foreign-user' },
      url: '/api/v1/admin/email-history',
    });
    expect(response.status).toBe(200);
    expect(ops.history).toHaveBeenCalledWith(
      'foreign-user',
      expect.any(Object)
    );
  });
  it('rejects a missing target on the new admin route', async () => {
    __setCurrentUser(makeCurrentUserOutput(admin));
    const response = await mockApiHandler(adminHistory, {
      method: 'GET',
      url: '/api/v1/admin/email-history',
    });
    expect(response.status).toBe(400);
    expect(ops.history).not.toHaveBeenCalled();
  });
});
