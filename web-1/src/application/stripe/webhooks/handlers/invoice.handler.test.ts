/**
 * handleInvoicePaymentFailed with a mocked invoice. The account lookup and dunning
 * dedup read go through the DB proxy; the plan writer and the email outbox are mocked
 * and asserted by argument (no customer and a foreign customer are no-ops; a failure
 * sets IN_PROGRESS and one outbox intent; attempt_count selects the dunning rule).
 * The outbox on real Postgres is tests/postgres/email-outbox*.test.ts.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import type Stripe from 'stripe';
import { mockDb } from '../../../../test-utils/mockApiHandler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  PricingPlanValue,
  getPlanDisplayName,
} from '@kernel/domain/pricing/pricing.config';
import {
  AccountStatusValue,
  EventLogTypeValue,
  PaymentStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import type { StripeWebhookEffect } from '@app/stripe/webhooks/stripe-effects.types';
import type { EmailOutboxIntent } from '@app/email-handler/outbox/email-outbox.store';

// ── Module mocks (same seams as the sibling webhook gate tests). ────────────────
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

const { updateAccountPlanStatus } = vi.hoisted(() => ({
  updateAccountPlanStatus: vi.fn(async () => true),
}));
vi.mock('@app/stripe/plan-status-update.operations', () => ({
  updateAccountPlanStatus,
}));

const outbox = vi.hoisted(() => ({
  enqueue: vi.fn(
    async (_db: unknown, intent: EmailOutboxIntent): Promise<string | null> =>
      `msg-${intent.ruleId}`
  ),
  kick: vi.fn((ids: readonly string[]) => async () => {
    outbox.kicked.push([...ids]);
  }),
  kicked: [] as string[][],
}));
vi.mock('@app/email-handler/outbox/email-outbox', () => ({
  enqueueEmailOutboxTx: outbox.enqueue,
  kickEmailOutbox: outbox.kick,
}));
const intents = (): EmailOutboxIntent[] =>
  outbox.enqueue.mock.calls.map(call => call[1]);

// Mirror of the real extractCustomerId (string → id, null → undefined); mocking the
// module avoids the stripe.adapter / email.operations import chain (canon pattern).
vi.mock('@app/stripe/webhooks/stripe-webhooks.utils', () => ({
  extractCustomerId: ({ customer }: { customer: unknown }) =>
    typeof customer === 'string' ? customer : undefined,
}));

import { handleInvoicePaymentFailed } from './invoice.handler';

const CUSTOMER_ID = 'cus_nailfolio_test_1';
const ACCOUNT_ID = 'acc_test_0000000000000001';
const USER_ID = 'usr_test_0000000000000001';
const PERIOD_START_S = 1_750_000_000; // seconds (Stripe epoch-s)
const EVENT_AT = new Date(1_800_000_000_000);

type AccountRow = {
  account_id: string;
  created_by_user_id: string;
  created_at: Date;
  pricing_plan: string;
  account_status: string;
  subscription_id: string | null;
  payment_status: string;
  subscription_status: string | null;
  cancel_at_period_end: boolean | null;
  cancel_at: Date | null;
  current_period_end: Date | null;
};

const makeAccountRow = (overrides: Partial<AccountRow> = {}): AccountRow => ({
  account_id: ACCOUNT_ID,
  created_by_user_id: USER_ID,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  pricing_plan: PricingPlanValue.PRO,
  account_status: AccountStatusValue.ACTIVE,
  subscription_id: 'sub_test_1',
  payment_status: PaymentStatusValue.PAID,
  subscription_status: SubscriptionStatusValue.PAST_DUE,
  cancel_at_period_end: false,
  cancel_at: null,
  current_period_end: new Date('2026-08-01T00:00:00.000Z'),
  ...overrides,
});

/** Single cast seam: minimal invoice shape → Stripe.Invoice. */
const makeInvoice = (
  seed: Partial<{
    id: string;
    customer: string | null;
    attempt_count: number;
    period_start: number;
  }> = {}
): Stripe.Invoice => {
  const partial = {
    id: seed.id ?? 'in_test_1',
    customer: seed.customer === undefined ? CUSTOMER_ID : seed.customer,
    attempt_count: seed.attempt_count ?? 1,
    period_start: seed.period_start ?? PERIOD_START_S,
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: 'sub_test_1' },
    },
  };
  return partial as unknown as Stripe.Invoice;
};

