/**
 * ADMIN IMPERSONATION unit tests — adminBecomeUser_IO
 * (admin-impersonation.operations.ts). Sibling suites (split for the max-lines
 * budget, same seams): admin-impersonation.refresh.test.ts,
 * admin-impersonation.switch-back.test.ts.
 *
 * The opaque-token layer (HMAC mint/verify/claim — impersonation-backup.utils) and
 * the session transport (user-session.operations) are module-mocked; the operation
 * runs REAL over node-mocks-http req/res, so header stamping is asserted for real:
 *
 *  - non-admin caller / guard rejections → no session is ever minted;
 *  - happy path: target session minted FIRST, backup issued with BOTH identities
 *    (caller-binding source of truth), the ADMIN TOKEN IS NEVER RETURNED — only
 *    the opaque token in the become-user header + the target token in the session
 *    header; audit row keyed by the real admin;
 *  - lost concurrent become-user race (serialization conflict inside
 *    issueImpersonationBackup) → SERIALIZATION_CONFLICT (retryable), never a 500;
 *    a genuine DB error rethrows.
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

// ── Opaque HMAC backup layer: mocked (its own crypto/env mechanics are not under
// test here — the operations' choreography around it is). ───────────────────────
const backupSpies = vi.hoisted(() => ({
  issueImpersonationBackup: vi.fn(),
  refreshImpersonationBackup: vi.fn(),
  verifyImpersonationBackup: vi.fn(),
  claimImpersonationBackupByRefId: vi.fn(),
  deleteImpersonationBackupByRefId: vi.fn(async () => undefined),
}));
vi.mock('@domain/admin/impersonation-backup.utils', () => backupSpies);

import { adminBecomeUser_IO } from './admin-impersonation.operations';
import { SWITCH_BACK_TOKEN_NAME } from '@app/admin/become-user.config';
import { SESSION_HEADER_NAME } from '@app/auth/session/session.utils.api';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

const ADMIN_ID = 'usr_admin_000000000000001';
const TARGET_ID = 'usr_target_00000000000001';
const ADMIN_SESSION_TOKEN = 'tok_admin_0000000000000001';
const IMPERSONATED_TOKEN = 'tok_impersonated_00000001';
const REF_ID = 'ref_backup_000000000000001';
const OPAQUE_TOKEN = `${REF_ID}.1900000000000.hmacsig`;

const adminCaller = makeStylistCurrentUser({
  user: { id: ADMIN_ID, role_id: SystemRoleId.MASTER_ADMIN },
  session: { token: ADMIN_SESSION_TOKEN, id: 'sess_admin_00000000000001' },
});
const adminSession = adminCaller.session;

/** The caller AS the impersonated target (post-become-user identity). */
const impersonatedCaller = makeStylistCurrentUser({
  user: { id: TARGET_ID, role_id: SystemRoleId.STYLIST_ROLE },
  session: { token: IMPERSONATED_TOKEN, id: 'sess_imp_0000000000000001' },
});

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
  sessionSpies.createManualSessionForUser_IO.mockReset();
  sessionSpies.deleteSessionByToken_IO.mockReset();
  sessionSpies.deleteSessionByToken_IO.mockResolvedValue(undefined);
  backupSpies.issueImpersonationBackup.mockReset();
  backupSpies.refreshImpersonationBackup.mockReset();
  backupSpies.verifyImpersonationBackup.mockReset();
  backupSpies.claimImpersonationBackupByRefId.mockReset();
  backupSpies.deleteImpersonationBackupByRefId.mockReset();
  backupSpies.deleteImpersonationBackupByRefId.mockResolvedValue(undefined);
});

