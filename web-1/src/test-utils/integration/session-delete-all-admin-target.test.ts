/**
 * Integration-handler — POST session/delete/all with a target id.
 *
 * A master admin may log another user out everywhere, but NOT another admin:
 * that is the same actor-on-actor class USER_DISABLE_ANY already refuses with
 * 403 ADMIN_TARGET_PROTECTED / ADMIN_CANNOT_TARGET_ADMIN. The admin's own id stays
 * a plain "log me out everywhere".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler from '../../pages/api/v1/session/delete/all/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

const ADMIN_ID = 'usr_admin_000000000000001';
const OTHER_ADMIN_ID = 'usr_admin_000000000000002';
const REGULAR_USER_ID = 'usr_user_0000000000000003';

const roles: Record<string, string> = {
  [ADMIN_ID]: SystemRoleId.MASTER_ADMIN,
  [OTHER_ADMIN_ID]: SystemRoleId.MASTER_ADMIN,
  [REGULAR_USER_ID]: SystemRoleId.STYLIST_ROLE,
};

// deleteAllSessionsOfUser_IO is an inert stub in setup.ts (the whole
// user-session.operations module is replaced), so the observable seam here is the
// protection lookup (user.findUnique) plus the HTTP contract.
const setupDb = () => {
  const findUnique = vi.fn(async (arg: { where: { id: string } }) => {
    const role = roles[arg.where.id];
    return role ? { role_id: role } : null;
  });
  mockDb({ user: { findUnique } });
  return { findUnique };
};

describe('POST /api/v1/session/delete/all — admin target protection', () => {
  beforeEach(() => {
    __setCurrentUser(
      makeCurrentUserOutput(
        makeStylistCurrentUser({
          user: { id: ADMIN_ID, role_id: SystemRoleId.MASTER_ADMIN },
        })
      )
    );
    __setPermission(true);
  });

  it('another admin → 403 ADMIN_CANNOT_TARGET_ADMIN', async () => {
    setupDb();

    const { status, data } = await mockApiHandler<{ reason: string }>(handler, {
      method: 'POST',
      body: { id: OTHER_ADMIN_ID },
    });

    expect(status).toBe(403);
    expect(data).toEqual({ reason: 'ADMIN_CANNOT_TARGET_ADMIN' });
  });

  it('a regular user → 200 after the protection lookup', async () => {
    const { findUnique } = setupDb();

    const { status, event } = await mockApiHandler(handler, {
      method: 'POST',
      body: { id: REGULAR_USER_ID },
    });

    expect(status).toBe(200);
    expect(event).toBe(APP_EVENTS.INFO.USER.USER_LOGGED_OUT);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: REGULAR_USER_ID },
      select: { role_id: true },
    });
  });

  it("the admin's own id → 200, not a self-target refusal", async () => {
    const { findUnique } = setupDb();

    const { status } = await mockApiHandler(handler, {
      method: 'POST',
      body: { id: ADMIN_ID },
    });

    expect(status).toBe(200);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
