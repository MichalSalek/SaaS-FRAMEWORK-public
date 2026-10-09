/**
 * ADMIN BULK CHANGE-PLAN unit tests — adminBulkChangePlan_IO (the FINANCIAL bulk
 * op; split out of admin-bulk.operations.test.ts for the max-lines budget).
 *
 * Drives the REAL operation through the global setup DB proxy (mockDb):
 *
 *  - eligibility fence: no-account / orphan (role_client leftover) / soft-deleted
 *    targets are rejected with per-id reasons and NEVER written;
 *  - WHERE scoping: the plan write targets EXACTLY the eligible ids (no unbounded
 *    update of stylistAccount);
 *  - paid plan: pins admin_plan_override=true + payment_status=PAID atomically,
 *    nulls the Stripe-owned dates; NO Stripe cancel;
 *  - BULK DOWNGRADE (FREE): payment_status=UNPAID (never FREE+PAID) and the
 *    orphaned-sub guard schedules cancelStripeSubscriptionIfExists per eligible
 *    id AFTER the response (runAfterResponse) — zero eligible → zero cancels;
 *  - BULK DOWNGRADE (FREE), durability: trwały wiersz cancel-reconcile na każde
 *    kwalifikujące się konto z żywą subskrypcją powstaje W TRANSAKCJI planu (przed
 *    jakimkolwiek cancelem), a każdy cancel dostaje OSOBNY task runAfterResponse;
 *  - reactivation cascade runs AFTER the plan write with the eligibility predicate;
 *  - RBAC: non-admin caller → ADMIN_INSUFFICIENT_PERMISSIONS, zero writes.
 *
 * runAfterResponse is re-mocked per-file (overrides the setup no-op) so the
 * FREE-downgrade Stripe-cancel loop is observable — tasks are captured and run
 * explicitly by the test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { makeStylistCurrentUser } from '../../../test-utils/fixtures';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  AccountStatusValue,
  PaymentStatusValue,
} from '@kernel/models/db_models.generated.dto';

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

const { cancelStripeSubscriptionIfExists } = vi.hoisted(() => ({
  cancelStripeSubscriptionIfExists: vi.fn(async () => undefined),
}));
vi.mock('@app/stripe/customer.operations', () => ({
  cancelStripeSubscriptionIfExists,
}));

// Capture fire-and-forget tasks instead of the setup no-op, so the FREE-downgrade
// Stripe-cancel loop (scheduled via runAfterResponse) can be executed + asserted.
const afterResponse = vi.hoisted(() => ({
  tasks: [] as (() => Promise<unknown>)[],
}));
vi.mock('@app/runtime/run-after-response', () => ({
  runAfterResponse: (task: () => Promise<unknown>): void => {
    afterResponse.tasks.push(task);
  },
}));

import { adminBulkChangePlan_IO } from './admin-bulk.operations';

const ADMIN_ID = 'usr_admin_000000000000001';
const U_OK = 'usr_ok_00000000000000001';
const U_OK2 = 'usr_ok_00000000000000002';
const U_NO_ACCT = 'usr_noacct_0000000000001';
const U_ORPHAN = 'usr_orphan_0000000000001';
const U_DELETED = 'usr_deleted_000000000001';

const adminCaller = makeStylistCurrentUser({
  user: { id: ADMIN_ID, role_id: SystemRoleId.MASTER_ADMIN },
});
const nonAdminCaller = makeStylistCurrentUser({
  user: {
    id: 'usr_pleb_0000000000000001',
    role_id: SystemRoleId.STYLIST_ROLE,
  },
});

const eventLogStub = {
  create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
    event_log_id: 'evl_test_1',
    created_at: new Date(),
    ...args.data,
  })),
};

const runScheduledTasks = async (): Promise<void> => {
  for (const task of afterResponse.tasks) {
    await task();
  }
};

const SUB_OK = 'sub_test_ok_1';
const SUB_OK2 = 'sub_test_ok_2';

// Synthetic StripeEvent rows = the durable cancel-reconcile dead-letter written
// INSIDE the plan transaction (admin-bulk-cancel-reconcile.helper).
const reconcileDeleteMany = vi.fn(async (_arg: unknown) => ({ count: 0 }));
const reconcileCreateMany = vi.fn(
  async (arg: { data: { event_id: string }[] }) => ({ count: arg.data.length })
);

beforeEach(() => {
  afterResponse.tasks.length = 0;
  cancelStripeSubscriptionIfExists.mockClear();
  reconcileDeleteMany.mockClear();
  reconcileCreateMany.mockClear();
});

const installChangePlanDb = () => {
  const planWrite = vi.fn(async (_arg: unknown) => ({ count: 1 }));
  // stylistAccount.updateMany serves BOTH the plan write and the cascade —
  // distinguish by call order / args in assertions.
  const allUsers = [
    { id: U_OK, role_id: SystemRoleId.STYLIST_ROLE },
    { id: U_OK2, role_id: SystemRoleId.STYLIST_ROLE },
    { id: U_NO_ACCT, role_id: SystemRoleId.STYLIST_ROLE },
    { id: U_ORPHAN, role_id: SystemRoleId.CLIENT_ROLE },
    { id: U_DELETED, role_id: SystemRoleId.STYLIST_ROLE },
  ];
  mockDb({
    user: {
      // Honors the `id IN (...)` filter — the op's scoping depends on it.
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        allUsers.filter(u => args.where.id.in.includes(u.id)),
    },
    stylistAccount: {
      findMany: async () => [
        {
          created_by_user_id: U_OK,
          subscription_id: SUB_OK,
          created_by_user: {
            role_id: SystemRoleId.STYLIST_ROLE,
            deleted_at: null,
          },
        },
        {
          created_by_user_id: U_OK2,
          subscription_id: SUB_OK2,
          created_by_user: {
            role_id: SystemRoleId.STYLIST_ROLE,
            deleted_at: null,
          },
        },
        {
          created_by_user_id: U_ORPHAN,
          subscription_id: null,
          created_by_user: {
            role_id: SystemRoleId.CLIENT_ROLE,
            deleted_at: null,
          },
        },
        {
          created_by_user_id: U_DELETED,
          subscription_id: null,
          created_by_user: {
            role_id: SystemRoleId.STYLIST_ROLE,
            deleted_at: new Date('2026-06-01T00:00:00.000Z'),
          },
        },
      ],
      updateMany: planWrite,
    },
    stripeEvent: {
      deleteMany: reconcileDeleteMany,
      createMany: reconcileCreateMany,
    },
    eventLog: eventLogStub,
  });
  return planWrite;
};

describe('adminBulkChangePlan_IO — financial bulk downgrade/upgrade', () => {
  it('eligibility: no-account / orphan / soft-deleted are rejected with reasons; write scoped to eligible ids ONLY', async () => {
    const planWrite = installChangePlanDb();

    const result = await adminBulkChangePlan_IO({
      user_ids: [U_OK, U_NO_ACCT, U_ORPHAN, U_DELETED],
      pricing_plan: PricingPlanValue.PRO,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.errors).toEqual(
        expect.arrayContaining([
          { user_id: U_NO_ACCT, reason: 'No stylist account' },
          {
            user_id: U_ORPHAN,
            reason: 'Not a stylist (orphan stylist account)',
          },
          { user_id: U_DELETED, reason: 'User is deleted' },
        ])
      );
      expect(result.data.errors).toHaveLength(3);
    }

    // FINANCIAL WRITE SCOPING: exactly the single eligible id — no unbounded update.
    const writeArgs = planWrite.mock.calls[0]?.[0] as unknown as {
      where: Record<string, unknown>;
    };
    expect(writeArgs.where).toEqual({ created_by_user_id: { in: [U_OK] } });
  });

  it('paid plan (PRO): pins admin_plan_override, payment_status=PAID, Stripe-owned dates nulled; NO Stripe cancel', async () => {
    const planWrite = installChangePlanDb();

    await adminBulkChangePlan_IO({
      user_ids: [U_OK],
      pricing_plan: PricingPlanValue.PRO,
      currentUser: adminCaller,
    });

    const writeArgs = planWrite.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(writeArgs.data).toEqual({
      pricing_plan: PricingPlanValue.PRO,
      admin_plan_override: true,
      payment_status: PaymentStatusValue.PAID,
      account_expiration_date: null,
      upcoming_payment_date: null,
    });

    await runScheduledTasks();
    expect(cancelStripeSubscriptionIfExists).not.toHaveBeenCalled();
  });

  it('BULK DOWNGRADE to FREE: payment_status=UNPAID (never FREE+PAID) + orphaned-sub guard cancels Stripe per eligible id', async () => {
    const planWrite = installChangePlanDb();

    const result = await adminBulkChangePlan_IO({
      user_ids: [U_OK],
      pricing_plan: PricingPlanValue.FREE,
      currentUser: adminCaller,
    });

    expect(result.success).toBe(true);
    const writeArgs = planWrite.mock.calls[0]?.[0] as unknown as {
      data: Record<string, unknown>;
    };
    expect(writeArgs.data).toEqual({
      pricing_plan: PricingPlanValue.FREE,
      admin_plan_override: true,
      payment_status: PaymentStatusValue.UNPAID,
      account_expiration_date: null,
      upcoming_payment_date: null,
    });

    // Ghost double-billing guard: cancel scheduled post-response, per eligible id.
    expect(cancelStripeSubscriptionIfExists).not.toHaveBeenCalled();
    await runScheduledTasks();
    expect(cancelStripeSubscriptionIfExists).toHaveBeenCalledTimes(1);
    expect(cancelStripeSubscriptionIfExists).toHaveBeenCalledWith(U_OK);
  });

  it('FREE: trwały wiersz cancel-reconcile powstaje PRZED jakimkolwiek cancelem (dead-letter first)', async () => {
    // Regresja: dead-letter zapisywał się WEWNĄTRZ helpera anulującego, więc istniał
    // tylko dla userów, do których pętla zdążyła dojść. Ogon batcha porzucony przez
    // redeploy zostawał FREE w bazie + żywa subskrypcja w Stripe, niewidoczna dla
    // żadnego sweepa (admin_plan_override wyłącza syncAccountWithStripe).
    installChangePlanDb();

    await adminBulkChangePlan_IO({
      user_ids: [U_OK, U_OK2],
      pricing_plan: PricingPlanValue.FREE,
      currentUser: adminCaller,
    });

    // Wiersze istnieją zaraz po odpowiedzi — zanim odpalimy JAKIKOLWIEK task.
    expect(cancelStripeSubscriptionIfExists).not.toHaveBeenCalled();
    expect(reconcileCreateMany).toHaveBeenCalledTimes(1);
    const createdRows = reconcileCreateMany.mock.calls[0]?.[0]?.data ?? [];
    expect(createdRows.map(row => row.event_id)).toEqual([
      `internal:cancel-reconcile-duplicate:${SUB_OK}:${U_OK}`,
      `internal:cancel-reconcile-duplicate:${SUB_OK2}:${U_OK2}`,
    ]);
    // Re-arming: stary wiersz dla tej samej subskrypcji jest kasowany przed wstawieniem.
    expect(reconcileDeleteMany).toHaveBeenCalledTimes(1);
  });

  it('FREE: cancele lecą JEDNĄ pulą o ograniczonej równoległości, po odpowiedzi', async () => {
    // Zastępuje wcześniejszy kontrakt „osobny task na każdy cancel". Tamten kształt
    // wystrzeliwał wszystkie anulowania naraz — do 100 (VALIDATION_BULK.MAX_USER_IDS)
    // równoległych `subscriptions.cancel` w kilka milisekund, czyli prosto w limit
    // zapisów Stripe'a. Pełne uzasadnienie: DECISION w admin-bulk.operations.ts.
    // Niezmienniki, które MUSZĄ zostać: nic nie leci przed odpowiedzią, każde
    // kwalifikujące się konto dostaje swój cancel, kolejność wejścia zachowana.
    installChangePlanDb();

    await adminBulkChangePlan_IO({
      user_ids: [U_OK, U_OK2],
      pricing_plan: PricingPlanValue.FREE,
      currentUser: adminCaller,
    });

    // 1 pula canceli + 1 audit-log = 2 taski (niezależnie od liczby kont).
    expect(afterResponse.tasks).toHaveLength(2);
    expect(cancelStripeSubscriptionIfExists).not.toHaveBeenCalled();

    await afterResponse.tasks[0]?.();

    expect(cancelStripeSubscriptionIfExists).toHaveBeenCalledTimes(2);
    expect(cancelStripeSubscriptionIfExists).toHaveBeenNthCalledWith(1, U_OK);
    expect(cancelStripeSubscriptionIfExists).toHaveBeenNthCalledWith(2, U_OK2);
  });

  it('FREE bez żywej subskrypcji → zero wierszy reconcile (ale cancel i tak zaplanowany)', async () => {
    // Subskrypcja mogła zostać dopięta webhookiem po odczycie kwalifikacyjnym, więc
    // pętla leci po WSZYSTKICH kwalifikujących się kontach (helper czyta świeżo);
    // trwałe zobowiązanie zapisujemy tylko dla tych, o których wiemy, że je mają.
    installChangePlanDb();
    mockDb({
      user: {
        findMany: async () => [
          { id: U_OK, role_id: SystemRoleId.STYLIST_ROLE },
        ],
      },
      stylistAccount: {
        findMany: async () => [
          {
            created_by_user_id: U_OK,
            subscription_id: null,
            created_by_user: {
              role_id: SystemRoleId.STYLIST_ROLE,
              deleted_at: null,
            },
          },
        ],
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      stripeEvent: {
        deleteMany: reconcileDeleteMany,
        createMany: reconcileCreateMany,
      },
      eventLog: eventLogStub,
    });

    await adminBulkChangePlan_IO({
      user_ids: [U_OK],
      pricing_plan: PricingPlanValue.FREE,
      currentUser: adminCaller,
    });

    expect(reconcileCreateMany).not.toHaveBeenCalled();
    await runScheduledTasks();
    expect(cancelStripeSubscriptionIfExists).toHaveBeenCalledWith(U_OK);
  });

  it('plan płatny (PRO): zero wierszy reconcile — downgrade paid→paid idzie proracją', async () => {
    installChangePlanDb();

    await adminBulkChangePlan_IO({
      user_ids: [U_OK],
      pricing_plan: PricingPlanValue.PRO,
      currentUser: adminCaller,
    });

    expect(reconcileCreateMany).not.toHaveBeenCalled();
    expect(reconcileDeleteMany).not.toHaveBeenCalled();
  });

  it('FREE with zero eligible ids → no Stripe cancel scheduled at all', async () => {
    installChangePlanDb();

    await adminBulkChangePlan_IO({
      user_ids: [U_NO_ACCT, U_ORPHAN, U_DELETED],
      pricing_plan: PricingPlanValue.FREE,
      currentUser: adminCaller,
    });

    await runScheduledTasks();
    expect(cancelStripeSubscriptionIfExists).not.toHaveBeenCalled();
  });

  it('runs the reactivation cascade AFTER the plan write, scoped to eligible ids with the eligibility predicate', async () => {
    const planWrite = installChangePlanDb();

    await adminBulkChangePlan_IO({
      user_ids: [U_OK],
      pricing_plan: PricingPlanValue.PRO,
      currentUser: adminCaller,
    });

    // Call 1 = plan write, call 2 = cascade (same model, different shape).
    expect(planWrite).toHaveBeenCalledTimes(2);
    const cascadeArgs = planWrite.mock.calls[1]?.[0] as unknown as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(cascadeArgs.where).toEqual({
      created_by_user_id: { in: [U_OK] },
      created_by_user: { is_active: true, deleted_at: null },
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

  it('non-admin caller → ADMIN_INSUFFICIENT_PERMISSIONS, no writes', async () => {
    const planWrite = installChangePlanDb();

    const result = await adminBulkChangePlan_IO({
      user_ids: [U_OK],
      pricing_plan: PricingPlanValue.FREE,
      currentUser: nonAdminCaller,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ADMIN_INSUFFICIENT_PERMISSIONS');
    }
    expect(planWrite).not.toHaveBeenCalled();
    await runScheduledTasks();
    expect(cancelStripeSubscriptionIfExists).not.toHaveBeenCalled();
  });
});