describe('adminBecomeUser_IO', () => {
  const runBecome = (opts?: {
    caller?: typeof adminCaller;
    targetId?: string;
  }) => {
    const { req, res } = makeReqRes();
    const caller = opts?.caller ?? adminCaller;
    return {
      req,
      res,
      promise: adminBecomeUser_IO({
        body: { id: opts?.targetId ?? TARGET_ID },
        currentUser: caller,
        session: caller.session,
        metadata: {},
        req,
        res,
      }),
    };
  };

  it('non-admin caller → ADMIN_INSUFFICIENT_PERMISSIONS, no session ever minted', async () => {
    mockDb({});
    const { promise } = runBecome({ caller: impersonatedCaller });

    const result = await promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_INSUFFICIENT_PERMISSIONS');
    }
    expect(sessionSpies.createManualSessionForUser_IO).not.toHaveBeenCalled();
    expect(backupSpies.issueImpersonationBackup).not.toHaveBeenCalled();
  });

  it('guard rejection (self-become) propagates and mints NOTHING', async () => {
    mockDb({});
    const { promise } = runBecome({ targetId: ADMIN_ID });

    const result = await promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_NOT_FOUND');
    }
    expect(sessionSpies.createManualSessionForUser_IO).not.toHaveBeenCalled();
    expect(backupSpies.issueImpersonationBackup).not.toHaveBeenCalled();
  });

  it('happy path: mints target session, issues caller-bound backup, stamps ONLY opaque+target tokens (admin token never leaves), audits as the admin', async () => {
    const impersonatedSession = makeSession({
      id: 'sess_imp_0000000000000001',
      token: IMPERSONATED_TOKEN,
      userId: TARGET_ID,
    });
    sessionSpies.createManualSessionForUser_IO.mockResolvedValue({
      success: true,
      data: impersonatedSession,
    });
    backupSpies.issueImpersonationBackup.mockResolvedValue({
      opaqueToken: OPAQUE_TOKEN,
    });
    const auditCreate = eventLogCreate();
    mockDb({
      impersonationBackup: { findFirst: vi.fn(async () => null) },
      user: {
        findUnique: vi.fn(async () =>
          rawUser(TARGET_ID, SystemRoleId.STYLIST_ROLE)
        ),
      },
      eventLog: { create: auditCreate },
    });

    const { res, promise } = runBecome();
    const result = await promise;

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currentUser.id).toBe(TARGET_ID);
      expect(result.data.session.token).toBe(IMPERSONATED_TOKEN);
    }

    // Target session minted for the TARGET id.
    expect(sessionSpies.createManualSessionForUser_IO).toHaveBeenCalledWith(
      expect.objectContaining({ id: TARGET_ID })
    );

    // Backup persists BOTH identities + the exact minted token (caller-binding SSOT).
    expect(backupSpies.issueImpersonationBackup).toHaveBeenCalledWith({
      adminUserId: ADMIN_ID,
      backupSessionToken: ADMIN_SESSION_TOKEN,
      originalSessionId: adminSession.id,
      impersonatedUserId: TARGET_ID,
      impersonatedSessionToken: IMPERSONATED_TOKEN,
    });

    // Response headers: opaque token + target session token. The admin session
    // token must appear in NO header (D23 — never serialized to the client).
    expect(res.getHeader(SWITCH_BACK_TOKEN_NAME)).toBe(OPAQUE_TOKEN);
    expect(res.getHeader(SESSION_HEADER_NAME)).toBe(IMPERSONATED_TOKEN);
    const allHeaderValues = Object.values(res.getHeaders());
    expect(allHeaderValues).not.toContain(ADMIN_SESSION_TOKEN);

    // Audit attributed to the REAL admin.
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditArgs = auditCreate.mock.calls[0]?.[0] as unknown as {
      data: { event: string; created_by_user_id: string };
    };
    expect(auditArgs.data.event).toBe(
      APP_EVENTS.INFO.ADMIN.USER_BECAME_SOMEONE_ELSE
    );
    expect(auditArgs.data.created_by_user_id).toBe(ADMIN_ID);
  });

  it('lost concurrent become-user race (40001 in backup issue) → SERIALIZATION_CONFLICT, not a throw', async () => {
    sessionSpies.createManualSessionForUser_IO.mockResolvedValue({
      success: true,
      data: makeSession({ token: IMPERSONATED_TOKEN, userId: TARGET_ID }),
    });
    backupSpies.issueImpersonationBackup.mockRejectedValue(
      new Error('TransactionWriteConflict')
    );
    mockDb({
      impersonationBackup: { findFirst: vi.fn(async () => null) },
      user: {
        findUnique: vi.fn(async () =>
          rawUser(TARGET_ID, SystemRoleId.STYLIST_ROLE)
        ),
      },
    });

    const { promise } = runBecome();
    const result = await promise;

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SERIALIZATION_CONFLICT');
    }
  });

  it('genuine (non-serialization) DB error in backup issue → rethrows to the 500 path', async () => {
    sessionSpies.createManualSessionForUser_IO.mockResolvedValue({
      success: true,
      data: makeSession({ token: IMPERSONATED_TOKEN, userId: TARGET_ID }),
    });
    backupSpies.issueImpersonationBackup.mockRejectedValue(
      new Error('unique constraint violated')
    );
    mockDb({
      impersonationBackup: { findFirst: vi.fn(async () => null) },
      user: {
        findUnique: vi.fn(async () =>
          rawUser(TARGET_ID, SystemRoleId.STYLIST_ROLE)
        ),
      },
    });

    const { promise } = runBecome();
    await expect(promise).rejects.toThrow('unique constraint violated');
  });
});
