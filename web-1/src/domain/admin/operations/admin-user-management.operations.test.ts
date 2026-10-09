/**
 * ADMIN USER-MANAGEMENT unit tests — adminDisableUserAny_IO (+ the shared
 * RBAC/protection guard behavior). Sibling suites (split for the max-lines
 * budget, same seams): admin-user-management.enable.test.ts,
 * admin-user-management.plan-change.test.ts, admin-user-management.delete.test.ts.
 *
 * The admin op runs REAL through the user-administration facade down to the user
 * domain primitive (disableUser_IO) against the global setup DB proxy (mockDb) —
 * so the assertions cover the true WHERE scoping and write payloads, not a
 * re-mocked seam. Only side-channel transports are module-mocked (Stripe cancel,
 * Cloudinary cleanup, visit-photo collection, newsletter cleanup, logger).
 *
 * Behavior under test:
 *  - RBAC + protection guards: non-admin caller rejected; self-target and
 *    MASTER_ADMIN target rejected (ADMIN_TARGET_PROTECTED) with ZERO mutations;
 *  - disable: CAS WHERE {id, disabled_at:null} (idempotency guard), cascade
 *    account_status=NOT_ACTIVE, session evict — all scoped to the target;
 *    audit USER_DISABLED emitted ONLY on a real state flip (no-op/lost CAS → none).
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  makeStylistCurrentUser,
  makeUser,
  makeStylistAccount,
} from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';
import type {
  StylistAccount,
  User,
} from '@kernel/models/db_models.generated.dto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

const { cancelStripeSubscriptionIfExists } = vi.hoisted(() => ({
  cancelStripeSubscriptionIfExists: vi.fn(async (_arg: unknown) => undefined),
}));
vi.mock('@app/stripe/customer.operations', () => ({
  cancelStripeSubscriptionIfExists,
}));

const { cleanupCloudinaryAssets } = vi.hoisted(() => ({
  cleanupCloudinaryAssets: vi.fn(),
}));
vi.mock('@domain/gallery/operations/gallery-cloudinary-cleanup', () => ({
  cleanupCloudinaryAssets,
}));

const { collectVisitResultPhotoUrlsForUser_IO } = vi.hoisted(() => ({
  collectVisitResultPhotoUrlsForUser_IO: vi.fn(
    async (): Promise<string[]> => []
  ),
}));
vi.mock('@domain/visit/operations/visit-result-photo.operations', () => ({
  collectVisitResultPhotoUrlsForUser_IO,
}));

const { cleanupNewsletterSubscriberByEmail } = vi.hoisted(() => ({
  cleanupNewsletterSubscriberByEmail: vi.fn(async (_arg: unknown) => undefined),
}));
vi.mock('@domain/user/operations/user-mutations.operations', () => ({
  cleanupNewsletterSubscriberByEmail,
}));

import { adminDisableUserAny_IO } from './admin-user-management.operations';

const ADMIN_ID = 'usr_admin_000000000000001';
const TARGET_ID = 'usr_target_00000000000001';

const adminCaller = makeStylistCurrentUser({
  user: { id: ADMIN_ID, role_id: SystemRoleId.MASTER_ADMIN },
});
const nonAdminCaller = makeStylistCurrentUser({
  user: { id: 'usr_pleb_0000000000000001', role_id: SystemRoleId.STYLIST_ROLE },
});

type RawTargetRow = Record<string, unknown>;

/** Raw DB row for user.findUnique(include) — fixture-typed, relations attached. */
const makeTargetRaw = (
  userOv: Partial<User> = {},
  acctOv: Partial<StylistAccount> | null = {}
): RawTargetRow => {
  const user = makeUser({
    id: TARGET_ID,
    email: 'target@test.local',
    ...userOv,
  });
  return {
    ...user,
    stylist_account:
      acctOv === null
        ? null
        : makeStylistAccount({ created_by_user_id: user.id, ...acctOv }),
    client_account: null,
    sessions: [],
    favorite_stylists: [],
    favorite_records: [],
  };
};

/**
 * user.findUnique dispatcher: `select` calls = the protection role-lookup,
 * `include`/plain calls = getUser_IO / in-tx fresh reads (served from a queue;
 * the last row repeats).
 */
const makeUserFindUnique = ({
  roleRow,
  includeRows,
}: {
  roleRow: { role_id: string } | null;
  includeRows: (RawTargetRow | null)[];
}) => {
  const queue = [...includeRows];
  return vi.fn(async (args: { select?: Record<string, unknown> }) => {
    if (args.select) {
      return roleRow;
    }
    return queue.length > 1 ? (queue.shift() ?? null) : (queue[0] ?? null);
  });
};

const eventLogCreate = () =>
  vi.fn(async (args: { data: Record<string, unknown> }) => ({
    event_log_id: 'evl_test_1',
    created_at: new Date(),
    ...args.data,
  }));

