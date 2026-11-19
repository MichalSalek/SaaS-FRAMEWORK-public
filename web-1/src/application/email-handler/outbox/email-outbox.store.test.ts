import { describe, expect, it, vi } from 'vitest';
import {
  EMAIL_OUTBOX_CONFIG,
  decideOutboxRow,
  outboxBackoffMs,
  parseOutboxPayload,
  runEmailOutboxRound,
  type OutboxDeps,
} from './email-outbox.store';

const now = new Date('2026-10-23T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 60 * 60 * 1000;

describe('decideOutboxRow: an ambiguous send is re-sent only when no second copy is possible', () => {
  it('never contacted (provider null): sent, also after an interrupted claim', () => {
    for (const status of ['reserved', 'unknown']) {
      expect(
        decideOutboxRow(
          { status, attempts: 1, provider: null, createdAt: ago(HOUR) },
          now
        )
      ).toEqual({ action: 'claim', resendOnly: false });
    }
  });
  it('Resend only, inside its idempotency window: Resend-only retry with the same key', () => {
    expect(
      decideOutboxRow(
        {
          status: 'unknown',
          attempts: 1,
          provider: 'resend',
          createdAt: ago(19 * HOUR),
        },
        now
      )
    ).toEqual({ action: 'claim', resendOnly: true });
  });
  it('Resend past the window, or out of attempts: dead-lettered as unknown', () => {
    expect(
      decideOutboxRow(
        {
          status: 'unknown',
          attempts: 1,
          provider: 'resend',
          createdAt: ago(EMAIL_OUTBOX_CONFIG.RESEND_RETRY_WINDOW_MS + 1),
        },
        now
      )
    ).toEqual({ action: 'dead-letter', reason: 'unknown_unresolved' });
    expect(
      decideOutboxRow(
        {
          status: 'unknown',
          attempts: EMAIL_OUTBOX_CONFIG.MAX_ATTEMPTS,
          provider: 'resend',
          createdAt: ago(HOUR),
        },
        now
      )
    ).toEqual({ action: 'dead-letter', reason: 'unknown_unresolved' });
  });
  it('Mailgun may hold it: never re-sent (no idempotency)', () => {
    expect(
      decideOutboxRow(
        { status: 'unknown', attempts: 1, provider: 'mailgun', createdAt: now },
        now
      )
    ).toEqual({ action: 'dead-letter', reason: 'unknown_unresolved' });
  });
  it('a never-sent intent past its validity expires', () => {
    expect(
      decideOutboxRow(
        {
          status: 'reserved',
          attempts: 0,
          provider: null,
          createdAt: ago(EMAIL_OUTBOX_CONFIG.MAX_INTENT_AGE_MS + 1),
        },
        now
      )
    ).toEqual({ action: 'expire' });
  });
});

describe('outbox helpers', () => {
  it('backoff doubles from 5 min and caps at 2 h', () => {
    expect(outboxBackoffMs(1)).toBe(5 * 60 * 1000);
    expect(outboxBackoffMs(2)).toBe(10 * 60 * 1000);
    expect(outboxBackoffMs(10)).toBe(EMAIL_OUTBOX_CONFIG.BACKOFF_MAX_MS);
  });
  it('payload parsing rejects anything but string vars', () => {
    expect(
      parseOutboxPayload({
        subjectKey: 's',
        infoEvent: 'E',
        vars: { planName: 'Pro' },
      })
    ).toEqual({ subjectKey: 's', infoEvent: 'E', vars: { planName: 'Pro' } });
    expect(
      parseOutboxPayload({ subjectKey: 's', infoEvent: 'E', vars: { n: 1 } })
    ).toBeNull();
    expect(parseOutboxPayload(null)).toBeNull();
  });
});

describe('billing warning outbox suppression', () => {
  it.each([
    {
      status: 'reserved',
      provider: null,
      reason: 'precharge_reminder_disabled',
    },
    {
      status: 'unknown',
      provider: 'resend',
      reason: 'precharge_reminder_disabled_prior_delivery_unknown',
    },
  ])(
    'stops a $status intent without a provider call or sent audit',
    async ({ status, provider, reason }) => {
      const row = {
        id: 'm',
        userId: 'u',
        accountId: 'a',
        templateId: 'trial-last-day',
        ruleId: 'TRIAL_D29_LAST_DAY',
        status,
        attempts: 1,
        provider,
        locale: 'pl',
        createdAt: now,
        startedAt: null,
        outboxPayload: null,
      };
      const updateMany = vi.fn(async () => ({ count: 1 }));
      const create = vi.fn(async () => ({}));
      const send = vi.fn();
      const onAccepted = vi.fn();
      const tx = {
        emailLifecycleMessage: { updateMany },
        emailLifecycleOperationalEvent: { create },
      };
      const db = {
        emailLifecycleMessage: { findMany: async () => [row] },
        $transaction: async (fn: (arg: typeof tx) => Promise<unknown>) =>
          fn(tx),
      };
      const deps = {
        db,
        now: () => now,
        send,
        onAccepted,
        stillRelevant: vi.fn(),
      } as unknown as OutboxDeps;
      const result = await runEmailOutboxRound(deps);
      expect(result).toMatchObject({
        suppressed: 1,
        sent: 0,
        retryScheduled: 0,
      });
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'suppressed', reason }),
        })
      );
      expect(send).not.toHaveBeenCalled();
      expect(onAccepted).not.toHaveBeenCalled();
      expect(deps.stillRelevant).not.toHaveBeenCalled();
    }
  );
});

describe('billing recovery outbox', () => {
  it.each([
    'payment-failed',
    'dunning-info',
    'dunning-urgent',
    'dunning-final',
  ])(
    'allows %s to retry through the provider and records acceptance',
    async templateId => {
      const row = {
        id: 'm',
        userId: 'u',
        accountId: 'a',
        templateId,
        ruleId: templateId,
        status: 'unknown',
        attempts: 1,
        provider: 'resend',
        locale: 'pl',
        createdAt: now,
        startedAt: null,
        outboxPayload: { subjectKey: 's', infoEvent: 'E', vars: {} },
      };
      const updateMany = vi.fn(async () => ({ count: 1 }));
      const create = vi.fn(async () => ({}));
      const send = vi.fn(async () => ({
        status: 'accepted',
        provider: 'resend',
        providerMessageId: 'provider-id',
      }));
      const onAccepted = vi.fn();
      const tx = {
        emailLifecycleMessage: { updateMany },
        emailLifecycleOperationalEvent: { create },
      };
      const db = {
        emailLifecycleMessage: { findMany: async () => [row], updateMany },
        $transaction: async (fn: (arg: typeof tx) => Promise<unknown>) =>
          fn(tx),
      };
      const deps = {
        db,
        now: () => now,
        send,
        onAccepted,
        stillRelevant: vi.fn(async () => true),
        loadRecipient: async () => ({ email: 'a@example.test', name: 'Ada' }),
        render: () => ({ to: 'a@example.test', subject: 's', html: 'h' }),
        addressHash: () => 'hash',
      } as unknown as OutboxDeps;
      const result = await runEmailOutboxRound(deps);
      expect(result).toMatchObject({ sent: 1, suppressed: 0 });
      expect(send).toHaveBeenCalledWith(
        { id: 'm', templateId },
        expect.anything(),
        expect.objectContaining({ resendOnly: true })
      );
      expect(onAccepted).toHaveBeenCalledOnce();
    }
  );
});
