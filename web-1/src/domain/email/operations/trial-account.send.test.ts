import { describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  resolve: vi.fn(),
  offer: vi.fn(),
  send: vi.fn(),
  audit: vi.fn(),
  query: vi.fn(),
  context: vi.fn(),
}));
vi.mock('@domain/email/trial-email.resolver', () => ({
  resolveTrialEmails: io.resolve,
}));
vi.mock('./trial-sweep.query', () => ({
  queryTrialAccounts: io.query,
  buildTrialSweepContext: io.context,
}));
vi.mock('@domain/email/email-offer.issuer', () => ({
  issueFirstMonthOffer_IO: io.offer,
}));
vi.mock('./scheduled-lifecycle.send', () => ({
  sendScheduledLifecycleEmail: io.send,
}));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO: io.audit,
}));
import { processTrialAccount } from './trial-account.send';

describe('trial sweep billing warning', () => {
  it('does not issue an offer, send or record a sent event even if a disabled rule reaches the sender', async () => {
    io.resolve.mockReturnValue([
      {
        id: 'TRIAL_D29_LAST_DAY',
        bodyTemplateId: 'trial-last-day',
        infoEvent: 'EMAIL_TRIAL_D29_LAST_DAY_SENT',
        category: 'TRIAL_SEQUENCE',
      },
    ]);
    const account = {
      account_id: 'a',
      created_by_user_id: 'u',
      created_by_user: {
        email: 'a@example.test',
        name: 'Ada',
        is_active: true,
      },
      _count: { gallery_record: 0 },
    } as unknown as Parameters<typeof processTrialAccount>[0];
    const context = {
      sentEventsMap: new Map(),
      pairingCountMap: new Map(),
      localeMap: new Map(),
      endedTrialPlanMap: new Map(),
      frequencyCountMap: new Map(),
    } as unknown as Parameters<typeof processTrialAccount>[1];
    expect(await processTrialAccount(account, context)).toBe(0);
    expect(io.offer).not.toHaveBeenCalled();
    expect(io.send).not.toHaveBeenCalled();
    expect(io.audit).not.toHaveBeenCalled();
  });

  it('revalidates the exact trial dates before sending a reserved message', async () => {
    const start = new Date('2026-01-01T00:00:00Z');
    const end = new Date('2026-01-15T00:00:00Z');
    const account = {
      account_id: 'a',
      trial_started_at: start,
      trial_ends_at: end,
      created_by_user_id: 'u',
      created_by_user: {
        email: 'a@example.test',
        name: 'Ada',
        is_active: true,
      },
      _count: { gallery_record: 0 },
    } as unknown as Parameters<typeof processTrialAccount>[0];
    const context = {
      sentEventsMap: new Map(),
      pairingCountMap: new Map(),
      localeMap: new Map(),
      endedTrialPlanMap: new Map(),
      frequencyCountMap: new Map(),
    } as unknown as Parameters<typeof processTrialAccount>[1];
    const rule = {
      id: 'TRIAL_D1_NUDGE',
      bodyTemplateId: 'trial-nudge-upload',
      infoEvent: 'EMAIL_TRIAL_D1_NUDGE_SENT',
      category: 'TRIAL_SEQUENCE',
      personalizeWith: [],
      subjectKey: 'subject',
    };
    io.resolve.mockReturnValue([rule]);
    io.send.mockImplementation(async input => {
      io.query.mockResolvedValue([
        { ...account, trial_ends_at: new Date(end.getTime() + 86400000) },
      ]);
      expect(await input.validate()).toBe(false);
      io.query.mockResolvedValue([account]);
      io.context.mockResolvedValue(context);
      expect(await input.validate()).toBe(true);
      return { status: 'suppressed' };
    });
    expect(await processTrialAccount(account, context)).toBe(0);
    expect(io.send).toHaveBeenCalledOnce();
  });
});
