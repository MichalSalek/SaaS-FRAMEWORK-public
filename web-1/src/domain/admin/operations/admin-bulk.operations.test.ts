vi.mock('@domain/email/operations/free-email.salon-access', () => ({
  finishFreeForSalonOwners_IO: vi.fn(async () => undefined),
}));
/**
 * adminBulkDisable_IO / adminBulkEnable_IO / adminBulkLogout_IO via mockDb.
 * Change-plan lives in admin-bulk-change-plan.operations.test.ts.
 * A non-admin caller gets ADMIN_INSUFFICIENT_PERMISSIONS and zero DB access.
 * Mutations target exactly the filtered non-admin ids (lookup take: 500).
 * MASTER_ADMIN targets are skipped. Disable sets account_status=NOT_ACTIVE.
 * Enable sets ACTIVE only when the account may be public, and never resurrects
 * a soft-deleted row. Not-found errors are deduped. A DB failure is DATABASE_ERROR.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  AccountStatusValue,
  PaymentStatusValue,
} from '@kernel/models/db_models.generated.dto';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

// Import-chain seam only for this file's suites (the bulk module imports the
// Stripe cancel at module load; the change-plan suite that exercises it lives in
// admin-bulk-change-plan.operations.test.ts).
vi.mock('@app/stripe/customer.operations', () => ({
  cancelStripeSubscriptionIfExists: vi.fn(async () => undefined),
}));

import {
  adminBulkDisable_IO,
  adminBulkEnable_IO,
  adminBulkLogout_IO,
} from './admin-bulk.operations';

const ADMIN_ID = 'usr_admin_000000000000001';
const STYLIST_ID = 'usr_stylist_00000000000001';
const OTHER_ADMIN_ID = 'usr_admin_000000000000002';
const GHOST_ID = 'usr_ghost_0000000000000001';

const adminCaller = makeStylistCurrentUser({
  user: { id: ADMIN_ID, role_id: SystemRoleId.MASTER_ADMIN },
});
const nonAdminCaller = makeStylistCurrentUser({
  user: { id: STYLIST_ID, role_id: SystemRoleId.STYLIST_ROLE },
});

/** DB user rows returned by filterAdminUsers' findMany. */
const foundUsers = [
  { id: STYLIST_ID, role_id: SystemRoleId.STYLIST_ROLE },
  { id: OTHER_ADMIN_ID, role_id: SystemRoleId.MASTER_ADMIN },
];

const eventLogStub = {
  create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
    event_log_id: 'evl_test_1',
    created_at: new Date(),
    ...args.data,
  })),
};

