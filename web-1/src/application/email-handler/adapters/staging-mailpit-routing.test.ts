import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  mode: 'STAGING',
  sink: vi.fn(),
  resend: vi.fn(),
  mailgun: vi.fn(),
  smtp: vi.fn(),
  audienceCreate: vi.fn(),
  audienceUpdate: vi.fn(),
  bounceRefresh: vi.fn(),
  beforeProvider: vi.fn(),
  deadLetter: vi.fn(async () => ({})),
}));
vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: {
    get NODE_ENV_MANUAL() {
      return mock.mode;
    },
    RESEND_API_KEY: 'configured',
    RESEND_MARKETING_API_KEY: 'configured',
    RESEND_AUDIENCE_ID: 'audience',
    MAILGUN_API_KEY: 'configured',
    MAILGUN_DOMAIN: 'example.test',
    MAILGUN_API_BASE_URL: 'https://example.test',
    NATIVE_DEEPLINK_ENABLED: false,
  },
}));
vi.mock('./staging-mailpit', () => ({
  isStagingMailpit: () => mock.mode === 'STAGING',
  sendStagingMailpit: mock.sink,
}));
vi.mock('./resend', () => ({ sendEmail: mock.resend }));
vi.mock('./mailgun', () => ({ sendEmail: mock.mailgun }));
vi.mock('./smtp', () => ({
  isSmtpConfigured: () => true,
  sendEmailViaSmtp: mock.smtp,
}));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mock.resend };
    contacts = { create: mock.audienceCreate, update: mock.audienceUpdate };
  },
}));
vi.mock('mailgun.js', () => ({
  default: class {
    client() {
      return { messages: { create: mock.mailgun } };
    }
  },
}));
vi.mock('../email-circuit-breaker', () => ({
  canSendEmail: () => true,
  shouldLogSuppressedSend: () => false,
  triggerBounceRateRefresh: mock.bounceRefresh,
}));
vi.mock('../mailgun-daily-limit.breaker', () => ({
  isMailgunDailyLimited: () => true,
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO: vi.fn(async () => {}),
}));
vi.mock('@app/event-log/system-actor', () => ({
  resolveSystemActorId_IO: vi.fn(async () => null),
}));
vi.mock('@app/email-handler/email-locale.resolver', () => ({
  resolveLocaleByEmail: vi.fn(async () => 'pl'),
}));
vi.mock('@app/email-handler/email-template.renderer', () => ({
  renderEmailTemplate: vi.fn(() => ({
    subject: 'Login',
    text: 'body',
    html: '<p>body</p>',
  })),
}));
vi.mock('@app/auth/better-auth/auth-token-bridge', () => ({
  resolveCanonicalFrontendOrigin: () => 'https://example.test',
}));

import { __setDb } from '../../../test-utils/setup';
import { sendLifecycleEmail } from '../email-transport';
import { sendTransactionalEmail } from '../email-transactional';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { sendVerificationRequest } from './magic-link.adapter';
import {
  sendMeasuredLifecycleMessage,
  sendMeasuredMailgun,
} from '../lifecycle/measured-transport';
import {
  addConfirmedSubscriberToAudience,
  markSubscriberUnsubscribedInAudience,
} from '../newsletter-audience';