describe('adminDisableUserAny_IO', () => {
  it('non-admin caller → ADMIN_INSUFFICIENT_PERMISSIONS, zero DB access', async () => {
    mockDb({});
    const result = await adminDisableUserAny_IO({
      target_id: TARGET_ID,
      currentUser: nonAdminCaller,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_INSUFFICIENT_PERMISSIONS');
    }
  });

  it('self-target → ADMIN_TARGET_PROTECTED (ADMIN_CANNOT_TARGET_SELF), no lookup, no mutation', async () => {
    const findUnique = vi.fn(async (_arg: unknown) => null);
    const updateMany = vi.fn(async (_arg: unknown) => ({ count: 0 }));
    mockDb({ user: { findUnique, updateMany } });

    const result = await adminDisableUserAny_IO({
      target_id: ADMIN_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_PROTECTED');
      if (result.error.type === 'ADMIN_TARGET_PROTECTED') {
        expect(result.error.reason).toBe('ADMIN_CANNOT_TARGET_SELF');
      }
    }
    expect(findUnique).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('MASTER_ADMIN target → ADMIN_TARGET_PROTECTED (ADMIN_CANNOT_TARGET_ADMIN), no mutation', async () => {
    const updateMany = vi.fn(async (_arg: unknown) => ({ count: 0 }));
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.MASTER_ADMIN },
          includeRows: [makeTargetRaw()],
        }),
        updateMany,
      },
    });

    const result = await adminDisableUserAny_IO({
      target_id: TARGET_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_PROTECTED');
      if (result.error.type === 'ADMIN_TARGET_PROTECTED') {
        expect(result.error.reason).toBe('ADMIN_CANNOT_TARGET_ADMIN');
      }
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('unknown target → ADMIN_TARGET_NOT_FOUND', async () => {
    mockDb({
      user: {
        findUnique: makeUserFindUnique({ roleRow: null, includeRows: [null] }),
      },
    });

    const result = await adminDisableUserAny_IO({
      target_id: TARGET_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_NOT_FOUND');
    }
  });

  it('happy path: CAS-guarded disable scoped to target, cascade NOT_ACTIVE, session evict, audit USER_DISABLED', async () => {
    const targetRaw = makeTargetRaw();
    const userUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    const accountUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    const sessionDeleteMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    const auditCreate = eventLogCreate();
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.STYLIST_ROLE },
          includeRows: [targetRaw],
        }),
        updateMany: userUpdateMany,
      },
      stylistAccount: { updateMany: accountUpdateMany },
      session: { deleteMany: sessionDeleteMany },
      impersonationBackup: { findUnique: vi.fn(async (_arg: unknown) => null) },
      eventLog: { create: auditCreate },
    });

    const result = await adminDisableUserAny_IO({
      target_id: TARGET_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toBeNull();
    }

    // CAS write: scoped to the target + idempotency guard disabled_at:null.
    const disableArgs = userUpdateMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      data: { is_active: boolean; disabled_at: Date };
    };
    expect(disableArgs.where).toEqual({ id: TARGET_ID, disabled_at: null });
    expect(disableArgs.data.is_active).toBe(false);
    expect(disableArgs.data.disabled_at).toBeInstanceOf(Date);

    // Cascade: public visibility down, scoped to the target's account.
    const cascadeArgs = accountUpdateMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(cascadeArgs.where).toEqual({ created_by_user_id: TARGET_ID });
    expect(cascadeArgs.data).toEqual({
      account_status: AccountStatusValue.NOT_ACTIVE,
    });

    // Session evict scoped to the target.
    const evictArgs = sessionDeleteMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
    };
    expect(evictArgs.where).toEqual({ userId: TARGET_ID });

    // Audit emitted exactly once, keyed by the acting admin.
    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditArgs = auditCreate.mock.calls[0]?.[0] as unknown as {
      data: { event: string; created_by_user_id: string };
    };
    expect(auditArgs.data.event).toBe(APP_EVENTS.INFO.USER.USER_DISABLED);
    expect(auditArgs.data.created_by_user_id).toBe(ADMIN_ID);
  });

  it('idempotent no-op (already disabled / lost CAS): success(null), NO audit, NO cascade, NO session evict', async () => {
    const accountUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 0 }));
    const sessionDeleteMany = vi.fn(async (_arg: unknown) => ({ count: 0 }));
    const auditCreate = eventLogCreate();
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.STYLIST_ROLE },
          includeRows: [makeTargetRaw({ disabled_at: new Date() })],
        }),
        updateMany: vi.fn(async (_arg: unknown) => ({ count: 0 })),
      },
      stylistAccount: { updateMany: accountUpdateMany },
      session: { deleteMany: sessionDeleteMany },
      eventLog: { create: auditCreate },
    });

    const result = await adminDisableUserAny_IO({
      target_id: TARGET_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
    expect(auditCreate).not.toHaveBeenCalled();
    expect(accountUpdateMany).not.toHaveBeenCalled();
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });
});