describe('adminBulkDisable_IO', () => {
  it('non-admin caller → ADMIN_INSUFFICIENT_PERMISSIONS, zero DB access', async () => {
    const findMany = vi.fn(async () => foundUsers);
    const updateMany = vi.fn(async () => ({ count: 0 }));
    mockDb({
      user: { findMany, updateMany },
    });

    const result = await adminBulkDisable_IO({
      user_ids: [STYLIST_ID],
      currentUser: nonAdminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_INSUFFICIENT_PERMISSIONS');
    }
    expect(findMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('empty user_ids → success {affected:0, skipped:0, errors:[]} without any DB call', async () => {
    const findMany = vi.fn(async () => foundUsers);
    mockDb({ user: { findMany } });

    const result = await adminBulkDisable_IO({
      user_ids: [],
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ affected: 0, skipped: 0, errors: [] });
    }
    expect(findMany).not.toHaveBeenCalled();
  });

  it('scopes ALL three writes to the exact non-admin ids, skips the admin target, bounded lookup', async () => {
    const findMany = vi.fn(async (_arg: unknown) => foundUsers);
    const userUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    const accountUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    const sessionDeleteMany = vi.fn(async (_arg: unknown) => ({ count: 2 }));
    mockDb({
      user: { findMany, updateMany: userUpdateMany },
      stylistAccount: { updateMany: accountUpdateMany },
      session: { deleteMany: sessionDeleteMany },
      eventLog: eventLogStub,
    });

    const result = await adminBulkDisable_IO({
      user_ids: [STYLIST_ID, OTHER_ADMIN_ID],
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.affected).toBe(1);
      expect(result.data.skipped).toBe(1); // MASTER_ADMIN target never mutated
      expect(result.data.errors).toEqual([]);
    }

    // Bounded target lookup — no unbounded scan.
    const lookupArgs = findMany.mock.calls[0]?.[0] as unknown as {
      where: { id: { in: string[] } };
      take: number;
    };
    expect(lookupArgs.take).toBe(500);
    expect(lookupArgs.where.id.in).toEqual([STYLIST_ID, OTHER_ADMIN_ID]);

    // Primary write: EXACT non-admin scoping + idempotency guard is_active:true.
    const disableArgs = userUpdateMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      data: { is_active: boolean; disabled_at: Date };
    };
    expect(disableArgs.where).toEqual({
      id: { in: [STYLIST_ID] },
      is_active: true,
    });
    expect(disableArgs.data.is_active).toBe(false);
    expect(disableArgs.data.disabled_at).toBeInstanceOf(Date);

    // Cascade: public visibility down, scoped to the same ids, UNCONDITIONAL.
    const cascadeArgs = accountUpdateMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(cascadeArgs.where).toEqual({
      created_by_user_id: { in: [STYLIST_ID] },
    });
    expect(cascadeArgs.data).toEqual({
      account_status: AccountStatusValue.NOT_ACTIVE,
    });

    // Session evict scoped to the same ids.
    const evictArgs = sessionDeleteMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
    };
    expect(evictArgs.where).toEqual({ userId: { in: [STYLIST_ID] } });
  });

  it('dedupes not-found errors over unique input ids ([X, X, ghost] → single ghost error)', async () => {
    mockDb({
      user: {
        findMany: async () => [
          { id: STYLIST_ID, role_id: SystemRoleId.STYLIST_ROLE },
        ],
        updateMany: async () => ({ count: 1 }),
      },
      stylistAccount: { updateMany: async () => ({ count: 1 }) },
      session: { deleteMany: async () => ({ count: 0 }) },
      eventLog: eventLogStub,
    });

    const result = await adminBulkDisable_IO({
      user_ids: [STYLIST_ID, STYLIST_ID, GHOST_ID],
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errors).toEqual([
        { user_id: GHOST_ID, reason: 'User not found' },
      ]);
    }
  });

  it('DB failure → DATABASE_ERROR result (never a throw)', async () => {
    mockDb({
      user: {
        findMany: async () => {
          throw new Error('connection reset');
        },
      },
    });

    const result = await adminBulkDisable_IO({
      user_ids: [STYLIST_ID],
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});

describe('adminBulkEnable_IO', () => {
  it('WHERE carries the soft-delete guard (deleted_at:null) and clears the full ban-marker set', async () => {
    const userUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    const accountUpdateMany = vi.fn(async () => ({ count: 1 }));
    mockDb({
      user: {
        findMany: async () => [
          { id: STYLIST_ID, role_id: SystemRoleId.STYLIST_ROLE },
        ],
        updateMany: userUpdateMany,
      },
      stylistAccount: { updateMany: accountUpdateMany },
      eventLog: eventLogStub,
    });

    const result = await adminBulkEnable_IO({
      user_ids: [STYLIST_ID],
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    const enableArgs = userUpdateMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };

    expect(enableArgs.where).toEqual({
      id: { in: [STYLIST_ID] },
      is_active: false,
      deleted_at: null,
    });
    // disabled_at MUST be cleared lockstep with is_active (stale ban-marker drift).
    expect(enableArgs.data).toEqual({
      is_active: true,
      disabled_at: null,
      deleted_at: null,
      recovery_available: false,
    });
  });

  it('cascade lifts account_status=ACTIVE ONLY for eligible accounts (PAID | onboarded FREE) of re-enabled users', async () => {
    const accountUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    mockDb({
      user: {
        findMany: async () => [
          { id: STYLIST_ID, role_id: SystemRoleId.STYLIST_ROLE },
        ],
        updateMany: async () => ({ count: 1 }),
      },
      stylistAccount: { updateMany: accountUpdateMany },
      eventLog: eventLogStub,
    });

    await adminBulkEnable_IO({
      user_ids: [STYLIST_ID],
      currentUser: adminCaller,
    });

    const cascadeArgs = accountUpdateMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(cascadeArgs.where).toEqual({
      created_by_user_id: { in: [STYLIST_ID] },
      // Relation guard: only rows whose user really came back (not soft-deleted).
      created_by_user: { is_active: true, deleted_at: null },
      // CAN_USER_HAVE_ACTIVE_ACCOUNT replicated: PAID or onboarded Free.
      OR: [
        { payment_status: PaymentStatusValue.PAID },
        {
          pricing_plan: PricingPlanValue.FREE,
          plan_selected_at: { not: null },
        },
      ],
    });
    expect(cascadeArgs.data).toEqual({
      account_status: AccountStatusValue.ACTIVE,
    });
  });

  it('non-admin caller → ADMIN_INSUFFICIENT_PERMISSIONS', async () => {
    mockDb({});
    const result = await adminBulkEnable_IO({
      user_ids: [STYLIST_ID],
      currentUser: nonAdminCaller,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_INSUFFICIENT_PERMISSIONS');
    }
  });
});

describe('adminBulkLogout_IO', () => {
  it('deletes sessions scoped to non-admin ids only; admin targets skipped', async () => {
    const sessionDeleteMany = vi.fn(async (_arg: unknown) => ({ count: 3 }));
    mockDb({
      user: { findMany: async () => foundUsers },
      session: { deleteMany: sessionDeleteMany },
      eventLog: eventLogStub,
    });

    const result = await adminBulkLogout_IO({
      user_ids: [STYLIST_ID, OTHER_ADMIN_ID],
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ affected: 1, sessionsDeleted: 3 });
    }
    const evictArgs = sessionDeleteMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
    };
    expect(evictArgs.where).toEqual({ userId: { in: [STYLIST_ID] } });
  });

  it('non-admin caller → ADMIN_INSUFFICIENT_PERMISSIONS, no session deletes', async () => {
    const sessionDeleteMany = vi.fn(async () => ({ count: 0 }));
    mockDb({ session: { deleteMany: sessionDeleteMany } });

    const result = await adminBulkLogout_IO({
      user_ids: [STYLIST_ID],
      currentUser: nonAdminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_INSUFFICIENT_PERMISSIONS');
    }
    expect(sessionDeleteMany).not.toHaveBeenCalled();
  });

  it('empty user_ids → success {affected:0, sessionsDeleted:0} without DB access', async () => {
    mockDb({});
    const result = await adminBulkLogout_IO({
      user_ids: [],
      currentUser: adminCaller,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ affected: 0, sessionsDeleted: 0 });
    }
  });
});
