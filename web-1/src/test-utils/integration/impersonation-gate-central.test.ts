/**
 * Impersonation gate at the EDGE (testy-api s34): real handlers through the real
 * request middleware, with NO `become-user` header. The session token recorded by
 * become-user must block a sensitive command on its own, and a command whose
 * handler never calls the gate (plan change) must be gated too, because the gate
 * lives in the middleware.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

const spies = vi.hoisted(() => ({
  disableSelfUser_IO: vi.fn(async () => ({ success: true, data: null })),
  writeRawEventLog_IO: vi.fn(async (_args: unknown) => undefined),
}));

vi.mock('@domain/user/operations/user-state.operations', () => ({
  disableSelfUser_IO: spies.disableSelfUser_IO,
}));
vi.mock('@app/event-log/event-log.client', () => ({
  writeRawEventLog_IO: spies.writeRawEventLog_IO,
}));

import disableSelfHandler from '../../pages/api/v1/user/disable/self/index';
import planChangeHandler from '../../pages/api/v1/account/plan-change/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';

const ADMIN_ID = 'usr_admin_00000000000000001';

const installBackup = (impersonatedToken: string | null) => {
  const currentUser = makeStylistCurrentUser();
  mockDb({
    impersonationBackup: {
      findFirst: async (args: {
        where: {
          impersonated_session_token: string;
          impersonated_user_id: string;
        };
      }) =>
        impersonatedToken !== null &&
        args.where.impersonated_session_token === impersonatedToken &&
        args.where.impersonated_user_id === currentUser.id
          ? { admin_user_id: ADMIN_ID }
          : null,
    },
  });
  __setCurrentUser(makeCurrentUserOutput(currentUser));
};

beforeEach(() => {
  __setPermission(true);
  spies.disableSelfUser_IO.mockClear();
  spies.writeRawEventLog_IO.mockClear();
});

describe('impersonation gate — central, session-based', () => {
  it('blocks self-disable from the impersonated session without any header', async () => {
    installBackup(makeStylistCurrentUser().session.token);

    const { status, event } = await mockApiHandler(disableSelfHandler, {
      method: 'POST',
      body: {},
    });

    expect(status).toBe(403);
    expect(event).toBe(APP_EVENTS.INFO.ADMIN.IMPERSONATION_SENSITIVE_BLOCKED);
    expect(spies.disableSelfUser_IO).not.toHaveBeenCalled();
    const row = spies.writeRawEventLog_IO.mock.calls[0]?.[0] as {
      meta: { created_by_user_id: string };
    };
    expect(row.meta.created_by_user_id).toBe(ADMIN_ID);
  });

  it('gates plan change although its handler never calls the gate', async () => {
    installBackup(makeStylistCurrentUser().session.token);

    const { status, event } = await mockApiHandler(planChangeHandler, {
      method: 'POST',
      body: {},
    });

    expect(status).toBe(403);
    expect(event).toBe(APP_EVENTS.INFO.ADMIN.IMPERSONATION_SENSITIVE_BLOCKED);
  });

  it("lets the user's own session through to the operation", async () => {
    installBackup(null);

    const { status } = await mockApiHandler(disableSelfHandler, {
      method: 'POST',
      body: {},
    });

    expect(status).toBe(200);
    expect(spies.disableSelfUser_IO).toHaveBeenCalledTimes(1);
  });
});
