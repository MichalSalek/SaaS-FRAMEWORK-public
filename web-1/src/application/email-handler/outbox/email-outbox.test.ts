import { beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({
  findMany: vi.fn(),
  report: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: { use: { emailLifecycleMessage: { findMany: io.findMany } } },
}));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: io.report,
}));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO: io.audit,
}));

import { createEmailOutboxDeps, kickEmailOutbox } from './email-outbox';

describe('email outbox wiring', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the stored intent like a direct transactional send: no unsubscribe header, plan name in the body', () => {
    const params = createEmailOutboxDeps().render({
      messageId: 'm1',
      templateId: 'payment-failed',
      payload: {
        subjectKey: 'email.paymentFailed.subject',
        infoEvent: 'EMAIL_PAYMENT_FAILED_SENT',
        vars: { planName: 'Studio' },
      },
      locale: 'pl',
      recipient: { email: 'a@example.test', name: 'Ania' },
    });
    expect(params.to).toBe('a@example.test');
    expect(params.headers).toEqual({});
    expect(params.subject.length).toBeGreaterThan(0);
    expect(params.html).toContain('Studio');
  });

  it('records the info event with the ledger id when the provider accepts', async () => {
    await createEmailOutboxDeps().onAccepted(
      {
        id: 'm1',
        userId: 'u1',
        accountId: 'a1',
        templateId: 'payment-failed',
        ruleId: 'payment-failed',
        status: 'accepted',
        attempts: 1,
        provider: 'resend',
        locale: 'pl',
        createdAt: new Date(),
        startedAt: new Date(),
        outboxPayload: {
          subjectKey: 'email.paymentFailed.subject',
          infoEvent: 'EMAIL_PAYMENT_FAILED_SENT',
          vars: {},
        },
      },
      {
        subjectKey: 'email.paymentFailed.subject',
        infoEvent: 'EMAIL_PAYMENT_FAILED_SENT',
        vars: {},
      }
    );
    expect(io.audit).toHaveBeenCalledWith({
      eventName: 'EMAIL_PAYMENT_FAILED_SENT',
      user: { id: 'u1' },
      responseBody: { templateId: 'payment-failed', lifecycleMessageId: 'm1' },
    });
  });

  it('a failed post-commit kick never throws (the job is the backstop)', async () => {
    io.findMany.mockRejectedValue(new Error('db down'));
    await expect(kickEmailOutbox(['m1'])()).resolves.toBeUndefined();
    expect(io.report).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'EMAIL_OUTBOX_KICK_FAILED' })
    );
  });
});
