import { beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({
  reserve: vi.fn(),
  mark: vi.fn(),
  finish: vi.fn(),
  decision: vi.fn(),
  resend: vi.fn(),
  mailgun: vi.fn(),
  canSend: vi.fn(() => true),
  stub: vi.fn(() => false),
}));
vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: {
    RESEND_API_KEY: 'test',
    MAILGUN_API_KEY: 'test',
    MAILGUN_DOMAIN: 'mg.example.test',
    MAILGUN_API_BASE_URL: 'https://api.eu.mailgun.net',
    FROM_EMAIL: 'sender@mg.example.test',
  },
}));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: io.resend };
  },
}));
vi.mock('mailgun.js', () => ({
  default: class {
    client() {
      return { messages: { create: io.mailgun } };
    }
  },
}));
vi.mock('../email-circuit-breaker', () => ({ canSendEmail: io.canSend }));
vi.mock('../email-dev-sink', () => ({ shouldStubEmailSend: io.stub }));
vi.mock('./ledger', () => ({
  reserveLifecycleMessage: io.reserve,
  markLifecycleSending: io.mark,
  finishLifecycleMessage: io.finish,
}));
vi.mock('./operational-decision', () => ({
  recordLifecycleDecision_IO: io.decision,
}));
import {
  sendMeasuredLifecycleEmail,
  sendMeasuredLifecycleMessage,
} from './measured-transport';
const params = {
  to: 'own@example.test',
  subject: 'Test',
  html: '<p>Test</p>',
  text: 'Test',
};
describe('measured lifecycle transport', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(['trial-warning', 'trial-last-day', 'renewal-reminder'])(
    'suppresses %s before validation, reservation or rendering',
    async templateId => {
      const validate = vi.fn(async () => true);
      const render = vi.fn(() => params);
      const result = await sendMeasuredLifecycleEmail({
        userId: 'u',
        accountId: 'a',
        family: 'billing',
        ruleId: 'r',
        templateId,
        occurrence: 'o',
        contentVersion: '1',
        locale: 'pl',
        cohort: 'existing',
        ctaIds: [],
        scheduledAt: new Date(),
        recipientEmail: params.to,
        validate,
        render,
      });
      expect(result).toEqual({
        status: 'suppressed',
        reason: 'precharge_reminder_disabled',
      });
      expect(validate).not.toHaveBeenCalled();
      expect(io.reserve).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
      expect(
        await sendMeasuredLifecycleMessage({ id: 'manual', templateId }, params)
      ).toEqual({
        status: 'suppressed',
        reason: 'precharge_reminder_disabled',
      });
      expect(io.resend).not.toHaveBeenCalled();
      expect(io.mailgun).not.toHaveBeenCalled();
    }
  );
  it('holds uncertain network acceptance without fallback', async () => {
    io.resend.mockRejectedValue(new Error('socket disconnected'));
    expect(
      await sendMeasuredLifecycleMessage(
        { id: 'message-1', templateId: 'welcome' },
        params
      )
    ).toMatchObject({ status: 'unknown', provider: 'resend' });
    expect(io.mailgun).not.toHaveBeenCalled();
  });
  it('holds 5xx and unknown error payloads without fallback', async () => {
    io.resend.mockResolvedValue({
      data: null,
      error: { name: 'unexpected', statusCode: 503 },
    });
    expect(
      await sendMeasuredLifecycleMessage(
        { id: 'message-1', templateId: 'welcome' },
        params
      )
    ).toMatchObject({ status: 'unknown' });
    expect(io.mailgun).not.toHaveBeenCalled();
  });
  it('uses fallback only after a confirmed rejection', async () => {
    io.resend.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', statusCode: 422 },
    });
    io.mailgun.mockResolvedValue({ id: '<mailgun-1>' });
    expect(
      await sendMeasuredLifecycleMessage(
        { id: 'message-1', templateId: 'welcome' },
        params
      )
    ).toEqual({
      status: 'accepted',
      provider: 'mailgun',
      providerMessageId: 'mailgun-1',
    });
  });
  it('keeps Resend idempotency stable and sends Reply-To', async () => {
    io.resend.mockResolvedValue({ data: { id: 'resend-1' }, error: null });
    await sendMeasuredLifecycleMessage(
      { id: 'message-1', templateId: 'welcome' },
      params
    );
    await sendMeasuredLifecycleMessage(
      { id: 'message-1', templateId: 'welcome' },
      params
    );
    expect(io.resend.mock.calls.map(call => call[1].idempotencyKey)).toEqual([
      'lifecycle/message-1',
      'lifecycle/message-1',
    ]);
    expect(io.resend.mock.calls[0]?.[0]).toMatchObject({
      replyTo: 'support@example.com',
      tags: [{ name: 'lifecycle_message_id', value: 'message-1' }],
    });
  });
  it('passes the actual category to the breaker', async () => {
    io.resend.mockResolvedValue({ data: { id: 'resend-1' }, error: null });
    await sendMeasuredLifecycleMessage(
      { id: 'message-1', templateId: 'welcome' },
      params,
      'TRANSACTIONAL'
    );
    expect(io.canSend).toHaveBeenCalledWith('TRANSACTIONAL');
  });
  it('records each provider BEFORE contacting it (outbox evidence), Mailgun only after a Resend refusal', async () => {
    const order: string[] = [];
    io.resend.mockImplementation(async () => {
      order.push('resend-call');
      return {
        data: null,
        error: { name: 'validation_error', statusCode: 422 },
      };
    });
    io.mailgun.mockImplementation(async () => {
      order.push('mailgun-call');
      return { id: '<mailgun-2>' };
    });
    await sendMeasuredLifecycleMessage(
      { id: 'message-1', templateId: 'welcome' },
      params,
      'TRANSACTIONAL',
      {
        beforeProviderCall: async provider => {
          order.push(`mark-${provider}`);
        },
      }
    );
    expect(order).toEqual([
      'mark-resend',
      'resend-call',
      'mark-mailgun',
      'mailgun-call',
    ]);
  });
  it('a failing marker aborts BEFORE the provider is contacted and surfaces to the caller', async () => {
    await expect(
      sendMeasuredLifecycleMessage(
        { id: 'message-1', templateId: 'welcome' },
        params,
        'TRANSACTIONAL',
        {
          beforeProviderCall: async () => {
            throw new Error('db down');
          },
        }
      )
    ).rejects.toThrow('db down');
    expect(io.resend).not.toHaveBeenCalled();
    expect(io.mailgun).not.toHaveBeenCalled();
  });
  it.each([
    ['rate limit', { name: 'rate_limit_exceeded', statusCode: 429 }],
    ['account/domain check', { name: 'invalid_access', statusCode: 403 }],
    ['API key', { name: 'invalid_api_key', statusCode: 401 }],
    ['malformed key', { name: 'invalid_idempotency_key', statusCode: 400 }],
    ['non-JSON 4xx', { name: 'application_error', statusCode: 422 }],
  ])(
    'a Resend-only retry stays on Resend after a %s refusal (proves nothing about a held copy)',
    async (_label, error) => {
      io.resend.mockResolvedValue({ data: null, error });
      expect(
        await sendMeasuredLifecycleMessage(
          { id: 'message-1', templateId: 'welcome' },
          params,
          'TRANSACTIONAL',
          { resendOnly: true }
        )
      ).toEqual({
        status: 'unknown',
        provider: 'resend',
        reason: 'resend_only_retry',
      });
      expect(io.mailgun).not.toHaveBeenCalled();
      expect(io.resend.mock.calls[0]?.[1].idempotencyKey).toBe(
        'lifecycle/message-1'
      );
    }
  );
  it('a FIRST attempt keeps the wide fallback rule (403 falls back to Mailgun)', async () => {
    io.resend.mockResolvedValue({
      data: null,
      error: { name: 'invalid_access', statusCode: 403 },
    });
    io.mailgun.mockResolvedValue({ id: '<mailgun-4>' });
    expect(
      await sendMeasuredLifecycleMessage(
        { id: 'message-1', templateId: 'welcome' },
        params,
        'TRANSACTIONAL'
      )
    ).toMatchObject({ status: 'accepted', provider: 'mailgun' });
  });
  it('a Resend-only retry falls back to Mailgun after a JSON 422 validation refusal of the same key (Resend does not hold it)', async () => {
    io.resend.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', statusCode: 422 },
    });
    io.mailgun.mockResolvedValue({ id: '<mailgun-3>' });
    expect(
      await sendMeasuredLifecycleMessage(
        { id: 'message-1', templateId: 'welcome' },
        params,
        'TRANSACTIONAL',
        { resendOnly: true }
      )
    ).toEqual({
      status: 'accepted',
      provider: 'mailgun',
      providerMessageId: 'mailgun-3',
    });
  });
});