const message = {
  to: 'recipient@example.test',
  subject: 'Subject',
  text: 'Text',
  html: '<p>Text</p>',
};
const lifecycle = {
  ...message,
  templateId: 'test',
  tags: [],
  headers: {},
  deadLetterOnFailure: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.mode = 'STAGING';
  mock.sink.mockResolvedValue('<mailpit-id>');
  __setDb({ failedEmail: { create: mock.deadLetter } });
});
describe('staging delivery isolation', () => {
  it.each([
    'payment-failed',
    'dunning-info',
    'dunning-urgent',
    'dunning-final',
  ])(
    'allows recovery template %s via direct and transactional delivery',
    async templateId => {
      expect(await sendLifecycleEmail({ ...lifecycle, templateId })).toBe(true);
      expect(
        await sendTransactionalEmail(
          templateId,
          { email: `${templateId}@example.test`, id: 'user' },
          'EMAIL_PAYMENT_FAILED_SENT'
        )
      ).toBe(true);
      expect(mock.sink).toHaveBeenCalledTimes(2);
      expect(recordAuditEvent_IO).toHaveBeenCalledOnce();
    }
  );
  it.each(['trial-warning', 'trial-last-day', 'renewal-reminder'])(
    'blocks direct and manual transactional sends of %s',
    async templateId => {
      expect(await sendLifecycleEmail({ ...lifecycle, templateId })).toBe(
        false
      );
      expect(
        await sendTransactionalEmail(
          templateId,
          { email: message.to, id: 'user' },
          'EMAIL_PAYMENT_FAILED_SENT'
        )
      ).toBe(false);
      expect(mock.sink).not.toHaveBeenCalled();
      expect(mock.deadLetter).not.toHaveBeenCalled();
      expect(recordAuditEvent_IO).not.toHaveBeenCalled();
    }
  );
  it('allows a subscription confirmation through the same direct transport', async () => {
    expect(
      await sendLifecycleEmail({
        ...lifecycle,
        templateId: 'upgrade-confirmation',
      })
    ).toBe(true);
    expect(mock.sink).toHaveBeenCalledOnce();
  });
  it('routes normal, magic-link and measured delivery to Mailpit only', async () => {
    expect(await sendLifecycleEmail(lifecycle)).toBe(true);
    await sendVerificationRequest({
      identifier: message.to,
      url: 'https://example.test/login',
      token: 'test',
    });
    expect(
      await sendMeasuredLifecycleMessage(
        { id: 'id', templateId: 'welcome' },
        message,
        'TRANSACTIONAL',
        { beforeProviderCall: mock.beforeProvider }
      )
    ).toEqual({
      status: 'accepted',
      provider: 'mailpit',
      providerMessageId: '<mailpit-id>',
    });
    expect(await sendMeasuredMailgun(message, 'id')).toMatchObject({
      status: 'accepted',
      provider: 'mailpit',
    });
    expect(mock.sink).toHaveBeenCalledTimes(4);
    expect(mock.beforeProvider).toHaveBeenCalledWith('mailpit');
    expect(mock.resend).not.toHaveBeenCalled();
    expect(mock.mailgun).not.toHaveBeenCalled();
    expect(mock.smtp).not.toHaveBeenCalled();
    expect(mock.bounceRefresh).not.toHaveBeenCalled();
  });
  it('never falls through after sink failure and records uncertain measured delivery', async () => {
    mock.sink.mockRejectedValue(new Error('sink unavailable'));
    expect(await sendLifecycleEmail(lifecycle)).toBe(false);
    await sendVerificationRequest({
      identifier: message.to,
      url: 'https://example.test/login',
      token: 'test',
    });
    expect(
      await sendMeasuredLifecycleMessage(
        { id: 'id', templateId: 'welcome' },
        message,
        'TRANSACTIONAL',
        { beforeProviderCall: mock.beforeProvider }
      )
    ).toMatchObject({ status: 'unknown', provider: 'mailpit' });
    expect(mock.resend).not.toHaveBeenCalled();
    expect(mock.mailgun).not.toHaveBeenCalled();
    expect(mock.smtp).not.toHaveBeenCalled();
  });
  it('keeps the durable single-attempt dead letter when Mailpit is unavailable', async () => {
    mock.sink.mockRejectedValue(new Error('sink unavailable'));
    expect(
      await sendLifecycleEmail({ ...lifecycle, deadLetterOnFailure: true })
    ).toBe(false);
    expect(mock.deadLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempts: 1 }),
      })
    );
    expect(mock.resend).not.toHaveBeenCalled();
    expect(mock.mailgun).not.toHaveBeenCalled();
  });
  it('does not mutate a real newsletter audience', async () => {
    await addConfirmedSubscriberToAudience(message.to);
    await markSubscriberUnsubscribedInAudience(message.to);
    expect(mock.audienceCreate).not.toHaveBeenCalled();
    expect(mock.audienceUpdate).not.toHaveBeenCalled();
  });
});
