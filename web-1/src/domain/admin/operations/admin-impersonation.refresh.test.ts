/**
 * ADMIN IMPERSONATION unit tests — adminRefreshImpersonation_IO (sibling of
 * admin-impersonation.operations.test.ts; split for the max-lines budget, same
 * seams — see that file's header for the shared setup rationale).
 *
 * Behavior under test:
 *  - invalid/expired opaque token → VALIDATION_ERROR, no rotation;
 *  - CALLER-BINDING: the redeemer must BE the impersonated target ON the exact
 *    minted session — a leaked header redeemed by anyone else (or by the right
 *    user on a different session) is rejected and NOTHING rotates;
 *  - backup-session ownership (token must still belong to the claimed admin),
 *    admin-role and expiry are re-verified server-side before rotating;
 *  - happy path rotates by ref_id, stamps ONLY the fresh opaque token and writes
 *    one IMPERSONATION_REFRESHED audit row attributed to the admin.
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

import { adminRefreshImpersonation_IO } from './admin-impersonation.operations';
import { SWITCH_BACK_TOKEN_NAME } from '@app/admin/become-user.config';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { allowedEventLogTypes } from '@kernel/domain/event-log/event_log.config';

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
  backupSpies.verifyImpersonationBackup.mockReset();
  backupSpies.refreshImpersonationBackup.mockReset();
});
describe('adminRefreshImpersonation_IO', () => {
  const runRefresh = (caller = impersonatedCaller) => {
    const { req, res } = makeReqRes();
    return {
      res,
      promise: adminRefreshImpersonation_IO({
        currentUser: caller,
        backupHeaderRaw: OPAQUE_TOKEN,
        req,
        res,
      }),
    };
  };

  it('invalid/expired opaque token → VALIDATION_ERROR, no rotation', async () => {
    backupSpies.verifyImpersonationBackup.mockResolvedValue(null);
    mockDb({});

    const result = await runRefresh().promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
    }
    expect(backupSpies.refreshImpersonationBackup).not.toHaveBeenCalled();
  });

  it('CALLER-BINDING: leaked header redeemed by a DIFFERENT user → rejected, no rotation', async () => {
    backupSpies.verifyImpersonationBackup.mockResolvedValue(backupRow);
    mockDb({});
    const otherUser = makeStylistCurrentUser({
      user: { id: 'usr_attacker_000000000001' },
      session: { token: 'tok_attacker_000000000001' },
    });

    const result = await runRefresh(otherUser).promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.message).toBe(
          'Caller must be the impersonated target'
        );
      }
    }
    expect(backupSpies.refreshImpersonationBackup).not.toHaveBeenCalled();
  });

  it('CALLER-BINDING: right user but WRONG session (not the minted impersonated one) → rejected', async () => {
    backupSpies.verifyImpersonationBackup.mockResolvedValue(backupRow);
    mockDb({});
    const rightUserWrongSession = makeStylistCurrentUser({
      user: { id: TARGET_ID },
      session: { token: 'tok_some_other_session_01' },
    });

    const result = await runRefresh(rightUserWrongSession).promise;

    expect(result.success).toBe(false);
    expect(backupSpies.refreshImpersonationBackup).not.toHaveBeenCalled();
  });

  it('backup session no longer belongs to the claimed admin → rejected', async () => {
    backupSpies.verifyImpersonationBackup.mockResolvedValue(backupRow);
    mockDb({
      session: {
        findUnique: vi.fn(async () =>
          makeSession({
            token: ADMIN_SESSION_TOKEN,
            userId: 'usr_someone_else_00000001',
            expires: new Date(Date.now() + 60_000),
          })
        ),
      },
    });

    const result = await runRefresh().promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.message).toBe(
          'Backup session does not belong to claimed user'
        );
      }
    }
    expect(backupSpies.refreshImpersonationBackup).not.toHaveBeenCalled();
  });

  it('EXPIRED admin return-session → rejected (an unreturnable impersonation must not be prolonged)', async () => {
    backupSpies.verifyImpersonationBackup.mockResolvedValue(backupRow);
    mockDb({
      session: {
        findUnique: vi.fn(async () =>
          makeSession({
            token: ADMIN_SESSION_TOKEN,
            userId: ADMIN_ID,
            expires: new Date(Date.now() - 60_000),
          })
        ),
      },
      user: {
        findUnique: vi.fn(async () =>
          rawUser(ADMIN_ID, SystemRoleId.MASTER_ADMIN, false)
        ),
      },
    });

    const result = await runRefresh().promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.message).toBe(
          'Original admin session expired during impersonation'
        );
      }
    }
    expect(backupSpies.refreshImpersonationBackup).not.toHaveBeenCalled();
  });

  it('happy path: rotates the backup by ref_id and stamps the fresh opaque token', async () => {
    const newExpiry = new Date(Date.now() + 12 * 60 * 60 * 1000);
    backupSpies.verifyImpersonationBackup.mockResolvedValue(backupRow);
    backupSpies.refreshImpersonationBackup.mockResolvedValue({
      opaqueToken: 'fresh.opaque.token',
      expiresAt: newExpiry,
    });
    const auditCreate = eventLogCreate();
    mockDb({
      eventLog: { create: auditCreate },
      session: {
        findUnique: vi.fn(async () =>
          makeSession({
            token: ADMIN_SESSION_TOKEN,
            userId: ADMIN_ID,
            expires: new Date(Date.now() + 60_000),
          })
        ),
      },
      user: {
        findUnique: vi.fn(async () =>
          rawUser(ADMIN_ID, SystemRoleId.MASTER_ADMIN, false)
        ),
      },
    });

    const { res, promise } = runRefresh();
    const result = await promise;

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiresAt).toBe(newExpiry.getTime());
    }
    expect(backupSpies.refreshImpersonationBackup).toHaveBeenCalledWith({
      refId: REF_ID,
    });
    expect(res.getHeader(SWITCH_BACK_TOKEN_NAME)).toBe('fresh.opaque.token');

    // Audit row: actor = the ADMIN (from the backup row), target = impersonated user.
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditArgs = auditCreate.mock.calls[0]?.[0] as unknown as {
      data: {
        event: string;
        event_type: string;
        created_by_user_id: string;
        event_payload: Record<string, unknown>;
      };
    };
    expect(auditArgs.data.event).toBe(
      APP_EVENTS.INFO.ADMIN.IMPERSONATION_REFRESHED
    );
    expect(auditArgs.data.event_type).toBe(EventLogTypeValue.ADMIN);
    expect(auditArgs.data.created_by_user_id).toBe(ADMIN_ID);
    expect(auditArgs.data.event_payload).toMatchObject({
      target_id: TARGET_ID,
      impersonated_by_admin_id: ADMIN_ID,
    });
  });

  it('IMPERSONATION_REFRESHED is registered in the ADMIN event-log bucket', () => {
    expect(allowedEventLogTypes[EventLogTypeValue.ADMIN]).toContain(
      APP_EVENTS.INFO.ADMIN.IMPERSONATION_REFRESHED
    );
  });

  it('rejected refresh writes NO audit row', async () => {
    backupSpies.verifyImpersonationBackup.mockResolvedValue(null);
    const auditCreate = eventLogCreate();
    mockDb({ eventLog: { create: auditCreate } });

    const result = await runRefresh().promise;

    expect(result.success).toBe(false);
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
