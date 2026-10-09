/**
 * ADMIN IMPERSONATION unit tests — adminSwitchBackToSelf_IO (sibling of
 * admin-impersonation.operations.test.ts; split for the max-lines budget, same
 * seams — see that file's header for the shared setup rationale).
 *
 * Behavior under test:
 *  - invalid/expired opaque token AND caller-binding failure → reject WITHOUT
 *    cleanup (an attacker with a leaked header must not be able to destroy the
 *    legit admin's session/backup — griefing fence);
 *  - vanished admin / expired admin session → cleanup WITH the backup row delete
 *    (the trap is torn down);
 *  - EXACTLY-ONCE redeem: claim=false (lost race) → reject, no duplicate teardown,
 *    no restored session header;
 *  - happy path: claim consumed the row (NO second backup delete), impersonated
 *    session torn down, admin session token restored in the header, audit row
 *    attributed to the restored admin.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  makeSession,
  makeStylistCurrentUser,
} from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { CLEAR_THIS_HEADER_COMMAND_VALUE } from '@kernel/application/http/http.config';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

// ── Session transport: controllable spies (overrides the inert setup stubs). ────
const sessionSpies = vi.hoisted(() => ({
  createManualSessionForUser_IO: vi.fn(),
  deleteSessionByToken_IO: vi.fn(async () => undefined),
}));
vi.mock('@domain/user/operations/user-session.operations', () => ({
  getCurrentUserUndefinedReturnObject: {
    user: undefined,
    currentUser: undefined,
    session: undefined,
  },
  getCurrentUser_IO: vi.fn(async () => ({
    user: undefined,
    currentUser: undefined,
    session: undefined,
  })),
  createManualSessionForUser_IO: sessionSpies.createManualSessionForUser_IO,
  deleteSessionByToken_IO: sessionSpies.deleteSessionByToken_IO,
  getAllSessionsOfUser_IO: vi.fn(async () => ({
    sessions: [],
    nextCursor: null,
  })),
  deleteSession_IO: vi.fn(async () => ({ success: true, data: null })),
  deleteAllSessionsOfUser_IO: vi.fn(async () => ({
    success: true,
    data: { deletedCount: 0 },
  })),
}));

// ── Opaque HMAC backup layer: mocked (choreography around it is under test). ────
const backupSpies = vi.hoisted(() => ({
  issueImpersonationBackup: vi.fn(),
  refreshImpersonationBackup: vi.fn(),
  verifyImpersonationBackup: vi.fn(),
  claimImpersonationBackupByRefId: vi.fn(),
  deleteImpersonationBackupByRefId: vi.fn(async () => undefined),
}));
vi.mock('@domain/admin/impersonation-backup.utils', () => backupSpies);

import { adminSwitchBackToSelf_IO } from './admin-impersonation.operations';
import { SWITCH_BACK_TOKEN_NAME } from '@app/admin/become-user.config';
import { SESSION_HEADER_NAME } from '@app/auth/session/session.utils.api';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

const ADMIN_ID = 'usr_admin_000000000000001';
const TARGET_ID = 'usr_target_00000000000001';
const ADMIN_SESSION_TOKEN = 'tok_admin_0000000000000001';
const IMPERSONATED_TOKEN = 'tok_impersonated_00000001';
const REF_ID = 'ref_backup_000000000000001';
const OPAQUE_TOKEN = `${REF_ID}.1900000000000.hmacsig`;

/** The caller AS the impersonated target (post-become-user identity). */
const impersonatedCaller = makeStylistCurrentUser({
  user: { id: TARGET_ID, role_id: SystemRoleId.STYLIST_ROLE },
  session: { token: IMPERSONATED_TOKEN, id: 'sess_imp_0000000000000001' },
});

const backupRow = {
  ref_id: REF_ID,
  admin_user_id: ADMIN_ID,
  backup_session_token: ADMIN_SESSION_TOKEN,
  impersonated_user_id: TARGET_ID,
  impersonated_session_token: IMPERSONATED_TOKEN,
};

