/**
 * ADMIN USER-MANAGEMENT unit tests — adminChangePricingPlan_IO (sibling of
 * admin-user-management.operations.test.ts; split for the max-lines budget,
 * same seams — see that file's header for the shared setup rationale).
 *
 * Behavior under test:
 *  - soft-deleted target → 404 USER (billing on a GDPR-pending account is never
 *    mutated); orphan stylist-account (role_client leftover) / missing account
 *    → 404 ACCOUNT;
 *  - the nested stylist_account.update pins admin_plan_override=true ATOMICALLY
 *    with the plan write, FREE⇒UNPAID (never FREE+PAID), Stripe-owned dates
 *    nulled; the reactivation cascade runs for the target;
 *  - FREE additionally cancels a live Stripe subscription (orphaned-sub /
 *    ghost-double-billing guard) — paid plans never do;
 *  - self-target rejected BEFORE any DB access; audit carries old/new plan.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  makeStylistCurrentUser,
  makeUser,
  makeStylistAccount,
} from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  PaymentStatusValue,
  AccountTypeValue,
} from '@kernel/models/db_models.generated.dto';
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

// Remaining side-channels — import-chain seams (not asserted in this suite).
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

import { adminChangePricingPlan_IO } from './admin-user-management.operations';

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
describe('adminChangePricingPlan_IO', () => {
  it('soft-deleted target → ADMIN_TARGET_NOT_FOUND (USER), billing never mutated', async () => {
    const userUpdate = vi.fn(async (_arg: unknown) => makeTargetRaw());
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.STYLIST_ROLE },
          includeRows: [
            makeTargetRaw({ deleted_at: new Date('2026-06-01T00:00:00.000Z') }),
          ],
        }),
        update: userUpdate,
      },
    });

    const result = await adminChangePricingPlan_IO({
      target_id: TARGET_ID,
      pricing_plan: PricingPlanValue.PRO,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_NOT_FOUND');
      if (result.error.type === 'ADMIN_TARGET_NOT_FOUND') {
        expect(result.error.targetType).toBe('USER');
      }
    }
    expect(userUpdate).not.toHaveBeenCalled();
    expect(cancelStripeSubscriptionIfExists).not.toHaveBeenCalled();
  });

  it('orphan stylist-account (role_client leftover) → ADMIN_TARGET_NOT_FOUND (ACCOUNT), no mutation', async () => {
    const userUpdate = vi.fn(async (_arg: unknown) => makeTargetRaw());
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.CLIENT_ROLE },
          includeRows: [
            makeTargetRaw({
              role_id: SystemRoleId.CLIENT_ROLE,
              account_type: AccountTypeValue.CLIENT,
            }),
          ],
        }),
        update: userUpdate,
      },
    });

    const result = await adminChangePricingPlan_IO({
      target_id: TARGET_ID,
      pricing_plan: PricingPlanValue.PRO,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_NOT_FOUND');
      if (result.error.type === 'ADMIN_TARGET_NOT_FOUND') {
        expect(result.error.targetType).toBe('ACCOUNT');
      }
    }
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('stylist WITHOUT stylist_account → ADMIN_TARGET_NOT_FOUND (ACCOUNT)', async () => {
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.STYLIST_ROLE },
          includeRows: [makeTargetRaw({}, null)],
        }),
      },
    });

    const result = await adminChangePricingPlan_IO({
      target_id: TARGET_ID,
      pricing_plan: PricingPlanValue.PRO,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_NOT_FOUND');
      if (result.error.type === 'ADMIN_TARGET_NOT_FOUND') {
        expect(result.error.targetType).toBe('ACCOUNT');
      }
    }
  });

  it('paid plan (PRO): atomic nested write pins override, PAID, dates nulled; cascade runs; NO Stripe cancel; audit with old/new plan', async () => {
    const targetRaw = makeTargetRaw(
      {},
      { pricing_plan: PricingPlanValue.FREE }
    );
    const updatedRaw = makeTargetRaw(
      {},
      { pricing_plan: PricingPlanValue.PRO, admin_plan_override: true }
    );
    const userUpdate = vi.fn(async (_arg: unknown) => updatedRaw);
    const accountUpdateMany = vi.fn(async (_arg: unknown) => ({ count: 1 }));
    const auditCreate = eventLogCreate();
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.STYLIST_ROLE },
          includeRows: [targetRaw],
        }),
        update: userUpdate,
      },
      stylistAccount: { updateMany: accountUpdateMany },
      eventLog: { create: auditCreate },
    });

    const result = await adminChangePricingPlan_IO({
      target_id: TARGET_ID,
      pricing_plan: PricingPlanValue.PRO,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);

    // The financial write: scoped to the target user, nested account update with
    // the override flag IN THE SAME write (atomicity guarantee, OWNER-001).
    const updateArgs = userUpdate.mock.calls[0]?.[0] as unknown as {
      where: { id: string };
      data: { stylist_account: { update: Record<string, unknown> } };
    };
    expect(updateArgs.where).toEqual({ id: TARGET_ID });
    expect(updateArgs.data.stylist_account.update).toEqual({
      payment_status: PaymentStatusValue.PAID,
      account_expiration_date: null,
      upcoming_payment_date: null,
      pricing_plan: PricingPlanValue.PRO,
      admin_plan_override: true,
    });

    // Payment-invariant seam: reactivation cascade runs for the target.
    const cascadeArgs = accountUpdateMany.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
    };
    expect(cascadeArgs.where).toEqual(
      expect.objectContaining({ created_by_user_id: { in: [TARGET_ID] } })
    );

    // Paid→paid/paid-set never touches Stripe from this op.
    expect(cancelStripeSubscriptionIfExists).not.toHaveBeenCalled();

    expect(auditCreate).toHaveBeenCalledTimes(1);
    const auditArgs = auditCreate.mock.calls[0]?.[0] as unknown as {
      data: { event: string; event_payload: Record<string, unknown> };
    };
    expect(auditArgs.data.event).toBe(
      APP_EVENTS.INFO.ACCOUNT.PRICING_PLAN_CHANGED
    );
    expect(auditArgs.data.event_payload).toEqual(
      expect.objectContaining({
        target_id: TARGET_ID,
        old_plan: PricingPlanValue.FREE,
        new_plan: PricingPlanValue.PRO,
        admin_plan_override_set: true,
      })
    );
  });

  it('downgrade to FREE: payment_status=UNPAID (never FREE+PAID) + orphaned-sub guard cancels the Stripe subscription', async () => {
    const targetRaw = makeTargetRaw(
      {},
      {
        pricing_plan: PricingPlanValue.PRO,
        subscription_id: 'sub_live_1',
      }
    );
    const userUpdate = vi.fn(async (_arg: unknown) =>
      makeTargetRaw({}, { pricing_plan: PricingPlanValue.FREE })
    );
    mockDb({
      user: {
        findUnique: makeUserFindUnique({
          roleRow: { role_id: SystemRoleId.STYLIST_ROLE },
          includeRows: [targetRaw],
        }),
        update: userUpdate,
      },
      stylistAccount: {
        updateMany: vi.fn(async (_arg: unknown) => ({ count: 1 })),
      },
      eventLog: { create: eventLogCreate() },
    });

    const result = await adminChangePricingPlan_IO({
      target_id: TARGET_ID,
      pricing_plan: PricingPlanValue.FREE,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    const updateArgs = userUpdate.mock.calls[0]?.[0] as unknown as {
      data: { stylist_account: { update: Record<string, unknown> } };
    };
    expect(updateArgs.data.stylist_account.update).toEqual(
      expect.objectContaining({
        pricing_plan: PricingPlanValue.FREE,
        payment_status: PaymentStatusValue.UNPAID,
        admin_plan_override: true,
      })
    );

    // Ghost double-billing guard: live sub must be canceled on FREE downgrade.
    expect(cancelStripeSubscriptionIfExists).toHaveBeenCalledTimes(1);
    expect(cancelStripeSubscriptionIfExists).toHaveBeenCalledWith(TARGET_ID);
  });

  it('self-target → ADMIN_TARGET_PROTECTED before ANY DB access', async () => {
    const findUnique = vi.fn(async (_arg: unknown) => null);
    mockDb({ user: { findUnique } });

    const result = await adminChangePricingPlan_IO({
      target_id: ADMIN_ID,
      pricing_plan: PricingPlanValue.FREE,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_TARGET_PROTECTED');
    }
    expect(findUnique).not.toHaveBeenCalled();
  });
});
