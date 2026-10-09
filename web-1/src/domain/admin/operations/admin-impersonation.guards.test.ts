/**
 * ADMIN IMPERSONATION GUARDS unit tests — resolveBecomeUserTarget_IO +
 * requireAdminSessionNotExpired (admin-impersonation.guards.ts).
 *
 * These guards fence the highest-privilege operation in the system (become-user
 * mints a session AS another user). Asserted behavior:
 *
 *  - self-become rejected as ADMIN_TARGET_NOT_FOUND (masked — no confirmation the
 *    id was the caller's own) BEFORE any DB access;
 *  - NO NESTED IMPERSONATION: a caller whose CURRENT session token is a live
 *    backup row's impersonated_session_token is rejected (403 PROTECTED) — the
 *    check is server-side (DB column), runs BEFORE the target fetch, and masks as
 *    PROTECTED (not NOT_FOUND);
 *  - unresolvable target → ADMIN_TARGET_NOT_FOUND;
 *  - NO ADMIN-ON-ADMIN: a MASTER_ADMIN target is rejected (privilege-escalation
 *    fence — an impersonated admin session would be a full master-admin session);
 *  - happy path returns the validated target;
 *  - requireAdminSessionNotExpired: expired admin return-session → VALIDATION_ERROR
 *    (a backup that can never be redeemed must not be prolonged/returned).
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeSession } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import {
  resolveBecomeUserTarget_IO,
  requireAdminSessionNotExpired,
} from './admin-impersonation.guards';

const ADMIN_ID = 'usr_admin_000000000000001';
const TARGET_ID = 'usr_target_00000000000001';
const SESSION_TOKEN = 'tok_admin_session_000001';

const rawTarget = (roleId: string): Record<string, unknown> => ({
  id: TARGET_ID,
  email: 'target@test.local',
  role_id: roleId,
  is_active: true,
  disabled_at: null,
  deleted_at: null,
  stylist_account: null,
  client_account: null,
});

describe('resolveBecomeUserTarget_IO — become-user fence', () => {
  it('self-become → ADMIN_TARGET_NOT_FOUND (masked), rejected BEFORE any DB access', async () => {
    const findFirst = vi.fn(async () => null);
    const findUnique = vi.fn(async () => rawTarget(SystemRoleId.STYLIST_ROLE));
    mockDb({
      impersonationBackup: { findFirst },
      user: { findUnique },
    });

    const result = await resolveBecomeUserTarget_IO({
      callerId: ADMIN_ID,
      targetId: ADMIN_ID,
      sessionToken: SESSION_TOKEN,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_NOT_FOUND');
    }
    expect(findFirst).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('caller mid-impersonation (nested become-user) → ADMIN_TARGET_PROTECTED; check keyed on the CURRENT session token, BEFORE the target fetch', async () => {
    const findFirst = vi.fn(async () => ({ ref_id: 'ref_live_1' }));
    const findUnique = vi.fn(async () => rawTarget(SystemRoleId.STYLIST_ROLE));
    mockDb({
      impersonationBackup: { findFirst },
      user: { findUnique },
    });

    const result = await resolveBecomeUserTarget_IO({
      callerId: ADMIN_ID,
      targetId: TARGET_ID,
      sessionToken: SESSION_TOKEN,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_PROTECTED');
      if (result.error.type === 'ADMIN_TARGET_PROTECTED') {
        expect(result.error.reason).toBe('ADMIN_CANNOT_TARGET_ADMIN');
      }
    }
    // Server-side binding: the DB column is matched against the live session
    // token, never a client-supplied header.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { impersonated_session_token: SESSION_TOKEN },
      })
    );
    // Rejected as PROTECTED before the target is even fetched (no NOT_FOUND mask).
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('unresolvable target → ADMIN_TARGET_NOT_FOUND', async () => {
    mockDb({
      impersonationBackup: { findFirst: vi.fn(async () => null) },
      user: { findUnique: vi.fn(async () => null) },
    });

    const result = await resolveBecomeUserTarget_IO({
      callerId: ADMIN_ID,
      targetId: TARGET_ID,
      sessionToken: SESSION_TOKEN,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_NOT_FOUND');
      if (result.error.type === 'ADMIN_TARGET_NOT_FOUND') {
        expect(result.error.targetId).toBe(TARGET_ID);
      }
    }
  });

  it('MASTER_ADMIN target → ADMIN_TARGET_PROTECTED (no admin-on-admin impersonation / privilege escalation)', async () => {
    mockDb({
      impersonationBackup: { findFirst: vi.fn(async () => null) },
      user: {
        findUnique: vi.fn(async () => rawTarget(SystemRoleId.MASTER_ADMIN)),
      },
    });

    const result = await resolveBecomeUserTarget_IO({
      callerId: ADMIN_ID,
      targetId: TARGET_ID,
      sessionToken: SESSION_TOKEN,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_PROTECTED');
      if (result.error.type === 'ADMIN_TARGET_PROTECTED') {
        expect(result.error.reason).toBe('ADMIN_CANNOT_TARGET_ADMIN');
      }
    }
  });

  it('valid non-admin target → success with the resolved user', async () => {
    mockDb({
      impersonationBackup: { findFirst: vi.fn(async () => null) },
      user: {
        findUnique: vi.fn(async () => rawTarget(SystemRoleId.STYLIST_ROLE)),
      },
    });

    const result = await resolveBecomeUserTarget_IO({
      callerId: ADMIN_ID,
      targetId: TARGET_ID,
      sessionToken: SESSION_TOKEN,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(TARGET_ID);
    }
  });

  it('DB failure during the nested-impersonation check → DATABASE_ERROR (never a throw)', async () => {
    mockDb({
      impersonationBackup: {
        findFirst: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
    });

    const result = await resolveBecomeUserTarget_IO({
      callerId: ADMIN_ID,
      targetId: TARGET_ID,
      sessionToken: SESSION_TOKEN,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});

describe('requireAdminSessionNotExpired — return-session TTL fence', () => {
  it('expired admin return-session → VALIDATION_ERROR (backup must not be prolonged/redeemed)', () => {
    const expired = makeSession({
      expires: new Date(Date.now() - 60_000),
    });

    const result = requireAdminSessionNotExpired(expired);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.field).toBe('backupHeader');
      }
    }
  });

  it('live admin return-session → success', () => {
    const live = makeSession({
      expires: new Date(Date.now() + 60_000),
    });

    expect(requireAdminSessionNotExpired(live).success).toBe(true);
  });
});
