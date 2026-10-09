/**
 * checkAndDowngradeOverdueAccounts_IO unit tests — period-fence semantics.
 *
 * Locks in the current-cycle fence (DECISION in the operation): the dunning
 * cycle starts strictly AFTER the last STRIPE_INVOICE_PAYMENT_SUCCEEDED per
 * user. Both the grace clock (_min payment_failed) and the
 * EMAIL_DUNNING_AUTO_DOWNGRADE dedup are scoped to that cycle. Without the
 * fence: a recovered-then-refailed user was downgraded with ZERO grace, and a
 * single historical downgrade event disabled the sweep for that user FOREVER.
 *
 * The eventLog mocks are BEHAVIORAL: groupBy/findMany apply the where-clause
 * (event, event_type, OR current-cycle scope with `created_at.gt`) against an
 * in-memory event history — so removing the fence condition from the
 * operation changes what the mocks return and fails these tests; this is not
 * a literal argument snapshot.
 */

import { describe, it, expect, vi } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { TIME } from '@kernel/application/constants.config';
import {
  AccountStatusValue,
  EventLogTypeValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { mockDb } from '../../../test-utils/mockApiHandler';

// ── Module mocks (side-effect boundaries of the sweep) ─────────────────────────
const { updateAccountPlanStatus, recordAuditEvent_IO, reportIssueBackend } =
  vi.hoisted(() => ({
    updateAccountPlanStatus: vi.fn(
      async (_params: {
        accountId: string;
        pricingPlan: string;
        paymentStatus: string;
        accountStatus: string;
        subscriptionStatus: string;
      }) => true
    ),
    recordAuditEvent_IO: vi.fn(async () => undefined),
    reportIssueBackend: vi.fn(),
  }));

vi.mock('@app/stripe/plan-status-update.operations', () => ({
  updateAccountPlanStatus,
}));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO,
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend }));

import { checkAndDowngradeOverdueAccounts_IO } from './dunning-downgrade.operation';

// ── Event vocabulary + fixtures ─────────────────────────────────────────────────
const SUCCEEDED = APP_EVENTS.INFO.ACCOUNT.STRIPE_INVOICE_PAYMENT_SUCCEEDED;
const FAILED = APP_EVENTS.INFO.ACCOUNT.STRIPE_INVOICE_PAYMENT_FAILED;
const DOWNGRADED = APP_EVENTS.INFO.EMAIL.EMAIL_DUNNING_AUTO_DOWNGRADE;

const daysAgo = (days: number): Date =>
  new Date(Date.now() - days * TIME.MS_PER_DAY);

type EventRow = {
  event: string;
  event_type: string;
  created_by_user_id: string;
  created_at: Date;
};

const succeededAt = (userId: string, at: Date): EventRow => ({
  event: SUCCEEDED,
  event_type: EventLogTypeValue.ACCOUNT,
  created_by_user_id: userId,
  created_at: at,
});

const failedAt = (userId: string, at: Date): EventRow => ({
  event: FAILED,
  event_type: EventLogTypeValue.ACCOUNT,
  created_by_user_id: userId,
  created_at: at,
});

const downgradedAt = (userId: string, at: Date): EventRow => ({
  event: DOWNGRADED,
  event_type: EventLogTypeValue.EMAIL,
  created_by_user_id: userId,
  created_at: at,
});

const makeAccount = (userId: string) => ({
  account_id: `acc_${userId}`,
  pricing_plan: PricingPlanValue.PRO,
  account_status: AccountStatusValue.ACTIVE,
  subscription_status: SubscriptionStatusValue.PAST_DUE,
  subscription_id: `sub_${userId}`,
  cancel_at_period_end: false,
  cancel_at: null,
  current_period_end: daysAgo(1),
  created_by_user_id: userId,
});

// ── Behavioral eventLog stubs (apply the real where-clause in memory) ───────────
type CycleScope = {
  created_by_user_id: string;
  created_at?: { gt: Date };
};

const matchesScope = (row: EventRow, scopes: CycleScope[]): boolean =>
  scopes.some(
    scope =>
      scope.created_by_user_id === row.created_by_user_id &&
      (scope.created_at === undefined || row.created_at > scope.created_at.gt)
  );

const behavioralGroupBy = (history: EventRow[]) =>
  vi.fn(
    async (arg: {
      where: {
        event: string;
        event_type: string;
        created_by_user_id: { in: string[] };
      };
    }) => {
      const latest = new Map<string, Date>();
      history
        .filter(
          row =>
            row.event === arg.where.event &&
            row.event_type === arg.where.event_type &&
            arg.where.created_by_user_id.in.includes(row.created_by_user_id)
        )
        .forEach(row => {
          const previous = latest.get(row.created_by_user_id);
          if (!previous || row.created_at > previous) {
            latest.set(row.created_by_user_id, row.created_at);
          }
        });
      return [...latest.entries()].map(([userId, maxCreatedAt]) => ({
        created_by_user_id: userId,
        _max: { created_at: maxCreatedAt },
      }));
    }
  );

