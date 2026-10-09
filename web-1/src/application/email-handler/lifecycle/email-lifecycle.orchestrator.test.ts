/**
 * runSweep no longer returns when the trial phase processed zero accounts.
 * Downstream steps are independent of trials and always run (still inside
 * safeStep). Quiet hours and the production unsubscribe-secret guard stay.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type * as EmailLifecycleState from '@app/email-handler/email-lifecycle.state';

const env = vi.hoisted(() => ({
  NODE_ENV_MANUAL: 'DEVELOPMENT',
  EMAIL_UNSUBSCRIBE_SECRET: 'test-unsubscribe-secret',
}));

const steps = vi.hoisted(() => ({
  tryBeginEmailSweep: vi.fn(() => true),
  endEmailSweep: vi.fn(),
  sendTrialEmails_IO: vi.fn(),
  checkAndDowngradeOverdueAccounts_IO: vi.fn(),
  sweepExpiringAndExpiredAccounts_IO: vi.fn(),
  sendOnboardingAbandonmentEmails_IO: vi.fn(),
  sendRenewalReminderEmails_IO: vi.fn(),
  sendCancelSequenceEmails_IO: vi.fn(),
  sendWinbackDeletionEmails_IO: vi.fn(),
  sendDailySignupDigest_IO: vi.fn(),
  runAnomalyChecks_IO: vi.fn(),
  shouldRunEmailSweep: vi.fn(() => true),
  updateLastSweepTimestamp: vi.fn(),
  reportIssueBackend: vi.fn(),
  recordAuditEvent_IO: vi.fn(async () => undefined),
  resolveSystemActorId_IO: vi.fn(async () => 'system-actor'),
}));

vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: env,
}));
vi.mock('@domain/email/operations/trial-emails.operation', () => ({
  sendTrialEmails_IO: steps.sendTrialEmails_IO,
}));
vi.mock('@domain/email/operations/dunning-downgrade.operation', () => ({
  checkAndDowngradeOverdueAccounts_IO:
    steps.checkAndDowngradeOverdueAccounts_IO,
}));
vi.mock('@domain/account/operations/account-expiry-sweep.operation', () => ({
  sweepExpiringAndExpiredAccounts_IO: steps.sweepExpiringAndExpiredAccounts_IO,
}));
vi.mock('@domain/email/operations/onboarding-abandonment.operation', () => ({
  sendOnboardingAbandonmentEmails_IO: steps.sendOnboardingAbandonmentEmails_IO,
}));
vi.mock('@domain/email/operations/renewal-reminder.operation', () => ({
  sendRenewalReminderEmails_IO: steps.sendRenewalReminderEmails_IO,
}));
vi.mock('@domain/email/operations/cancel-sequence.operation', () => ({
  sendCancelSequenceEmails_IO: steps.sendCancelSequenceEmails_IO,
}));
vi.mock('@domain/email/operations/winback-deletion.operation', () => ({
  sendWinbackDeletionEmails_IO: steps.sendWinbackDeletionEmails_IO,
}));
vi.mock('@domain/email/operations/admin-alerts.operation', () => ({
  sendDailySignupDigest_IO: steps.sendDailySignupDigest_IO,
}));
vi.mock('@app/monitoring/anomaly-alerts.operation', () => ({
  runAnomalyChecks_IO: steps.runAnomalyChecks_IO,
}));
vi.mock('@app/email-handler/email-lifecycle.state', async importOriginal => {
  const actual = await importOriginal<typeof EmailLifecycleState>();
  return {
    // The real clock check, driven by the fake timers below.
    isEmailQuietHours: actual.isEmailQuietHours,
    shouldRunEmailSweep: steps.shouldRunEmailSweep,
    updateLastSweepTimestamp: steps.updateLastSweepTimestamp,
    tryBeginEmailSweep: steps.tryBeginEmailSweep,
    endEmailSweep: steps.endEmailSweep,
  };
});
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: steps.reportIssueBackend,
}));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO: steps.recordAuditEvent_IO,
}));
vi.mock('@app/event-log/system-actor', () => ({
  resolveSystemActorId_IO: steps.resolveSystemActorId_IO,
}));

import { emailLifecycleInterceptor } from './email-lifecycle.orchestrator';

const downstream = [
  steps.checkAndDowngradeOverdueAccounts_IO,
  steps.sweepExpiringAndExpiredAccounts_IO,
  steps.sendOnboardingAbandonmentEmails_IO,
  steps.sendRenewalReminderEmails_IO,
  steps.sendCancelSequenceEmails_IO,
  steps.sendWinbackDeletionEmails_IO,
  steps.sendDailySignupDigest_IO,
  steps.runAnomalyChecks_IO,
];

describe('emailLifecycleInterceptor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'));
    env.NODE_ENV_MANUAL = 'DEVELOPMENT';
    env.EMAIL_UNSUBSCRIBE_SECRET = 'test-unsubscribe-secret';
    steps.shouldRunEmailSweep.mockReturnValue(true);
    steps.sendTrialEmails_IO.mockResolvedValue({
      emailsSent: 0,
      accountsProcessed: 0,
    });
    steps.checkAndDowngradeOverdueAccounts_IO.mockResolvedValue(0);
    steps.sweepExpiringAndExpiredAccounts_IO.mockResolvedValue({
      expiring: 0,
      expired: 0,
    });
    steps.sendOnboardingAbandonmentEmails_IO.mockResolvedValue(0);
    steps.sendRenewalReminderEmails_IO.mockResolvedValue(0);
    steps.sendCancelSequenceEmails_IO.mockResolvedValue(0);
    steps.sendWinbackDeletionEmails_IO.mockResolvedValue(0);
    steps.sendDailySignupDigest_IO.mockResolvedValue(undefined);
    steps.runAnomalyChecks_IO.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('runs every downstream step when the trial phase processed zero accounts', async () => {
    const order: string[] = [];
    steps.sendTrialEmails_IO.mockImplementation(async () => {
      order.push('trial');
      return { emailsSent: 0, accountsProcessed: 0 };
    });
    steps.checkAndDowngradeOverdueAccounts_IO.mockImplementation(async () => {
      order.push('dunning');
      return 0;
    });
    steps.sweepExpiringAndExpiredAccounts_IO.mockImplementation(async () => {
      order.push('expiry');
      return { expiring: 0, expired: 0 };
    });
    steps.sendOnboardingAbandonmentEmails_IO.mockImplementation(async () => {
      order.push('onboarding');
      return 0;
    });
    steps.sendRenewalReminderEmails_IO.mockImplementation(async () => {
      order.push('renewal');
      return 0;
    });
    steps.sendCancelSequenceEmails_IO.mockImplementation(async () => {
      order.push('cancel');
      return 0;
    });
    steps.sendWinbackDeletionEmails_IO.mockImplementation(async () => {
      order.push('winback');
      return 0;
    });
    steps.sendDailySignupDigest_IO.mockImplementation(async () => {
      order.push('digest');
    });
    steps.runAnomalyChecks_IO.mockImplementation(async () => {
      order.push('anomaly');
    });

    await emailLifecycleInterceptor();

    expect(order).toEqual([
      'trial',
      'dunning',
      'expiry',
      'onboarding',
      'renewal',
      'cancel',
      'winback',
      'digest',
      'anomaly',
    ]);
    expect(steps.updateLastSweepTimestamp).toHaveBeenCalledOnce();
  });

  it('still runs downstream when the trial phase did process accounts', async () => {
    steps.sendTrialEmails_IO.mockResolvedValue({
      emailsSent: 1,
      accountsProcessed: 2,
    });
    await emailLifecycleInterceptor();
    for (const step of downstream) {
      expect(step).toHaveBeenCalledOnce();
    }
  });

  it('does not run the sweep during quiet hours', async () => {
    vi.setSystemTime(new Date('2026-09-23T22:30:00.000Z'));
    await emailLifecycleInterceptor();
    expect(steps.sendTrialEmails_IO).not.toHaveBeenCalled();
    expect(steps.updateLastSweepTimestamp).not.toHaveBeenCalled();
  });

  it('aborts in production when EMAIL_UNSUBSCRIBE_SECRET is missing', async () => {
    env.NODE_ENV_MANUAL = 'PRODUCTION';
    env.EMAIL_UNSUBSCRIBE_SECRET = '';
    await emailLifecycleInterceptor();
    expect(steps.sendTrialEmails_IO).not.toHaveBeenCalled();
    for (const step of downstream) {
      expect(step).not.toHaveBeenCalled();
    }
    expect(steps.updateLastSweepTimestamp).toHaveBeenCalledOnce();
  });

  it('skips a sweep while another one is still running (S122: dedup is not atomic)', async () => {
    steps.tryBeginEmailSweep.mockReturnValueOnce(false);
    await emailLifecycleInterceptor();
    expect(steps.sendTrialEmails_IO).not.toHaveBeenCalled();
    expect(steps.updateLastSweepTimestamp).not.toHaveBeenCalled();
    expect(steps.endEmailSweep).not.toHaveBeenCalled();
  });

  it('releases the in-flight flag after a sweep', async () => {
    await emailLifecycleInterceptor();
    expect(steps.endEmailSweep).toHaveBeenCalledOnce();
  });
});
