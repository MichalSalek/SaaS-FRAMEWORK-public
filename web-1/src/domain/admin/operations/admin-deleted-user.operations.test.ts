/**
 * ADMIN DELETED-USER ARCHIVE unit tests — adminPurgeDeletedUser_IO
 * (admin-deleted-user.operations.ts).
 *
 * The ONLY code path that PHYSICALLY erases a DeletedUser archive row (GDPR Art.17
 * escape-hatch after the 90d MOVE / GDPR-erase backup). Asserted behavior:
 *
 *  - RBAC: non-admin caller → ADMIN_INSUFFICIENT_PERMISSIONS, ZERO DB access;
 *  - missing archive → ADMIN_TARGET_NOT_FOUND, no delete attempted;
 *  - happy path: delete scoped EXACTLY by the archive PK (user_id) + Art.17 audit
 *    trail row (who purged what, art17_hard_purge marker);
 *  - concurrent purge (P2025 on delete) → idempotent ADMIN_TARGET_NOT_FOUND,
 *    NO audit row for the loser (only one purge is ever recorded);
 *  - genuine DB error → DATABASE_ERROR (never a throw).
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import { adminPurgeDeletedUser_IO } from './admin-deleted-user.operations';

const ADMIN_ID = 'usr_admin_000000000000001';
const ARCHIVED_USER_ID = 'usr_archived_000000000001';

const adminCaller = makeStylistCurrentUser({
  user: { id: ADMIN_ID, role_id: SystemRoleId.MASTER_ADMIN },
});
const nonAdminCaller = makeStylistCurrentUser({
  user: { id: 'usr_pleb_0000000000000001', role_id: SystemRoleId.STYLIST_ROLE },
});

/** Prisma P2025 shape (record not found) — what a lost concurrent delete throws. */
const p2025 = (): Error =>
  Object.assign(new Error('Record to delete does not exist.'), {
    code: 'P2025',
  });

const eventLogCreate = () =>
  vi.fn(async (args: { data: Record<string, unknown> }) => ({
    event_log_id: 'evl_test_1',
    created_at: new Date(),
    ...args.data,
  }));

describe('adminPurgeDeletedUser_IO — Art.17 hard-purge of the archive', () => {
  it('non-admin caller → ADMIN_INSUFFICIENT_PERMISSIONS, zero DB access', async () => {
    const findUnique = vi.fn(async (_arg: unknown) => ({
      user_id: ARCHIVED_USER_ID,
    }));
    const del = vi.fn(async (_arg: unknown) => ({ user_id: ARCHIVED_USER_ID }));
    mockDb({ deletedUser: { findUnique, delete: del } });

    const result = await adminPurgeDeletedUser_IO({
      user_id: ARCHIVED_USER_ID,
      currentUser: nonAdminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_INSUFFICIENT_PERMISSIONS');
    }
    expect(findUnique).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('missing archive row → ADMIN_TARGET_NOT_FOUND, delete never attempted', async () => {
    const del = vi.fn(async (_arg: unknown) => ({ user_id: ARCHIVED_USER_ID }));
    mockDb({
      deletedUser: {
        findUnique: vi.fn(async (_arg: unknown) => null),
        delete: del,
      },
    });

    const result = await adminPurgeDeletedUser_IO({
      user_id: ARCHIVED_USER_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_NOT_FOUND');
      if (result.error.type === 'ADMIN_TARGET_NOT_FOUND') {
        expect(result.error.targetId).toBe(ARCHIVED_USER_ID);
      }
    }
    expect(del).not.toHaveBeenCalled();
  });

  it('happy path: delete scoped by the archive PK + Art.17 audit row (actor, target, marker)', async () => {
    const del = vi.fn(async (_arg: unknown) => ({
      user_id: ARCHIVED_USER_ID,
    }));
    const auditCreate = eventLogCreate();
    mockDb({
      deletedUser: {
        findUnique: vi.fn(async (_arg: unknown) => ({
          user_id: ARCHIVED_USER_ID,
        })),
        delete: del,
      },
      eventLog: { create: auditCreate },
    });

    const result = await adminPurgeDeletedUser_IO({
      user_id: ARCHIVED_USER_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);

    // Physical erasure scoped EXACTLY to the requested archive row.
    expect(del).toHaveBeenCalledTimes(1);
    const deleteArgs = del.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
    };
    expect(deleteArgs.where).toEqual({ user_id: ARCHIVED_USER_ID });

    // Art.17 audit trail: who purged which archive, marked as hard-purge.
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditArgs = auditCreate.mock.calls[0]?.[0] as unknown as {
      data: {
        event: string;
        created_by_user_id: string;
        event_payload: Record<string, unknown>;
      };
    };
    expect(auditArgs.data.event).toBe(APP_EVENTS.INFO.USER.USER_DELETED);
    expect(auditArgs.data.created_by_user_id).toBe(ADMIN_ID);
    expect(auditArgs.data.event_payload).toEqual(
      expect.objectContaining({
        purged_deleted_user_id: ARCHIVED_USER_ID,
        art17_hard_purge: true,
      })
    );
  });

  it('concurrent purge (P2025) → idempotent ADMIN_TARGET_NOT_FOUND, NO audit row for the loser', async () => {
    const auditCreate = eventLogCreate();
    mockDb({
      deletedUser: {
        findUnique: vi.fn(async (_arg: unknown) => ({
          user_id: ARCHIVED_USER_ID,
        })),
        delete: vi.fn(async (_arg: unknown) => {
          throw p2025();
        }),
      },
      eventLog: { create: auditCreate },
    });

    const result = await adminPurgeDeletedUser_IO({
      user_id: ARCHIVED_USER_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_NOT_FOUND');
    }
    // Exactly one purge is recorded — the loser must not double-audit.
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('genuine DB error on delete → DATABASE_ERROR (never a throw)', async () => {
    mockDb({
      deletedUser: {
        findUnique: vi.fn(async (_arg: unknown) => ({
          user_id: ARCHIVED_USER_ID,
        })),
        delete: vi.fn(async (_arg: unknown) => {
          throw new Error('connection reset');
        }),
      },
    });

    const result = await adminPurgeDeletedUser_IO({
      user_id: ARCHIVED_USER_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});