describe('pre-send suppression reporting', () => {
  const reservation = {
    userId: 'user',
    accountId: 'account',
    family: 'free',
    ruleId: 'photo',
    templateId: 'free-first-photo',
    occurrence: 'enrollment',
    contentVersion: '1',
    locale: 'pl',
    cohort: 'new',
    ctaIds: ['primary'],
    scheduledAt: new Date('2026-10-20T12:00:00Z'),
    recipientEmail: 'own@example.test',
  };
  beforeEach(() => {
    vi.clearAllMocks();
    io.reserve.mockResolvedValue({
      kind: 'reserved',
      message: { id: 'message-1', templateId: 'welcome' },
    });
    io.mark.mockResolvedValue(true);
  });
  it('records a pre-reservation eligibility rejection without reserving or sending', async () => {
    expect(
      await sendMeasuredLifecycleEmail({
        ...reservation,
        validate: async () => false,
        render: () => params,
      })
    ).toEqual({ status: 'suppressed', reason: 'eligibility_changed' });
    expect(io.decision).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'suppressed',
        reason: 'eligibility_changed',
        family: 'free',
      })
    );
    expect(io.reserve).not.toHaveBeenCalled();
    expect(io.resend).not.toHaveBeenCalled();
  });
  it('finishes a reserved rendering failure through the atomic outbox writer', async () => {
    await sendMeasuredLifecycleEmail({
      ...reservation,
      render: () => {
        throw new Error('render failure');
      },
    });
    expect(io.finish).toHaveBeenCalledWith('message-1', {
      status: 'suppressed',
      reason: 'render_error',
    });
    expect(io.mark).not.toHaveBeenCalled();
    expect(io.resend).not.toHaveBeenCalled();
  });
  it('records changed eligibility after reservation without starting provider work', async () => {
    const validate = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await sendMeasuredLifecycleEmail({
      ...reservation,
      validate,
      render: () => params,
    });
    expect(io.finish).toHaveBeenCalledWith('message-1', {
      status: 'suppressed',
      reason: 'eligibility_changed',
    });
    expect(io.mark).not.toHaveBeenCalled();
    expect(io.resend).not.toHaveBeenCalled();
  });
});