type DbSpies = {
  stylistAccountFindUnique: ReturnType<typeof vi.fn>;
  userFindUnique: ReturnType<typeof vi.fn>;
  eventLogFindMany: ReturnType<typeof vi.fn>;
  eventLogCreate: ReturnType<typeof vi.fn>;
};

/**
 * Install the DB stub: account lookup + _count stats (both go through
 * stylistAccount.findUnique — branch on the `_count` select), the user email
 * lookup, the dunning dedup findMany and the audit eventLog.create.
 */
const installDb = (opts: {
  account: AccountRow | null;
  user?: { email: string; name: string | null } | null;
  sentDunningRows?: { event: string; event_payload?: unknown }[];
  stats?: { gallery_record: number; stylist_pairings: number };
}): DbSpies => {
  const stylistAccountFindUnique = vi.fn(
    async (args: { select?: Record<string, unknown> }) => {
      if (args.select && '_count' in args.select) {
        return {
          _count: opts.stats ?? { gallery_record: 0, stylist_pairings: 0 },
        };
      }
      return opts.account;
    }
  );
  const userFindUnique = vi.fn(async () =>
    opts.user === undefined
      ? { email: 'stylist@test.local', name: 'Test Stylist' }
      : opts.user
  );
  const eventLogFindMany = vi.fn(async () => opts.sentDunningRows ?? []);
  const eventLogCreate = vi.fn(
    async (args: { data: Record<string, unknown> }) => ({
      event_log_id: 'evl_test_1',
      created_at: new Date(),
      ...args.data,
    })
  );
  mockDb({
    stylistAccount: { findUnique: stylistAccountFindUnique },
    user: { findUnique: userFindUnique },
    eventLog: { findMany: eventLogFindMany, create: eventLogCreate },
  });
  return {
    stylistAccountFindUnique,
    userFindUnique,
    eventLogFindMany,
    eventLogCreate,
  };
};

const runEffects = async (effects: StripeWebhookEffect[]): Promise<void> => {
  for (const effect of effects) {
    await effect();
  }
};

const run = (invoice: Stripe.Invoice) =>
  handleInvoicePaymentFailed({ invoice, eventCreatedAt: EVENT_AT });

