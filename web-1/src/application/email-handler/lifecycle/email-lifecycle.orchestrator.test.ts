/**
 * runSweep no longer returns when the trial phase processed zero accounts.
 * Downstream steps are independent of trials and always run (still inside
 * safeStep). Quiet hours (the job's canRunAt) and the production
 * unsubscribe-secret guard stay; cadence and exclusion are the scheduler's.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { JobLeaseLostError } from '@app/scheduler/job-runner';
import type * as OperationalExportModule from './operational-export';

const env = vi.hoisted(() => ({
  NODE_ENV_MANUAL: 'DEVELOPMENT',
  EMAIL_UNSUBSCRIBE_SECRET: 'test-unsubscribe-secret',
}));

const steps = vi.hoisted(() => ({
  sendTrialEmails_IO: vi.fn(),
  checkAndDowngradeOverdueAccounts_IO: vi.fn(),
  sweepExpiringAndExpiredAccounts_IO: vi.fn(),
  sendOnboardingAbandonmentEmails_IO: vi.fn(),
  sendRenewalReminderEmails_IO: vi.fn(),
  sendCancelSequenceEmails_IO: vi.fn(),
  sendWinbackDeletionEmails_IO: vi.fn(),
  sendDailySignupDigest_IO: vi.fn(),
  runAnomalyChecks_IO: vi.fn(),
  exportLifecycleOperations: vi.fn(),
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
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: steps.reportIssueBackend,
}));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO: steps.recordAuditEvent_IO,
}));
vi.mock('@app/event-log/system-actor', () => ({
  resolveSystemActorId_IO: steps.resolveSystemActorId_IO,
}));
vi.mock('./operational-export', async importOriginal => ({
  ...(await importOriginal<typeof OperationalExportModule>()),
  exportLifecycleOperations: steps.exportLifecycleOperations,
}));

import { emailLifecycleJob } from './email-lifecycle.orchestrator';

const runJob = (signal: AbortSignal = new AbortController().signal) =>
  emailLifecycleJob.run({ signal });

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

describe('emailLifecycleJob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'));
    env.NODE_ENV_MANUAL = 'DEVELOPMENT';
    env.EMAIL_UNSUBSCRIBE_SECRET = 'test-unsubscribe-secret';
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
    steps.exportLifecycleOperations.mockResolvedValue(0);
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

    await runJob();

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
  });

  it('still runs downstream when the trial phase did process accounts', async () => {
    steps.sendTrialEmails_IO.mockResolvedValue({
      emailsSent: 1,
      accountsProcessed: 2,
    });
    await runJob();
    for (const step of downstream) {
      expect(step).toHaveBeenCalledOnce();
    }
  });

  it('is not runnable during quiet hours (21:00-09:00 UTC)', () => {
    expect(
      emailLifecycleJob.canRunAt?.(new Date('2026-09-23T22:30:00.000Z'))
    ).toBe(false);
    expect(
      emailLifecycleJob.canRunAt?.(new Date('2026-09-23T12:00:00.000Z'))
    ).toBe(true);
  });

  it('aborts in production when EMAIL_UNSUBSCRIBE_SECRET is missing', async () => {
    env.NODE_ENV_MANUAL = 'PRODUCTION';
    env.EMAIL_UNSUBSCRIBE_SECRET = '';
    await runJob();
    expect(steps.sendTrialEmails_IO).not.toHaveBeenCalled();
    for (const step of downstream) {
      expect(step).not.toHaveBeenCalled();
    }
  });

  it('stops between steps once the lease is lost', async () => {
    const controller = new AbortController();
    steps.sendTrialEmails_IO.mockImplementation(async () => {
      controller.abort();
      return { emailsSent: 0, accountsProcessed: 0 };
    });
    await expect(runJob(controller.signal)).rejects.toBeInstanceOf(
      JobLeaseLostError
    );
    for (const step of downstream) {
      expect(step).not.toHaveBeenCalled();
    }
  });

  it.each([
    [60_000, 'warn'],
    [24 * 60 * 60 * 1000, 'error'],
  ])(
    'keeps export isolation and classifies a %i ms backlog as %s',
    async (age, mode) => {
      steps.exportLifecycleOperations.mockRejectedValue(
        Object.assign(new Error('ambiguous ingestion'), {
          name: 'LifecycleOperationalExportError',
          pendingAgeMs: age,
          retryable: true,
        })
      );

      await runJob();

      expect(steps.reportIssueBackend).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Lifecycle operational export failed (non-blocking)',
          mode,
        })
      );
      expect(steps.sendDailySignupDigest_IO).toHaveBeenCalledOnce();
      expect(steps.runAnomalyChecks_IO).toHaveBeenCalledOnce();
    }
  );
});