const rawUser = (
  id: string,
  roleId: string,
  withRelations = true
): Record<string, unknown> => ({
  id,
  email: `${id}@test.local`,
  role_id: roleId,
  is_active: true,
  disabled_at: null,
  deleted_at: null,
  ...(withRelations && {
    stylist_account: null,
    client_account: null,
    sessions: [],
    favorite_stylists: [],
    favorite_records: [],
  }),
});

const eventLogCreate = () =>
  vi.fn(async (args: { data: Record<string, unknown> }) => ({
    event_log_id: 'evl_test_1',
    created_at: new Date(),
    ...args.data,
  }));

const makeReqRes = () =>
  createMocks<NextApiRequest, NextApiResponse>({ method: 'POST' });

beforeEach(() => {
  sessionSpies.deleteSessionByToken_IO.mockReset();
  sessionSpies.deleteSessionByToken_IO.mockResolvedValue(undefined);
  backupSpies.verifyImpersonationBackup.mockReset();
  backupSpies.claimImpersonationBackupByRefId.mockReset();
  backupSpies.deleteImpersonationBackupByRefId.mockReset();
  backupSpies.deleteImpersonationBackupByRefId.mockResolvedValue(undefined);
});
describe('adminSwitchBackToSelf_IO', () => {
  const runSwitchBack = (caller = impersonatedCaller) => {
    const { req, res } = makeReqRes();
    return {
      res,
      promise: adminSwitchBackToSelf_IO({
        currentUser: caller,
        backupHeaderRaw: OPAQUE_TOKEN,
        _metadata: {},
        req,
        res,
      }),
    };
  };

  it('invalid opaque token → reject WITHOUT cleanup (garbage header must not self-destruct the caller session)', async () => {
    backupSpies.verifyImpersonationBackup.mockResolvedValue(null);
    mockDb({});

    const result = await runSwitchBack().promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
    }
    // Griefing fence: NOTHING is torn down on an unrecognized token.
    expect(sessionSpies.deleteSessionByToken_IO).not.toHaveBeenCalled();
    expect(backupSpies.deleteImpersonationBackupByRefId).not.toHaveBeenCalled();
    expect(backupSpies.claimImpersonationBackupByRefId).not.toHaveBeenCalled();
  });

  it('binding failure (leaked header, foreign caller) → reject WITHOUT cleanup (no attacker-driven teardown of the admin backup)', async () => {
    backupSpies.verifyImpersonationBackup.mockResolvedValue(backupRow);
    mockDb({});
    const attacker = makeStylistCurrentUser({
      user: { id: 'usr_attacker_000000000001' },
      session: { token: 'tok_attacker_000000000001' },
    });

    const result = await runSwitchBack(attacker).promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.message).toBe(
          'Caller must be the impersonated target'
        );
      }
    }
    expect(sessionSpies.deleteSessionByToken_IO).not.toHaveBeenCalled();
    expect(backupSpies.deleteImpersonationBackupByRefId).not.toHaveBeenCalled();
    expect(backupSpies.claimImpersonationBackupByRefId).not.toHaveBeenCalled();
  });

  it('vanished admin user → ADMIN_TARGET_NOT_FOUND + FULL cleanup (session + backup row + cleared header)', async () => {
    backupSpies.verifyImpersonationBackup.mockResolvedValue(backupRow);
    mockDb({
      user: { findUnique: vi.fn(async () => null) },
    });

    const { res, promise } = runSwitchBack();
    const result = await promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_NOT_FOUND');
    }
    // Cleanup tears down the CALLER's impersonated session + the backup row.
    expect(sessionSpies.deleteSessionByToken_IO).toHaveBeenCalledWith({
      payload: { id: TARGET_ID, token: IMPERSONATED_TOKEN },
    });
    expect(backupSpies.deleteImpersonationBackupByRefId).toHaveBeenCalledWith(
      REF_ID
    );
    expect(res.getHeader(SWITCH_BACK_TOKEN_NAME)).toBe(
      CLEAR_THIS_HEADER_COMMAND_VALUE
    );
  });

  it('EXACTLY-ONCE redeem: lost claim race → reject, NO duplicate teardown, NO restored session header', async () => {
    backupSpies.verifyImpersonationBackup.mockResolvedValue(backupRow);
    backupSpies.claimImpersonationBackupByRefId.mockResolvedValue(false);
    mockDb({
      user: {
        findUnique: vi.fn(async () =>
          rawUser(ADMIN_ID, SystemRoleId.MASTER_ADMIN)
        ),
      },
      session: {
        findUnique: vi.fn(async () =>
          makeSession({
            token: ADMIN_SESSION_TOKEN,
            userId: ADMIN_ID,
            expires: new Date(Date.now() + 60_000),
          })
        ),
      },
    });

    const { res, promise } = runSwitchBack();
    const result = await promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
    }
    expect(sessionSpies.deleteSessionByToken_IO).not.toHaveBeenCalled();
    expect(res.getHeader(SESSION_HEADER_NAME)).toBeUndefined();
  });

  it('happy path: claim consumes the row (NO second delete), impersonated session torn down, admin token restored, audit written', async () => {
    backupSpies.verifyImpersonationBackup.mockResolvedValue(backupRow);
    backupSpies.claimImpersonationBackupByRefId.mockResolvedValue(true);
    const auditCreate = eventLogCreate();
    mockDb({
      user: {
        findUnique: vi.fn(async () =>
          rawUser(ADMIN_ID, SystemRoleId.MASTER_ADMIN)
        ),
      },
      session: {
        findUnique: vi.fn(async () =>
          makeSession({
            token: ADMIN_SESSION_TOKEN,
            userId: ADMIN_ID,
            expires: new Date(Date.now() + 60_000),
          })
        ),
      },
      eventLog: { create: auditCreate },
    });

    const { res, promise } = runSwitchBack();
    const result = await promise;

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(ADMIN_ID);
    }

    // Exactly-once: the claim already removed the row — cleanup must NOT delete
    // it again (idempotence of the winner path).
    expect(backupSpies.claimImpersonationBackupByRefId).toHaveBeenCalledWith(
      REF_ID
    );
    expect(backupSpies.deleteImpersonationBackupByRefId).not.toHaveBeenCalled();

    // Impersonated session torn down for the caller.
    expect(sessionSpies.deleteSessionByToken_IO).toHaveBeenCalledWith({
      payload: { id: TARGET_ID, token: IMPERSONATED_TOKEN },
    });

    // Admin session restored, become-user header cleared.
    expect(res.getHeader(SESSION_HEADER_NAME)).toBe(ADMIN_SESSION_TOKEN);
    expect(res.getHeader(SWITCH_BACK_TOKEN_NAME)).toBe(
      CLEAR_THIS_HEADER_COMMAND_VALUE
    );

    // Audit attributed to the restored admin.
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditArgs = auditCreate.mock.calls[0]?.[0] as unknown as {
      data: { event: string; created_by_user_id: string };
    };
    expect(auditArgs.data.event).toBe(
      APP_EVENTS.INFO.ADMIN.USER_SWITCHED_BACK_TO_SELF
    );
    expect(auditArgs.data.created_by_user_id).toBe(ADMIN_ID);
  });

  it('expired admin return-session → cleanup WITH backup delete + VALIDATION_ERROR (trap torn down)', async () => {
    backupSpies.verifyImpersonationBackup.mockResolvedValue(backupRow);
    mockDb({
      user: {
        findUnique: vi.fn(async () =>
          rawUser(ADMIN_ID, SystemRoleId.MASTER_ADMIN)
        ),
      },
      session: {
        findUnique: vi.fn(async () =>
          makeSession({
            token: ADMIN_SESSION_TOKEN,
            userId: ADMIN_ID,
            expires: new Date(Date.now() - 60_000),
          })
        ),
      },
    });

    const result = await runSwitchBack().promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.message).toBe(
          'Original admin session expired during impersonation'
        );
      }
    }
    expect(backupSpies.deleteImpersonationBackupByRefId).toHaveBeenCalledWith(
      REF_ID
    );
    // No redeem happened — the claim gate was never reached.
    expect(backupSpies.claimImpersonationBackupByRefId).not.toHaveBeenCalled();
  });
});
