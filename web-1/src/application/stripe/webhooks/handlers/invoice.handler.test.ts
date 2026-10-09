/**
 * DUNNING webhook-flow unit tests — handleInvoicePaymentFailed (invoice.handler.ts).
 *
 * Drives the REAL handler with a minimal mocked Stripe.Invoice (single cast helper).
 * DB goes through the global setup proxy (mockDb): findAccountByCustomerId reads
 * stylistAccount.findUnique for real (customer-scoped lookup asserted), the dunning
 * dedup reads eventLog.findMany for real (period-fence asserted). The SSOT plan
 * writer (updateAccountPlanStatus) and the email transport (sendTransactionalEmail)
 * are module-mocked — we assert their ARGUMENTS, the handler's own behavior:
 *
 *  - no customerId            → no-op (zero DB reads, zero writes, zero effects);
 *  - null account (out-of-scope customer)
 *                             → no-op (no plan write, no email);
 *  - payment failure          → payment_status=IN_PROGRESS via updateAccountPlanStatus
 *                               (account-scoped, account_status PRESERVED — dunning
 *                               must not deactivate), payment-failed email ALWAYS
 *                               queued as a post-commit effect with {{planName}}
 *                               interpolated per plan (never hardcoded 'Pro');
 *  - dunning schedule         → attempt_count → resolveDunningEmail rule
 *                               (1→info, 2-3→urgent, ≥4→final, 0→none);
 *  - dunning dedup            → an EventLog row for the rule's infoEvent WITHIN the
 *                               current billing period suppresses ONLY the dunning
 *                               email (payment-failed still goes out);
 *  - period-fence             → the dedup WHERE carries
 *                               created_at: { gte: new Date(invoice.period_start*1000) }
 *                               so suppression never leaks across billing cycles.
 *
 * NOTE: the full e2e webhook path (signature verify → router → $transaction →
 * post-commit effect collector) is NOT feasible without a Stripe test env — this
 * suite covers the handler layer with a mocked event, same as the sibling
 * checkout-completed.gate / subscription-lifecycle.entitlement-gate tests.
 */

import { describe, it, expect, vi } from 'vitest';
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

// ── Module mocks (same seams as the sibling webhook gate tests). ────────────────
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

const { updateAccountPlanStatus } = vi.hoisted(() => ({
  updateAccountPlanStatus: vi.fn(async () => true),
}));
vi.mock('@app/stripe/plan-status-update.operations', () => ({
  updateAccountPlanStatus,
}));

const { sendTransactionalEmail } = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn(async (..._args: unknown[]) => true),
}));
vi.mock('@app/email-handler/email-transactional', () => ({
  sendTransactionalEmail,
}));

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
  sentDunningRows?: { event: string }[];
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
  it('no customerId on invoice → no-op: zero DB reads, zero writes, zero effects', async () => {
    const db = installDb({ account: makeAccountRow() });

    const { effects } = await run(makeInvoice({ customer: null }));

    expect(effects).toEqual([]);
    expect(db.stylistAccountFindUnique).not.toHaveBeenCalled();
    expect(updateAccountPlanStatus).not.toHaveBeenCalled();
    expect(db.eventLogCreate).not.toHaveBeenCalled();
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
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
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
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

  it('payment-failed email is queued as an EFFECT (not sent inline) with planName interpolated per plan (Studio, not "Pro")', async () => {
    installDb({
      account: makeAccountRow({ pricing_plan: PricingPlanValue.STUDIO }),
    });

    const { effects } = await run(makeInvoice({ attempt_count: 1 }));

    // Nothing sent during the handler itself — durability contract: effects fire
    // post-commit only.
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    // attempt 1 → payment-failed + dunning-info.
    expect(effects).toHaveLength(2);

    await runEffects(effects);

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      'payment-failed',
      { email: 'stylist@test.local', name: 'Test Stylist', id: USER_ID },
      APP_EVENTS.INFO.EMAIL.EMAIL_PAYMENT_FAILED_SENT,
      { planName: getPlanDisplayName(PricingPlanValue.STUDIO) },
      'email.paymentFailed.subject'
    );
    const paymentFailedVars = sendTransactionalEmail.mock
      .calls[0]?.[3] as unknown as { planName: string };
    expect(paymentFailedVars.planName).toBe('Studio');
    expect(paymentFailedVars.planName).not.toBe('Pro');
  });

  it('attempt_count=1 → dunning-info queued with galleryCount/pairedClientsCount from _count', async () => {
    installDb({
      account: makeAccountRow(),
      stats: { gallery_record: 12, stylist_pairings: 3 },
    });

    const { effects } = await run(makeInvoice({ attempt_count: 1 }));
    expect(effects).toHaveLength(2);
    await runEffects(effects);

    expect(sendTransactionalEmail).toHaveBeenCalledTimes(2);
    expect(sendTransactionalEmail).toHaveBeenLastCalledWith(
      'dunning-info',
      { email: 'stylist@test.local', name: 'Test Stylist', id: USER_ID },
      'EMAIL_DUNNING_D1_INFO_SENT',
      {
        planName: getPlanDisplayName(PricingPlanValue.PRO),
        galleryCount: '12',
        pairedClientsCount: '3',
      },
      'email.dunning.d1Info.subject'
    );
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

      const { effects } = await run(
        makeInvoice({ attempt_count: attemptCount })
      );
      expect(effects).toHaveLength(2);
      await runEffects(effects);

      const dunningCall = sendTransactionalEmail.mock.calls[1] as unknown as [
        string,
        { email: string },
        string,
      ];
      expect(dunningCall[0]).toBe(templateId);
      expect(dunningCall[2]).toBe(infoEvent);
    }
  );

  it('attempt_count=0 → no dunning rule matches → ONLY the payment-failed email is queued', async () => {
    const db = installDb({ account: makeAccountRow() });

    const { effects } = await run(makeInvoice({ attempt_count: 0 }));

    expect(effects).toHaveLength(1);
    // No rule → the dedup query must not even run.
    expect(db.eventLogFindMany).not.toHaveBeenCalled();
    await runEffects(effects);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail.mock.calls[0]?.[0]).toBe('payment-failed');
  });

  it('dedup: dunning already sent in this period → dunning NOT queued, payment-failed STILL queued', async () => {
    installDb({
      account: makeAccountRow(),
      sentDunningRows: [{ event: 'EMAIL_DUNNING_D1_INFO_SENT' }],
    });

    const { effects } = await run(makeInvoice({ attempt_count: 1 }));

    expect(effects).toHaveLength(1);
    await runEffects(effects);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail.mock.calls[0]?.[0]).toBe('payment-failed');
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
    expect(dedupArgs.take).toBe(1);
  });

  it('user without email → NO email effects, but the IN_PROGRESS write still lands', async () => {
    installDb({ account: makeAccountRow(), user: null });

    const { effects } = await run(makeInvoice({ attempt_count: 1 }));

    expect(effects).toEqual([]);
    expect(updateAccountPlanStatus).toHaveBeenCalledTimes(1);
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
