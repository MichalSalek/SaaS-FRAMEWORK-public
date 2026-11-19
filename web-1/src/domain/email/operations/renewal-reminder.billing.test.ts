import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLAN_ID_MAP } from '@kernel/domain/stripe/stripe.config';

const {
  accounts,
  eligible,
  sentLogs,
  quote,
  renderTemplate,
  send,
  audit,
  report,
  disabled,
} = vi.hoisted(() => ({
  accounts: vi.fn(),
  eligible: vi.fn(),
  sentLogs: vi.fn(),
  quote: vi.fn(),
  renderTemplate: vi.fn(),
  send: vi.fn(),
  audit: vi.fn(),
  report: vi.fn(),
  disabled: vi.fn(() => false),
}));
// Exercise the retained quote path with policy explicitly enabled; the policy test below keeps it disabled.
vi.mock('@app/email-handler/email-precharge-reminder.policy', () => ({
  isPrechargeReminderDisabled: disabled,
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      stylistAccount: { findMany: accounts },
      eventLog: { groupBy: sentLogs },
      $queryRaw: eligible,
    },
  },
}));
vi.mock('@app/stripe/subscription-billing.operations', () => ({
  readSubscriptionRenewal_IO: quote,
}));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO: audit,
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: report }));
vi.mock('@app/email-handler/email-template.renderer', () => ({
  renderEmailTemplate: renderTemplate,
}));
vi.mock('@app/email-handler/email-transport', () => ({
  sendLifecycleEmail: send,
}));
vi.mock('@app/email-handler/email-retry.utils', () => ({
  withEmailDeliveryRetry: (fn: (last: boolean) => Promise<boolean>) => fn(true),
}));
vi.mock('@app/email-handler/lifecycle/email-locale-batch.resolver', () => ({
  batchResolveLocales: async () => new Map(),
}));
vi.mock('@app/environment/environment.utils.api', () => ({
  buildFrontendBaseUrl: () => 'https://example.test',
}));
import {
  fetchRenewalReminderSent,
  sendRenewalReminderEmails_IO,
} from './renewal-reminder.operation';

const now = new Date('2026-11-04T12:00:00Z');
const nextDate = new Date('2026-11-11T12:00:00Z');
const account = () => ({
  account_id: 'account-1',
  subscription_id: 'sub-1',
  pricing_plan: 'PRO',
  current_period_end: nextDate,
  cancel_at_period_end: false,
  created_by_user_id: 'user-1',
  created_by_user: { email: 'test@example.com', name: 'Ania' },
});

describe('renewal reminder uses a fresh billing quote', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    disabled.mockReturnValue(false);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    accounts.mockResolvedValue([account()]);
    eligible.mockResolvedValue([{ account_id: 'account-1' }]);
    sentLogs.mockResolvedValue([]);
    quote.mockResolvedValue({
      kind: 'available',
      amountMinor: 12765,
      currency: 'pln',
      nextChargeAt: nextDate.toISOString(),
      planId: PLAN_ID_MAP.STUDIO,
    });
    renderTemplate.mockReturnValue({
      subject: 'subject',
      html: 'html',
      text: 'text',
    });
    send.mockResolvedValue(true);
    audit.mockResolvedValue(undefined);
  });

  it('stops the sweep before querying or sending while the warning is disabled', async () => {
    disabled.mockReturnValue(true);
    expect(await sendRenewalReminderEmails_IO()).toBe(0);
    expect(eligible).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('groups audit rows by user before limiting the reminder deduplication result', async () => {
    sentLogs.mockResolvedValue([
      { created_by_user_id: 'a' },
      { created_by_user_id: 'b' },
    ]);
    expect(await fetchRenewalReminderSent(['a', 'b'], now)).toEqual(
      new Set(['a', 'b'])
    );
    expect(sentLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['created_by_user_id'],
        take: 2,
      })
    );
  });

  it('renders Stripe amount, current plan and date; passes the configured window', async () => {
    expect(await sendRenewalReminderEmails_IO()).toBe(1);
    expect(quote).toHaveBeenCalledWith('sub-1', 'account-1', {
      start: new Date('2026-11-11T00:00:00Z'),
      end: new Date('2026-11-12T00:00:00Z'),
    });
    expect(renderTemplate.mock.calls[0]?.[1]).toMatchObject({
      renewalAmount: '127,65 PLN',
      planName: 'Studio',
      renewalDate: expect.any(String),
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it('sends neutral fallback when preview is unavailable, then deduplicates', async () => {
    quote.mockResolvedValue({
      kind: 'unavailable',
      reason: 'invoice_preview_failed',
    });
    expect(await sendRenewalReminderEmails_IO()).toBe(1);
    expect(renderTemplate.mock.calls[0]?.[1]).not.toHaveProperty(
      'renewalAmount'
    );
    expect(audit).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'RENEWAL_REMINDER_QUOTE_UNAVAILABLE',
        payload: { reason: 'invoice_preview_failed', accountId: 'account-1' },
      })
    );
  });
  it('passes a zero amount instead of falling back', async () => {
    quote.mockResolvedValue({
      kind: 'available',
      amountMinor: 0,
      currency: 'pln',
      nextChargeAt: nextDate.toISOString(),
      planId: PLAN_ID_MAP.PRO,
    });
    expect(await sendRenewalReminderEmails_IO()).toBe(1);
    expect(renderTemplate.mock.calls[0]?.[1]).toMatchObject({
      renewalAmount: '0,00 PLN',
      planName: 'Pro',
    });
  });

  it.each(['not_renewing', 'invalid'])(
    'skips %s without a send or dedup write',
    async kind => {
      quote.mockResolvedValue({ kind, reason: 'subscription_scope' });
      expect(await sendRenewalReminderEmails_IO()).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    }
  );

  it('skips cancelled and already-reminded accounts before any Stripe read', async () => {
    accounts.mockResolvedValue([
      { ...account(), cancel_at_period_end: true },
      { ...account(), account_id: 'account-2', created_by_user_id: 'user-2' },
    ]);
    sentLogs.mockResolvedValue([{ created_by_user_id: 'user-2' }]);
    expect(await sendRenewalReminderEmails_IO()).toBe(0);
    expect(quote).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
  it('does not write dedup when delivery fails', async () => {
    send.mockResolvedValue(false);
    expect(await sendRenewalReminderEmails_IO()).toBe(0);
    expect(audit).not.toHaveBeenCalled();
  });
  it.each([null, new Date('invalid')])(
    'does not send a fallback without a valid stored renewal date',
    async currentPeriodEnd => {
      accounts.mockResolvedValue([
        { ...account(), current_period_end: currentPeriodEnd },
      ]);
      quote.mockResolvedValue({
        kind: 'unavailable',
        reason: 'invoice_preview_failed',
      });
      expect(await sendRenewalReminderEmails_IO()).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    }
  );
});