const behavioralFindMany = (history: EventRow[]) =>
  vi.fn(
    async (arg: {
      where: { event: string; event_type: string; OR: CycleScope[] };
    }) =>
      history
        .filter(
          row =>
            row.event === arg.where.event &&
            row.event_type === arg.where.event_type &&
            matchesScope(row, arg.where.OR)
        )
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .map(row => ({
          created_by_user_id: row.created_by_user_id,
          created_at: row.created_at,
        }))
  );

const arrange = (userIds: string[], history: EventRow[]): void => {
  mockDb({
    stylistAccount: {
      findMany: vi.fn(async () => userIds.map(makeAccount)),
    },
    eventLog: {
      groupBy: behavioralGroupBy(history),
      findMany: behavioralFindMany(history),
    },
  });
};

const lastPlanWrite = () => updateAccountPlanStatus.mock.calls.at(-1)?.[0];

// ── Tests ───────────────────────────────────────────────────────────────────────
describe('checkAndDowngradeOverdueAccounts_IO — current-cycle period fence', () => {
  it('fail AFTER the fence, older than 15 days → downgrade to FREE executed', async () => {
    arrange(
      ['usr_a'],
      [succeededAt('usr_a', daysAgo(30)), failedAt('usr_a', daysAgo(20))]
    );

    const downgraded = await checkAndDowngradeOverdueAccounts_IO();

    expect(downgraded).toBe(1);
    expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
    const write = lastPlanWrite();
    expect(write?.accountId).toBe('acc_usr_a');
    expect(write?.pricingPlan).toBe(PricingPlanValue.FREE);
    expect(write?.paymentStatus).toBe(PaymentStatusValue.UNPAID);
    expect(write?.subscriptionStatus).toBe(SubscriptionStatusValue.CANCELED);
    // DECISION in the operation: dunning-FREE stays ACTIVE (discovery-visible).
    expect(write?.accountStatus).toBe(AccountStatusValue.ACTIVE);
    expect(recordAuditEvent_IO).toHaveBeenCalledTimes(1);
    expect(recordAuditEvent_IO).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: DOWNGRADED })
    );
  });

  it('old fail BEFORE the fence + fresh fail <15d → NO downgrade (grace runs from the fresh fail)', async () => {
    // Recovered dunning months ago, refailed 5 days ago. Without the fence the
    // 40-day-old fail satisfies the cutoff and the user is downgraded with zero
    // grace — exactly the bug class the fence closes.
    arrange(
      ['usr_b'],
      [
        failedAt('usr_b', daysAgo(40)),
        succeededAt('usr_b', daysAgo(30)),
        failedAt('usr_b', daysAgo(5)),
      ]
    );

    const downgraded = await checkAndDowngradeOverdueAccounts_IO();

    expect(downgraded).toBe(0);
    expect(updateAccountPlanStatus).not.toHaveBeenCalled();
    expect(recordAuditEvent_IO).not.toHaveBeenCalled();
  });

  it('historical EMAIL_DUNNING_AUTO_DOWNGRADE before the fence does NOT dedup the current cycle', async () => {
    // Old cycle: fail → auto-downgrade event → payment recovered (fence).
    // Current cycle: fail 20 days ago. The stale downgrade event must not
    // disable the sweep forever.
    arrange(
      ['usr_c'],
      [
        failedAt('usr_c', daysAgo(60)),
        downgradedAt('usr_c', daysAgo(59)),
        succeededAt('usr_c', daysAgo(30)),
        failedAt('usr_c', daysAgo(20)),
      ]
    );

    const downgraded = await checkAndDowngradeOverdueAccounts_IO();

    expect(downgraded).toBe(1);
    expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
    expect(lastPlanWrite()?.accountId).toBe('acc_usr_c');
    expect(lastPlanWrite()?.pricingPlan).toBe(PricingPlanValue.FREE);
  });

  it('no payment_succeeded in history (first cycle) → whole history is one cycle, fail >15d downgrades', async () => {
    arrange(['usr_d'], [failedAt('usr_d', daysAgo(20))]);

    const downgraded = await checkAndDowngradeOverdueAccounts_IO();

    expect(downgraded).toBe(1);
    expect(lastPlanWrite()?.accountId).toBe('acc_usr_d');
    expect(lastPlanWrite()?.pricingPlan).toBe(PricingPlanValue.FREE);
  });

  it('downgrade event WITHIN the current cycle still dedups (companion guard: fence must not kill dedup)', async () => {
    arrange(
      ['usr_e'],
      [
        succeededAt('usr_e', daysAgo(30)),
        failedAt('usr_e', daysAgo(20)),
        downgradedAt('usr_e', daysAgo(2)),
      ]
    );

    const downgraded = await checkAndDowngradeOverdueAccounts_IO();

    expect(downgraded).toBe(0);
    expect(updateAccountPlanStatus).not.toHaveBeenCalled();
  });
});
