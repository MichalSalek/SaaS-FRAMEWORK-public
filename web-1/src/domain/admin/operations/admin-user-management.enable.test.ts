/**
 * ADMIN USER-MANAGEMENT unit tests — adminEnableUserAny_IO (sibling of
 * admin-user-management.operations.test.ts; split for the max-lines budget,
 * same seams — see that file's header for the shared setup rationale).
 *
 * Behavior under test:
 *  - enable: soft-deleted target NEVER resurrected (USER_NOT_FOUND), CAS flip
 *    WHERE {id, deleted_at:null, NOT(already-enabled)}, the FULL ban-marker set
 *    cleared lockstep (disabled_at/deleted_at/recovery_available), cascade
 *    account_status=ACTIVE gated on the payment policy (PAID);
 *  - audit USER_ENABLED gated on the CAS result: already-enabled no-op and a
 *    lost concurrent CAS both return success(null) and emit NO audit row.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  makeStylistCurrentUser,
  makeUser,
  makeStylistAccount,
} from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import {
  AccountStatusValue,
  PaymentStatusValue,
} from '@kernel/models/db_models.generated.dto';
import type {
  StylistAccount,
  User,
} from '@kernel/models/db_models.generated.dto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

// Side-channel transports — import-chain seams (not asserted in this suite).
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('@app/stripe/customer.operations', () => ({
  cancelStripeSubscriptionIfExists: vi.fn(async () => undefined),
}));
vi.mock('@domain/gallery/operations/gallery-cloudinary-cleanup', () => ({
  cleanupCloudinaryAssets: vi.fn(),
}));
vi.mock('@domain/visit/operations/visit-result-photo.operations', () => ({
  collectVisitResultPhotoUrlsForUser_IO: vi.fn(
    async (): Promise<string[]> => []
  ),
}));
vi.mock('@domain/user/operations/user-mutations.operations', () => ({
  cleanupNewsletterSubscriberByEmail: vi.fn(async () => undefined),
}));

import { adminEnableUserAny_IO } from './admin-user-management.operations';

const ADMIN_ID = 'usr_admin_000000000000001';
const TARGET_ID = 'usr_target_00000000000001';

const adminCaller = makeStylistCurrentUser({
  user: { id: ADMIN_ID, role_id: SystemRoleId.MASTER_ADMIN },
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
describe('adminEnableUserAny_IO', () => {
  it('soft-deleted target is NEVER resurrected → USER_NOT_FOUND, no flip attempted', async () => {
    const userUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.STYLIST_ROLE },
          includeRows: [
            makeTargetRaw({
              is_active: false,
              deleted_at: new Date('2026-06-01T00:00:00.000Z'),
              recovery_available: true,
            }),
          ],
        }),
        updateMany: userUpdateMany,
      },
    });

    const result = await adminEnableUserAny_IO({
      target_id: TARGET_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('USER_NOT_FOUND');
    }
    expect(userUpdateMany).not.toHaveBeenCalled();
  });

  it('already-enabled target → idempotent success(null), NO audit, NO flip', async () => {
    const userUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    const auditCreate = eventLogCreate();
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.STYLIST_ROLE },
          includeRows: [makeTargetRaw()], // is_active:true, disabled_at:null
        }),
        updateMany: userUpdateMany,
      },
      eventLog: { create: auditCreate },
    });

    const result = await adminEnableUserAny_IO({
      target_id: TARGET_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
    expect(userUpdateMany).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it('happy re-enable: CAS flip clears the full ban-marker set, cascade ACTIVE (PAID policy), audit USER_ENABLED', async () => {
    const disabledRow = makeTargetRaw(
      { is_active: false, disabled_at: new Date('2026-06-01T00:00:00.000Z') },
      { payment_status: PaymentStatusValue.PAID }
    );
    const userUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    const accountUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    const auditCreate = eventLogCreate();
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.STYLIST_ROLE },
          includeRows: [disabledRow],
        }),
        updateMany: userUpdateMany,
      },
      stylistAccount: { updateMany: accountUpdateMany },
      eventLog: { create: auditCreate },
    });

    const result = await adminEnableUserAny_IO({
      target_id: TARGET_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toBeNull();
    }

    // CAS flip: scoped to the target, soft-delete belt-and-suspenders, negation
    // of the already-enabled state (exactly-once under concurrency).
    const flipArgs = userUpdateMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(flipArgs.where).toEqual({
      id: TARGET_ID,
      deleted_at: null,
      NOT: { disabled_at: null, is_active: true },
    });
    expect(flipArgs.data).toEqual({
      is_active: true,
      disabled_at: null,
      deleted_at: null,
      recovery_available: false,
    });

    // Cascade back to public visibility (policy allowed: PAID).
    const cascadeArgs = accountUpdateMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(cascadeArgs.where).toEqual({ created_by_user_id: TARGET_ID });
    expect(cascadeArgs.data).toEqual({
      account_status: AccountStatusValue.ACTIVE,
    });

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditArgs = auditCreate.mock.calls[0]?.[0] as unknown as {
      data: { event: string };
    };
    expect(auditArgs.data.event).toBe(APP_EVENTS.INFO.USER.USER_ENABLED);
  });

  it('lost CAS (concurrent enable won) → success(null), NO audit', async () => {
    const disabledRow = makeTargetRaw({
      is_active: false,
      disabled_at: new Date('2026-06-01T00:00:00.000Z'),
    });
    const auditCreate = eventLogCreate();
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.STYLIST_ROLE },
          includeRows: [disabledRow],
        }),
        updateMany: vi.fn(async (_arg: unknown) => ({ count: 0 })),
      },
      eventLog: { create: auditCreate },
    });

    const result = await adminEnableUserAny_IO({
      target_id: TARGET_ID,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
    expect(auditCreate).not.toHaveBeenCalled();
  });
});