describe('handleInvoicePaymentFailed — dunning webhook flow', () => {
  beforeEach(() => {
    outbox.kicked.length = 0;
  });

  it('no customerId on invoice → no-op: zero DB reads, zero writes, zero effects', async () => {
    const db = installDb({ account: makeAccountRow() });

    const { effects } = await run(makeInvoice({ customer: null }));

    expect(effects).toEqual([]);
    expect(db.stylistAccountFindUnique).not.toHaveBeenCalled();
    expect(updateAccountPlanStatus).not.toHaveBeenCalled();
    expect(db.eventLogCreate).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('null account (out-of-scope customer) → no-op, lookup scoped to stripe_customer_id', async () => {
    const db = installDb({ account: null });

    const { effects } = await run(makeInvoice());

    expect(effects).toEqual([]);
    expect(db.stylistAccountFindUnique).toHaveBeenCalledTimes(1);
    const lookupArgs = db.stylistAccountFindUnique.mock
      .calls[0]?.[0] as unknown as { where: Record<string, unknown> };
    expect(lookupArgs.where).toEqual({ stripe_customer_id: CUSTOMER_ID });
    expect(updateAccountPlanStatus).not.toHaveBeenCalled();
    expect(db.eventLogCreate).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('writes payment_status=IN_PROGRESS via updateAccountPlanStatus, scoped to the account, account_status PRESERVED', async () => {
    const account = makeAccountRow({
      account_status: AccountStatusValue.ACTIVE,
    });
    installDb({ account });

    await run(makeInvoice());

    expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
    expect(updateAccountPlanStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        pricingPlan: PricingPlanValue.PRO,
        paymentStatus: PaymentStatusValue.IN_PROGRESS,
        // Dunning marks payment retry-in-progress — it must NOT flip the account
        // to NOT_ACTIVE (the auto-downgrade sweep owns that, day 15).
        accountStatus: AccountStatusValue.ACTIVE,
        subscriptionStatus: SubscriptionStatusValue.PAST_DUE,
        subscriptionId: 'sub_test_1',
        createdByUserId: USER_ID,
        stripeEventAt: EVENT_AT,
      })
    );
  });

  it('payment-failed is a durable intent written IN the handler (stable key invoice+attempt), with planName per plan (Studio, not "Pro"), and ONE kick effect', async () => {
    installDb({
      account: makeAccountRow({ pricing_plan: PricingPlanValue.STUDIO }),
    });

    const { effects } = await run(makeInvoice({ attempt_count: 1 }));

    // attempt 1 → payment-failed + dunning-info, both written before the handler returns
    // (inside the webhook transaction), sent by one post-commit kick.
    expect(intents().map(intent => intent.templateId)).toEqual([
      'payment-failed',
      'dunning-info',
    ]);
    expect(intents()[0]).toEqual({
      userId: USER_ID,
      accountId: ACCOUNT_ID,
      ruleId: 'payment-failed',
      templateId: 'payment-failed',
      occurrence: 'invoice:in_test_1:attempt:1',
      subjectKey: 'email.paymentFailed.subject',
      infoEvent: APP_EVENTS.INFO.EMAIL.EMAIL_PAYMENT_FAILED_SENT,
      vars: { planName: getPlanDisplayName(PricingPlanValue.STUDIO) },
    });
    expect(intents()[0]?.vars.planName).toBe('Studio');
    expect(effects).toHaveLength(1);
    expect(outbox.kicked).toEqual([]);
    await runEffects(effects);
    expect(outbox.kicked).toEqual([
      ['msg-payment-failed', 'msg-DUNNING_D1_INFO'],
    ]);
  });

  it('attempt_count=1 → dunning-info intent with galleryCount/pairedClientsCount from _count, keyed per invoice', async () => {
    installDb({
      account: makeAccountRow(),
      stats: { gallery_record: 12, stylist_pairings: 3 },
    });

    await run(makeInvoice({ attempt_count: 1 }));

    expect(intents()[1]).toEqual({
      userId: USER_ID,
      accountId: ACCOUNT_ID,
      ruleId: 'DUNNING_D1_INFO',
      templateId: 'dunning-info',
      occurrence: 'invoice:in_test_1',
      subjectKey: 'email.dunning.d1Info.subject',
      infoEvent: 'EMAIL_DUNNING_D1_INFO_SENT',
      vars: {
        planName: getPlanDisplayName(PricingPlanValue.PRO),
        galleryCount: '12',
        pairedClientsCount: '3',
      },
    });
  });

  it.each([
    [2, 'dunning-urgent', 'EMAIL_DUNNING_D7_URGENT_SENT'],
    [3, 'dunning-urgent', 'EMAIL_DUNNING_D7_URGENT_SENT'],
    [4, 'dunning-final', 'EMAIL_DUNNING_D14_FINAL_SENT'],
    [10, 'dunning-final', 'EMAIL_DUNNING_D14_FINAL_SENT'],
  ])(
    'attempt_count=%i → %s (%s) queued after the payment-failed email',
    async (attemptCount, templateId, infoEvent) => {
      installDb({ account: makeAccountRow() });

      await run(makeInvoice({ attempt_count: attemptCount }));

      expect(intents()).toHaveLength(2);
      expect(intents()[0]?.occurrence).toBe(
        `invoice:in_test_1:attempt:${attemptCount}`
      );
      expect(intents()[1]?.templateId).toBe(templateId);
      expect(intents()[1]?.infoEvent).toBe(infoEvent);
    }
  );

  it('attempt_count=0 → no dunning rule matches → ONLY the payment-failed intent', async () => {
    const db = installDb({ account: makeAccountRow() });

    const { effects } = await run(makeInvoice({ attempt_count: 0 }));

    // No rule → the dedup query must not even run.
    expect(db.eventLogFindMany).not.toHaveBeenCalled();
    expect(intents().map(intent => intent.templateId)).toEqual([
      'payment-failed',
    ]);
    await runEffects(effects);
    expect(outbox.kicked).toEqual([['msg-payment-failed']]);
  });

  it('legacy dedup: dunning already sent in this period (EventLog) → dunning NOT queued, payment-failed STILL queued', async () => {
    installDb({
      account: makeAccountRow(),
      sentDunningRows: [{ event: 'EMAIL_DUNNING_D1_INFO_SENT' }],
    });

    await run(makeInvoice({ attempt_count: 1 }));

    expect(intents().map(intent => intent.templateId)).toEqual([
      'payment-failed',
    ]);
  });

  it('an EventLog row written by the OUTBOX (carries lifecycleMessageId) does not suppress the next cycle', async () => {
    installDb({
      account: makeAccountRow(),
      sentDunningRows: [
        {
          event: 'EMAIL_DUNNING_D1_INFO_SENT',
          event_payload: {
            responseBody: {
              templateId: 'dunning-info',
              lifecycleMessageId: 'previous-cycle',
            },
          },
        },
      ],
    });

    await run(makeInvoice({ id: 'in_cycle_2', attempt_count: 1 }));

    expect(intents().map(intent => intent.templateId)).toEqual([
      'payment-failed',
      'dunning-info',
    ]);
  });

  it('two billing cycles key their dunning mail on their own invoice (no cross-cycle collision)', async () => {
    installDb({ account: makeAccountRow() });

    await run(makeInvoice({ id: 'in_cycle_1', attempt_count: 1 }));
    await run(makeInvoice({ id: 'in_cycle_2', attempt_count: 1 }));

    const dunning = intents().filter(
      intent => intent.templateId === 'dunning-info'
    );
    expect(dunning.map(intent => intent.occurrence)).toEqual([
      'invoice:in_cycle_1',
      'invoice:in_cycle_2',
    ]);
  });

  it('a replayed event (intents already in the outbox) schedules NO kick', async () => {
    installDb({ account: makeAccountRow() });
    outbox.enqueue.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const { effects } = await run(makeInvoice({ attempt_count: 1 }));

    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
    expect(effects).toEqual([]);
  });

  it('period-fence: dedup WHERE is scoped to user + infoEvent + created_at >= period_start*1000', async () => {
    const db = installDb({ account: makeAccountRow() });

    await run(makeInvoice({ attempt_count: 2, period_start: PERIOD_START_S }));

    expect(db.eventLogFindMany).toHaveBeenCalledTimes(1);
    const dedupArgs = db.eventLogFindMany.mock.calls[0]?.[0] as unknown as {
      where: {
        event_type: string;
        created_by_user_id: string;
        event: string;
        created_at: { gte: Date };
      };
      take: number;
    };
    expect(dedupArgs.where.event_type).toBe(EventLogTypeValue.EMAIL);
    expect(dedupArgs.where.created_by_user_id).toBe(USER_ID);
    expect(dedupArgs.where.event).toBe('EMAIL_DUNNING_D7_URGENT_SENT');
    // The fence: an "already sent" row only counts INSIDE this invoice's billing
    // period — without it dunning suppression would be permanent across cycles.
    expect(dedupArgs.where.created_at).toEqual({
      gte: new Date(PERIOD_START_S * 1000),
    });
    expect(dedupArgs.take).toBe(20);
  });

  it('user without email → NO intents and no effects, but the IN_PROGRESS write still lands', async () => {
    installDb({ account: makeAccountRow(), user: null });

    const { effects } = await run(makeInvoice({ attempt_count: 1 }));

    expect(effects).toEqual([]);
    expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
